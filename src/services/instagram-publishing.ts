/**
 * LawBriefly Instagram Publishing Service (Task 17A)
 * 
 * Provides the integration foundation for publishing approved carousel posts
 * to Instagram via Meta's Instagram Graph API.
 * 
 * Key capabilities:
 * - JPEG asset conversion and validation (1080x1350, 4:5 aspect ratio, sRGB, < 8MB).
 * - Temporary signed HTTPS URL generation (with strict TTL, never persisted).
 * - Dual Meta authentication support:
 *     * Instagram Login for Business (direct Instagram User ID + User token)
 *     * Facebook Login for Business (Page-linked Instagram Business Account + Page/System User token)
 * - Meta Graph API carousel container lifecycle:
 *     1. Individual carousel child container creation (is_carousel_item = true)
 *     2. Parent carousel container creation (media_type = CAROUSEL, children, caption)
 *     3. Container asynchronous processing status polling (IN_PROGRESS -> FINISHED)
 *     4. Container publication (media_publish) [Guarded & mocked in Task 17A]
 *     5. Published media permalink & metadata retrieval
 * - Zero token leakage: all credentials and signed URLs are redacted in error messages and logs.
 * - Idempotency & state protection: only 'approved' posts can be published; already 'published' posts cannot be republished.
 */

import puppeteer from "@cloudflare/puppeteer";
import type { Env } from "../index";
import { getSupabaseClient } from "./supabase";
import { calculateSha256, CAROUSEL_STORAGE_BUCKET } from "./carousel-persistence";

export type InstagramAuthMode = "instagram_login" | "facebook_login";
export const DEFAULT_INSTAGRAM_GRAPH_VERSION = "v26.0";
export const INSTAGRAM_LOGIN_API_BASE_URL = "https://graph.instagram.com";
export const FACEBOOK_LOGIN_API_BASE_URL = "https://graph.facebook.com";
export const GRAPH_API_BASE_URL = FACEBOOK_LOGIN_API_BASE_URL; // Default fallback alias
export const DEFAULT_JPEG_QUALITY = 90;
export const SIGNED_URL_PUBLISH_EXPIRY_SECONDS = 3600; // 60 minutes (temporary for Meta crawler)
export const CANVAS_WIDTH = 1080;
export const CANVAS_HEIGHT = 1350;
export const MAX_INSTAGRAM_IMAGE_SIZE_BYTES = 8 * 1024 * 1024; // 8MB Meta limit

export interface InstagramPublishingConfig {
	accessToken: string;
	accountId: string;
	graphVersion: string;
	authMode: InstagramAuthMode;
	apiBaseUrl: string;
}

export interface JpegSlideArtifact {
	slide_number: number;
	bytes: Uint8Array;
	filename: string;
	mime_type: "image/jpeg";
	width: number;
	height: number;
	size_bytes: number;
	sha256: string;
}

export interface ContainerCreationResult {
	id: string;
}

export interface ContainerStatusResult {
	id: string;
	status_code: "FINISHED" | "IN_PROGRESS" | "ERROR" | "EXPIRED";
	status?: string;
}

export interface InstagramMediaDetails {
	id: string;
	permalink: string;
	media_type: string;
	timestamp: string;
}

export interface PreparePublishingAssetsResult {
	post: any;
	slides: Array<{
		slide_number: number;
		storage_path: string;
		signed_url: string;
		size_bytes: number;
		sha256: string;
	}>;
	caption: string;
	hashtags: string[];
}

export interface PublishResult {
	success: boolean;
	prepare_only: boolean;
	dry_run: boolean; // Backwards-compatible alias for prepare_only
	post_id: string;
	carousel_container_id?: string;
	child_container_ids?: string[];
	instagram_media_id?: string;
	instagram_permalink?: string;
	error?: string;
	error_code?: string;
}

/**
 * Validates whether a buffer has standard JPEG magic bytes:
 * Starts with SOI (FF D8 FF) and ends with EOI (FF D9).
 */
export function isValidJpegBuffer(bytes: Uint8Array): boolean {
	if (!bytes || bytes.length < 4) return false;
	const len = bytes.length;
	return (
		bytes[0] === 0xff &&
		bytes[1] === 0xd8 &&
		bytes[2] === 0xff &&
		bytes[len - 2] === 0xff &&
		bytes[len - 1] === 0xd9
	);
}

/**
 * Parses image width and height from JPEG bytes by reading the SOF (Start of Frame) marker.
 * Supports SOF0 (Baseline DCT), SOF1 (Extended Sequential), and SOF2 (Progressive DCT).
 */
export function getJpegDimensions(bytes: Uint8Array): { width: number; height: number } | null {
	if (!isValidJpegBuffer(bytes)) return null;

	let offset = 2;
	while (offset < bytes.length - 1) {
		if (bytes[offset] !== 0xff) {
			offset++;
			continue;
		}

		const marker = bytes[offset + 1];

		// SOF0 (0xC0), SOF1 (0xC1), SOF2 (0xC2)
		if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
			if (offset + 8 >= bytes.length) return null;
			const height = (bytes[offset + 5] << 8) | bytes[offset + 6];
			const width = (bytes[offset + 7] << 8) | bytes[offset + 8];
			return { width, height };
		}

		// Skip variable length marker
		if (offset + 3 >= bytes.length) break;
		const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
		offset += 2 + length;
	}

	return null;
}

/**
 * Validates a JPEG slide artifact against Meta Instagram specifications:
 * - Valid JPEG signature
 * - Exact 1080x1350 resolution (4:5 portrait aspect ratio)
 * - Maximum file size 8MB
 */
export function validateJpegSlide(
	bytes: Uint8Array,
	slideNumber?: number
): { valid: boolean; error?: string } {
	const prefix = slideNumber !== undefined ? `Slide ${slideNumber}` : "Image";

	if (!isValidJpegBuffer(bytes)) {
		return { valid: false, error: `${prefix} is not a valid JPEG buffer (invalid magic bytes).` };
	}

	if (bytes.length > MAX_INSTAGRAM_IMAGE_SIZE_BYTES) {
		return {
			valid: false,
			error: `${prefix} size (${bytes.length} bytes) exceeds Meta maximum of 8MB.`,
		};
	}

	const dimensions = getJpegDimensions(bytes);
	if (!dimensions) {
		return { valid: false, error: `${prefix} SOF marker could not be parsed to verify dimensions.` };
	}

	if (dimensions.width !== CANVAS_WIDTH || dimensions.height !== CANVAS_HEIGHT) {
		return {
			valid: false,
			error: `${prefix} dimensions ${dimensions.width}x${dimensions.height} do not match required ${CANVAS_WIDTH}x${CANVAS_HEIGHT} (4:5 ratio).`,
		};
	}

	return { valid: true };
}

/**
 * Generates a synthetic minimal valid JPEG buffer with exact width and height for tests and offline fallbacks.
 */
export function createSyntheticJpegBuffer(width = CANVAS_WIDTH, height = CANVAS_HEIGHT): Uint8Array {
	const soi = [0xff, 0xd8];
	const jfif = [
		0xff, 0xe0, 0x00, 0x10,
		0x4a, 0x46, 0x49, 0x46, 0x00, // 'JFIF\0'
		0x01, 0x01, // version 1.1
		0x00, // density units
		0x00, 0x01, // x density
		0x00, 0x01, // y density
		0x00, 0x00, // thumbnail
	];
	const sof0 = [
		0xff, 0xc0, 0x00, 0x11,
		0x08, // precision 8 bits
		(height >> 8) & 0xff, height & 0xff,
		(width >> 8) & 0xff, width & 0xff,
		0x03, // 3 components (YCbCr)
		0x01, 0x11, 0x00,
		0x02, 0x11, 0x01,
		0x03, 0x11, 0x01,
	];
	const eoi = [0xff, 0xd9];

	return new Uint8Array([...soi, ...jfif, ...sof0, ...eoi]);
}

/**
 * Sanitizes Meta Graph API error messages and strings to prevent access token or signed URL leakage.
 */
export function sanitizeMetaError(error: any): string {
	if (!error) return "Unknown Meta API error";
	let str = typeof error === "string" ? error : error.message || JSON.stringify(error);

	// Redact access tokens
	str = str.replace(/access_token=[a-zA-Z0-9_\-]+/gi, "access_token=[REDACTED]");
	str = str.replace(/Bearer\s+[a-zA-Z0-9_\-]+/gi, "Bearer [REDACTED]");

	// Redact signed URL tokens
	str = str.replace(/token=[a-zA-Z0-9_\-\.]+/gi, "token=[REDACTED]");

	return str;
}

/**
 * Validates and extracts Instagram publishing configuration from Worker environment.
 */
export function getValidatedInstagramConfig(env: Env): InstagramPublishingConfig {
	const authModeRaw = (env.INSTAGRAM_AUTH_MODE || "").trim().toLowerCase();
	if (!authModeRaw) {
		throw new Error(
			"Missing required Worker setting: INSTAGRAM_AUTH_MODE ('instagram_login' or 'facebook_login')."
		);
	}

	if (authModeRaw !== "instagram_login" && authModeRaw !== "facebook_login") {
		throw new Error(
			`Invalid INSTAGRAM_AUTH_MODE: '${env.INSTAGRAM_AUTH_MODE}'. Must be 'instagram_login' or 'facebook_login'.`
		);
	}

	const authMode: InstagramAuthMode = authModeRaw;
	const apiBaseUrl =
		authMode === "instagram_login"
			? INSTAGRAM_LOGIN_API_BASE_URL
			: FACEBOOK_LOGIN_API_BASE_URL;

	const accessToken = (env.INSTAGRAM_ACCESS_TOKEN || "").trim();
	const accountId = (env.INSTAGRAM_USER_ID || env.INSTAGRAM_ACCOUNT_ID || "").trim();
	const graphVersion = (env.INSTAGRAM_GRAPH_VERSION || DEFAULT_INSTAGRAM_GRAPH_VERSION).trim();

	if (!accessToken) {
		throw new Error("Missing required Worker secret: INSTAGRAM_ACCESS_TOKEN");
	}

	if (!accountId) {
		throw new Error("Missing required Worker secret: INSTAGRAM_ACCOUNT_ID or INSTAGRAM_USER_ID");
	}

	return {
		accessToken,
		accountId,
		graphVersion,
		authMode,
		apiBaseUrl,
	};
}

/**
 * Constructs a Meta Graph API URL with configured version and API base host.
 */
export function buildGraphApiUrl(
	version: string,
	path: string,
	apiBaseUrl: string = FACEBOOK_LOGIN_API_BASE_URL
): string {
	const cleanVersion = version.startsWith("v") ? version : `v${version}`;
	const cleanPath = path.startsWith("/") ? path.slice(1) : path;
	return `${apiBaseUrl}/${cleanVersion}/${cleanPath}`;
}

/**
 * Verifies configured Meta credentials against the Graph API using the selected authentication mode host.
 * Supports both Instagram Login (https://graph.instagram.com) and Facebook Login (https://graph.facebook.com).
 * Never logs or exposes raw tokens.
 */
export async function verifyInstagramCredentials(
	env: Env
): Promise<{
	valid: boolean;
	account_id?: string;
	username?: string;
	login_type?: InstagramAuthMode;
	api_host?: string;
	error?: string;
}> {
	try {
		const config = getValidatedInstagramConfig(env);
		const path =
			config.authMode === "instagram_login"
				? "me?fields=user_id,username"
				: `${config.accountId}?fields=id,username,name`;
		const url = buildGraphApiUrl(
			config.graphVersion,
			path,
			config.apiBaseUrl
		);

		const response = await fetch(url, {
			headers: {
				Authorization: `Bearer ${config.accessToken}`,
			},
		});

		if (!response.ok) {
			const errorData: any = await response.json().catch(() => ({}));
			const errorMsg = sanitizeMetaError(errorData?.error || response.statusText);
			return {
				valid: false,
				error: `Meta Graph API authentication failed (${response.status}): ${errorMsg}`,
			};
		}

		const data: any = await response.json();
		const resolvedAccountId = data.user_id || data.id || config.accountId;

		if (config.authMode === "instagram_login" && (data.user_id || data.id)) {
			const returnedId = String(data.user_id || data.id);
			if (returnedId !== config.accountId) {
				return {
					valid: false,
					account_id: returnedId,
					username: data.username,
					login_type: config.authMode,
					api_host: config.apiBaseUrl,
					error: `Instagram Account ID mismatch: authenticated token belongs to user ${returnedId}, but INSTAGRAM_ACCOUNT_ID is configured as ${config.accountId}`,
				};
			}
		}

		return {
			valid: true,
			account_id: resolvedAccountId,
			username: data.username || data.name || "lawbriefly",
			login_type: config.authMode,
			api_host: config.apiBaseUrl,
		};
	} catch (err: any) {
		return {
			valid: false,
			error: sanitizeMetaError(err.message),
		};
	}
}

/**
 * Validates that a post record in Supabase is strictly eligible for Instagram publishing.
 * Enforces:
 * - Post status must be exactly 'approved'.
 * - Post cannot be 'published' (duplicate publishing forbidden).
 * - Post cannot be currently 'publishing'.
 * - Human review required must be true.
 * - Carousel slide count must be between 4 and 6.
 * - Instagram caption must be non-empty.
 */
export function validatePostForPublishing(post: any): {
	valid: boolean;
	error?: string;
	error_code?: string;
} {
	if (!post || typeof post !== "object") {
		return { valid: false, error: "Post record is missing or invalid.", error_code: "INVALID_POST_RECORD" };
	}

	if (post.post_status === "published") {
		return {
			valid: false,
			error: "Post has already been published to Instagram. Republishing is prohibited.",
			error_code: "POST_ALREADY_PUBLISHED",
		};
	}

	if (post.post_status === "publishing") {
		return {
			valid: false,
			error: "Publishing is currently in progress for this post.",
			error_code: "PUBLISHING_IN_PROGRESS",
		};
	}

	if (post.post_status !== "approved") {
		return {
			valid: false,
			error: `Post status must be 'approved' to publish. Current status: '${post.post_status}'.`,
			error_code: "POST_NOT_APPROVED",
		};
	}

	if (post.human_review_required !== true) {
		return {
			valid: false,
			error: "Human editorial review requirement check failed.",
			error_code: "HUMAN_REVIEW_REQUIRED",
		};
	}

	const slideCount = Number(post.carousel_slide_count);
	if (isNaN(slideCount) || slideCount < 4 || slideCount > 6) {
		return {
			valid: false,
			error: `Carousel slide count must be between 4 and 6. Found: ${slideCount}.`,
			error_code: "INVALID_SLIDE_COUNT",
		};
	}

	const caption = (post.instagram_caption || "").trim();
	if (!caption) {
		return {
			valid: false,
			error: "Instagram caption cannot be empty.",
			error_code: "EMPTY_CAPTION",
		};
	}

	return { valid: true };
}

/**
 * Converts a single PNG buffer to JPEG format using Cloudflare Browser Run (@cloudflare/puppeteer).
 */
export async function convertPngToJpegWithBrowser(
	pngBytes: Uint8Array,
	env: Env,
	quality = DEFAULT_JPEG_QUALITY
): Promise<Uint8Array> {
	if (!env.MYBROWSER) {
		throw new Error("Browser binding MYBROWSER is not available in environment.");
	}

	const browser = await puppeteer.launch(env.MYBROWSER);
	try {
		const page = await browser.newPage();
		await page.setViewport({ width: CANVAS_WIDTH, height: CANVAS_HEIGHT, deviceScaleFactor: 1 });

		const base64Png = Buffer.from(pngBytes).toString("base64");
		const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { width: 1080px; height: 1350px; overflow: hidden; background: #090D16; }
img { width: 1080px; height: 1350px; display: block; }
</style>
</head>
<body>
<img src="data:image/png;base64,${base64Png}" />
</body>
</html>`;

		await page.setContent(html, { waitUntil: "networkidle0" });

		const screenshot = (await page.screenshot({
			type: "jpeg",
			quality,
			clip: { x: 0, y: 0, width: CANVAS_WIDTH, height: CANVAS_HEIGHT },
		})) as Uint8Array;

		return screenshot;
	} finally {
		await browser.close();
	}
}

/**
 * Converts multiple slide PNGs to standard 1080x1350 JPEGs in a SINGLE browser session for high performance.
 */
export async function convertSlidePngsToJpegs(
	slides: Array<{ slide_number: number; bytes: Uint8Array; filename?: string }>,
	env: Env,
	options?: {
		quality?: number;
		customConverter?: (pngBytes: Uint8Array, slideNumber: number) => Promise<Uint8Array>;
	}
): Promise<JpegSlideArtifact[]> {
	const quality = options?.quality ?? DEFAULT_JPEG_QUALITY;
	const results: JpegSlideArtifact[] = [];

	// Use custom converter if provided (e.g. for unit testing)
	if (options?.customConverter) {
		for (const slide of slides) {
			const jpegBytes = await options.customConverter(slide.bytes, slide.slide_number);
			const validation = validateJpegSlide(jpegBytes, slide.slide_number);
			if (!validation.valid) {
				throw new Error(`Converted JPEG validation failed for slide ${slide.slide_number}: ${validation.error}`);
			}
			const sha256 = await calculateSha256(jpegBytes);
			const padded = String(slide.slide_number).padStart(2, "0");
			results.push({
				slide_number: slide.slide_number,
				bytes: jpegBytes,
				filename: `slide-${padded}.jpg`,
				mime_type: "image/jpeg",
				width: CANVAS_WIDTH,
				height: CANVAS_HEIGHT,
				size_bytes: jpegBytes.length,
				sha256,
			});
		}
		return results;
	}

	if (!env.MYBROWSER) {
		throw new Error("Browser binding MYBROWSER is required for JPEG conversion.");
	}

	const browser = await puppeteer.launch(env.MYBROWSER);
	try {
		const page = await browser.newPage();
		await page.setViewport({ width: CANVAS_WIDTH, height: CANVAS_HEIGHT, deviceScaleFactor: 1 });

		for (const slide of slides) {
			const base64Png = Buffer.from(slide.bytes).toString("base64");
			const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { width: 1080px; height: 1350px; overflow: hidden; background: #090D16; }
img { width: 1080px; height: 1350px; display: block; }
</style>
</head>
<body>
<img src="data:image/png;base64,${base64Png}" />
</body>
</html>`;

			await page.setContent(html, { waitUntil: "networkidle0" });

			const jpegBytes = (await page.screenshot({
				type: "jpeg",
				quality,
				clip: { x: 0, y: 0, width: CANVAS_WIDTH, height: CANVAS_HEIGHT },
			})) as Uint8Array;

			const validation = validateJpegSlide(jpegBytes, slide.slide_number);
			if (!validation.valid) {
				throw new Error(`Converted JPEG validation failed for slide ${slide.slide_number}: ${validation.error}`);
			}

			const sha256 = await calculateSha256(jpegBytes);
			const padded = String(slide.slide_number).padStart(2, "0");

			results.push({
				slide_number: slide.slide_number,
				bytes: jpegBytes,
				filename: `slide-${padded}.jpg`,
				mime_type: "image/jpeg",
				width: CANVAS_WIDTH,
				height: CANVAS_HEIGHT,
				size_bytes: jpegBytes.length,
				sha256,
			});
		}

		return results;
	} finally {
		await browser.close();
	}
}

/**
 * Prepares JPEG publishing assets and generates temporary signed HTTPS URLs for Meta ingestion.
 * Original PNGs are fully preserved in storage.
 */
export async function preparePublishingAssets(
	env: Env,
	postId: string,
	options?: {
		customConverter?: (pngBytes: Uint8Array, slideNumber: number) => Promise<Uint8Array>;
		signedUrlExpirySeconds?: number;
	}
): Promise<PreparePublishingAssetsResult> {
	const supabase = getSupabaseClient(env);
	const signedExpiry = options?.signedUrlExpirySeconds || SIGNED_URL_PUBLISH_EXPIRY_SECONDS;

	// 1. Fetch post
	const { data: post, error: postError } = await supabase
		.from("social_content_posts")
		.select("*")
		.eq("id", postId)
		.single();

	if (postError || !post) {
		throw new Error(`Post not found in database: ${postId}`);
	}

	const validation = validatePostForPublishing(post);
	if (!validation.valid) {
		throw new Error(validation.error);
	}

	// 2. Fetch slide assets for this post
	const { data: allAssets, error: assetsError } = await supabase
		.from("social_content_assets")
		.select("*")
		.eq("post_id", postId)
		.order("slide_number", { ascending: true });

	if (assetsError || !allAssets || allAssets.length === 0) {
		throw new Error(`No slide assets found for post ${postId}`);
	}

	const publishingJpegAssets = allAssets.filter(
		(a) => a.asset_type === "publishing_slide" && a.slide_number !== null
	);
	const pngSlideAssets = allAssets.filter(
		(a) => a.asset_type === "slide" && a.slide_number !== null
	);

	const requiredCount = post.carousel_slide_count;

	// Check if a complete set of pre-generated publishing_slide JPEGs exists
	const hasCompleteJpegSet =
		publishingJpegAssets.length === requiredCount &&
		publishingJpegAssets.every((a, idx) => a.slide_number === idx + 1);

	const preparedSlides: PreparePublishingAssetsResult["slides"] = [];

	if (hasCompleteJpegSet) {
		// FAST PATH: Direct signed URL generation from pre-generated publishing_slide JPEG assets.
		// Bypasses PNG downloading, browser conversion, and JPEG re-uploading.
		for (const asset of publishingJpegAssets) {
			const { data: signedData, error: signError } = await supabase.storage
				.from(asset.storage_bucket || CAROUSEL_STORAGE_BUCKET)
				.createSignedUrl(asset.storage_path, signedExpiry);

			if (signError || !signedData?.signedUrl) {
				throw new Error(`Failed to generate signed URL for ${asset.storage_path}: ${signError?.message}`);
			}

			preparedSlides.push({
				slide_number: asset.slide_number!,
				storage_path: asset.storage_path,
				signed_url: signedData.signedUrl,
				size_bytes: asset.size_bytes,
				sha256: asset.sha256,
			});
		}
	} else {
		// FALLBACK PATH: For legacy posts or when publishing_slide assets are missing.
		// Validate that a complete set of PNG slide assets exists. Never publish an incomplete carousel.
		if (pngSlideAssets.length !== requiredCount) {
			throw new Error(
				`Incomplete carousel assets: post requires ${requiredCount} slides, but found ${publishingJpegAssets.length} JPEG(s) and ${pngSlideAssets.length} PNG(s). Never publish an incomplete carousel.`
			);
		}

		// Download slide PNGs from Supabase Storage
		const downloadedSlides: Array<{ slide_number: number; bytes: Uint8Array; filename: string }> = [];
		for (const asset of pngSlideAssets) {
			const { data: blob, error: downloadError } = await supabase.storage
				.from(asset.storage_bucket || CAROUSEL_STORAGE_BUCKET)
				.download(asset.storage_path);

			if (downloadError || !blob) {
				throw new Error(`Failed to download slide ${asset.slide_number} from storage: ${downloadError?.message}`);
			}

			const bytes = new Uint8Array(await blob.arrayBuffer());
			downloadedSlides.push({
				slide_number: asset.slide_number,
				bytes,
				filename: asset.asset_key,
			});
		}

		// Convert PNGs to JPEGs
		const jpegArtifacts = await convertSlidePngsToJpegs(downloadedSlides, env, {
			customConverter: options?.customConverter,
		});

		// Upload JPEGs to storage under posts/${postId}/publishing/
		for (const jpeg of jpegArtifacts) {
			const storagePath = `posts/${postId}/publishing/${jpeg.filename}`;

			const { error: uploadError } = await supabase.storage
				.from(CAROUSEL_STORAGE_BUCKET)
				.upload(storagePath, jpeg.bytes, {
					contentType: "image/jpeg",
					upsert: true,
				});

			if (uploadError) {
				throw new Error(`Failed to upload JPEG publishing asset ${storagePath}: ${uploadError.message}`);
			}

			// Generate temporary signed URL (never saved to database!)
			const { data: signedData, error: signError } = await supabase.storage
				.from(CAROUSEL_STORAGE_BUCKET)
				.createSignedUrl(storagePath, signedExpiry);

			if (signError || !signedData?.signedUrl) {
				throw new Error(`Failed to generate signed URL for ${storagePath}: ${signError?.message}`);
			}

			preparedSlides.push({
				slide_number: jpeg.slide_number,
				storage_path: storagePath,
				signed_url: signedData.signedUrl,
				size_bytes: jpeg.size_bytes,
				sha256: jpeg.sha256,
			});
		}
	}

	return {
		post,
		slides: preparedSlides,
		caption: post.instagram_caption,
		hashtags: Array.isArray(post.hashtags) ? post.hashtags : [],
	};
}

/**
 * Creates an individual carousel child item container in Meta Instagram Graph API.
 * Endpoint: POST /{ig_user_id}/media with image_url and is_carousel_item = true.
 */
export async function createCarouselItemContainer(
	config: InstagramPublishingConfig,
	imageUrl: string
): Promise<string> {
	const url = buildGraphApiUrl(config.graphVersion, `${config.accountId}/media`, config.apiBaseUrl);

	const response = await fetch(url, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${config.accessToken}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			image_url: imageUrl,
			is_carousel_item: true,
		}),
	});

	if (!response.ok) {
		const errorData: any = await response.json().catch(() => ({}));
		const errorMsg = sanitizeMetaError(errorData?.error || response.statusText);
		throw new Error(`Failed to create carousel item container (${response.status}): ${errorMsg}`);
	}

	const data: any = await response.json();
	if (!data.id) {
		throw new Error("Meta Graph API returned container response missing ID.");
	}

	return data.id;
}

/**
 * Creates a single image container in Meta Instagram Graph API.
 * Endpoint: POST /{ig_user_id}/media with image_url and caption.
 */
export async function createSingleImageContainer(
	config: InstagramPublishingConfig,
	imageUrl: string,
	caption?: string
): Promise<string> {
	if (!imageUrl || !imageUrl.startsWith("https://")) {
		throw new Error("Invalid image_url: must be a valid HTTPS URL.");
	}

	const url = buildGraphApiUrl(config.graphVersion, `${config.accountId}/media`, config.apiBaseUrl);

	const payload: Record<string, any> = {
		image_url: imageUrl,
	};
	if (caption && caption.trim().length > 0) {
		payload.caption = caption.trim();
	}

	const response = await fetch(url, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${config.accessToken}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify(payload),
	});

	if (!response.ok) {
		const errorData: any = await response.json().catch(() => ({}));
		const errorMsg = sanitizeMetaError(errorData?.error || response.statusText);
		throw new Error(`Failed to create single image container (${response.status}): ${errorMsg}`);
	}

	const data: any = await response.json();
	if (!data.id) {
		throw new Error("Meta Graph API returned single image container response missing ID.");
	}

	return data.id;
}

/**
 * Creates the parent carousel container grouping child container IDs and applying the post caption.
 * Endpoint: POST /{ig_user_id}/media with media_type = CAROUSEL, children, and caption.
 */
export async function createCarouselContainer(
	config: InstagramPublishingConfig,
	childrenContainerIds: string[],
	caption: string
): Promise<string> {
	if (!childrenContainerIds || childrenContainerIds.length < 2 || childrenContainerIds.length > 10) {
		throw new Error(`Instagram carousel requires between 2 and 10 child containers. Received: ${childrenContainerIds?.length}`);
	}

	const url = buildGraphApiUrl(config.graphVersion, `${config.accountId}/media`, config.apiBaseUrl);

	const response = await fetch(url, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${config.accessToken}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			media_type: "CAROUSEL",
			children: childrenContainerIds,
			caption,
		}),
	});

	if (!response.ok) {
		const errorData: any = await response.json().catch(() => ({}));
		const errorMsg = sanitizeMetaError(errorData?.error || response.statusText);
		throw new Error(`Failed to create parent carousel container (${response.status}): ${errorMsg}`);
	}

	const data: any = await response.json();
	if (!data.id) {
		throw new Error("Meta Graph API returned parent container response missing ID.");
	}

	return data.id;
}

/**
 * Queries the processing status of a container from Meta Graph API.
 * Endpoint: GET /{creation_id}?fields=status_code,status
 */
export async function getContainerStatus(
	config: InstagramPublishingConfig,
	containerId: string
): Promise<ContainerStatusResult> {
	const url = buildGraphApiUrl(config.graphVersion, `${containerId}?fields=status_code,status`, config.apiBaseUrl);

	const response = await fetch(url, {
		headers: {
			Authorization: `Bearer ${config.accessToken}`,
		},
	});

	if (!response.ok) {
		const errorData: any = await response.json().catch(() => ({}));
		const errorMsg = sanitizeMetaError(errorData?.error || response.statusText);
		throw new Error(`Failed to check container status (${response.status}): ${errorMsg}`);
	}

	const data: any = await response.json();
	return {
		id: containerId,
		status_code: data.status_code || "IN_PROGRESS",
		status: data.status,
	};
}

/**
 * Polls the container status until it finishes processing or encounters a terminal state.
 */
export async function pollContainerUntilReady(
	config: InstagramPublishingConfig,
	containerId: string,
	options?: {
		maxAttempts?: number;
		intervalMs?: number;
	}
): Promise<ContainerStatusResult> {
	const maxAttempts = options?.maxAttempts ?? 10;
	const intervalMs = options?.intervalMs ?? 1500;

	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		const status = await getContainerStatus(config, containerId);

		if (status.status_code === "FINISHED") {
			return status;
		}

		if (status.status_code === "ERROR") {
			throw new Error(`Container processing failed on Meta side (status_code: ERROR). Details: ${status.status || "Unknown error"}`);
		}

		if (status.status_code === "EXPIRED") {
			throw new Error("Container expired on Meta side before publication could complete.");
		}

		if (attempt < maxAttempts) {
			await new Promise((resolve) => setTimeout(resolve, intervalMs));
		}
	}

	throw new Error(`Container processing timed out after ${maxAttempts} attempts.`);
}

/**
 * Publishes a finished carousel container to Instagram.
 * Endpoint: POST /{ig_user_id}/media_publish with creation_id.
 * 
 * NOTE: For Task 17A, this function is structured and test-covered with mocks.
 * It is NOT executed against live Meta API endpoints without explicit activation.
 */
export async function publishMediaContainer(
	config: InstagramPublishingConfig,
	creationId: string
): Promise<string> {
	const url = buildGraphApiUrl(config.graphVersion, `${config.accountId}/media_publish`, config.apiBaseUrl);

	const response = await fetch(url, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${config.accessToken}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			creation_id: creationId,
		}),
	});

	if (!response.ok) {
		const errorData: any = await response.json().catch(() => ({}));
		const errorMsg = sanitizeMetaError(errorData?.error || response.statusText);
		throw new Error(`Failed to publish media container (${response.status}): ${errorMsg}`);
	}

	const data: any = await response.json();
	if (!data.id) {
		throw new Error("Meta Graph API returned media publish response missing media ID.");
	}

	return data.id;
}

/**
 * Retrieves the published Instagram media permalink and details.
 * Endpoint: GET /{media_id}?fields=id,permalink,media_type,timestamp
 */
export async function getPublishedMediaDetails(
	config: InstagramPublishingConfig,
	mediaId: string
): Promise<InstagramMediaDetails> {
	const url = buildGraphApiUrl(config.graphVersion, `${mediaId}?fields=id,permalink,media_type,timestamp`, config.apiBaseUrl);

	const response = await fetch(url, {
		headers: {
			Authorization: `Bearer ${config.accessToken}`,
		},
	});

	if (!response.ok) {
		const errorData: any = await response.json().catch(() => ({}));
		const errorMsg = sanitizeMetaError(errorData?.error || response.statusText);
		throw new Error(`Failed to fetch published media details (${response.status}): ${errorMsg}`);
	}

	const data: any = await response.json();
	return {
		id: data.id || mediaId,
		permalink: data.permalink || `https://www.instagram.com/p/${mediaId}/`,
		media_type: data.media_type || "CAROUSEL_ALBUM",
		timestamp: data.timestamp || new Date().toISOString(),
	};
}

/**
 * Complete publishing orchestrator for approved LawBriefly carousels.
 * 
 * Safety invariant:
 * - When prepareOnly is true (default):
 *   Prepares JPEG assets, creates real child media containers, creates real parent carousel container,
 *   verifies container processing status, and safely STOPS before invoking media_publish.
 *   Note: It is designated as prepare_only because real containers are created on Meta's side,
 *   but it NEVER invokes media_publish.
 * - The post in Supabase strictly remains in 'approved' status.
 */
export async function publishApprovedCarousel(
	env: Env,
	postId: string,
	options?: {
		prepareOnly?: boolean;
		dryRun?: boolean; // legacy alias for prepareOnly
		customConverter?: (pngBytes: Uint8Array, slideNumber: number) => Promise<Uint8Array>;
		pollMaxAttempts?: number;
		pollIntervalMs?: number;
	}
): Promise<PublishResult> {
	const prepareOnly = options?.prepareOnly ?? options?.dryRun ?? true;
	const config = getValidatedInstagramConfig(env);

	// 1. Prepare publishing assets & temporary signed URLs (60 min TTL)
	const assetPrep = await preparePublishingAssets(env, postId, {
		customConverter: options?.customConverter,
	});

	// 2. Create child containers for each slide
	const childContainerIds: string[] = [];
	for (const slide of assetPrep.slides) {
		const childId = await createCarouselItemContainer(config, slide.signed_url);
		childContainerIds.push(childId);
	}

	// 3. Format full caption with hashtags
	const hashtagString = assetPrep.hashtags.length > 0
		? "\n\n" + assetPrep.hashtags.map((h) => (h.startsWith("#") ? h : `#${h}`)).join(" ")
		: "";
	const fullCaption = `${assetPrep.caption}${hashtagString}`;

	// 4. Create parent carousel container
	const parentContainerId = await createCarouselContainer(config, childContainerIds, fullCaption);

	// 5. Poll container status until ready
	const containerStatus = await pollContainerUntilReady(config, parentContainerId, {
		maxAttempts: options?.pollMaxAttempts,
		intervalMs: options?.pollIntervalMs,
	});

	if (containerStatus.status_code !== "FINISHED") {
		throw new Error(`Container processing did not finish successfully: ${containerStatus.status_code}`);
	}

	// 6. Stop here if prepare_only (Task 17A safety requirement - NEVER call media_publish)
	if (prepareOnly) {
		return {
			success: true,
			prepare_only: true,
			dry_run: true,
			post_id: postId,
			carousel_container_id: parentContainerId,
			child_container_ids: childContainerIds,
		};
	}

	// 7. Live execution (Task 17B path only when prepareOnly === false)
	const mediaId = await publishMediaContainer(config, parentContainerId);
	const mediaDetails = await getPublishedMediaDetails(config, mediaId);

	// 8. Update post status to 'published' in database
	const supabase = getSupabaseClient(env);
	const now = new Date().toISOString();

	await supabase
		.from("social_content_posts")
		.update({
			post_status: "published",
			updated_at: now,
		})
		.eq("id", postId);

	return {
		success: true,
		prepare_only: false,
		dry_run: false,
		post_id: postId,
		carousel_container_id: parentContainerId,
		child_container_ids: childContainerIds,
		instagram_media_id: mediaId,
		instagram_permalink: mediaDetails.permalink,
	};
}

export interface PublishSingleImageOptions {
	prepareOnly?: boolean;
	dryRun?: boolean; // legacy alias for prepareOnly
	customConverter?: (pngBytes: Uint8Array, slideNumber?: number) => Promise<Uint8Array>;
	pollMaxAttempts?: number;
	pollIntervalMs?: number;
}

export interface PublishSingleImageParams {
	postId?: string;
	storagePath?: string;
	caption?: string;
	options?: PublishSingleImageOptions;
}

export interface PublishSingleImageResult {
	success: boolean;
	prepare_only: boolean;
	dry_run: boolean;
	post_id?: string;
	container_id?: string;
	instagram_media_id?: string;
	instagram_permalink?: string;
	image_url?: string;
	storage_path?: string;
	error?: string;
	error_code?: string;
}

/**
 * Complete publishing orchestrator for single images stored in Supabase Storage.
 *
 * Workflow:
 * 1. Retrieve the image from Supabase Storage (either from an approved post's slide or via direct storage path).
 * 2. Validate/convert to JPEG format (1080x1350, <8MB, JPEG magic bytes).
 * 3. Generate a temporary signed HTTPS URL (60-minute TTL, direct JPEG, accessible to Meta crawler without auth headers).
 * 4. Create the Instagram single-image container: POST /{ig_user_id}/media with image_url & caption.
 * 5. Poll container status until ready (FINISHED).
 * 6. If prepareOnly is true (default): stops safely without calling media_publish.
 * 7. If prepareOnly is false: publishes container via media_publish, retrieves permalink, updates Supabase status.
 */
export async function publishSingleImage(
	env: Env,
	params: PublishSingleImageParams
): Promise<PublishSingleImageResult> {
	const prepareOnly = params.options?.prepareOnly ?? params.options?.dryRun ?? true;
	const config = getValidatedInstagramConfig(env);
	const supabase = getSupabaseClient(env);

	let storagePath: string;
	let caption: string;
	let post: any = null;

	if (params.postId) {
		// 1. Retrieve post from Supabase
		const { data: postRecord, error: postError } = await supabase
			.from("social_content_posts")
			.select("*")
			.eq("id", params.postId)
			.single();

		if (postError || !postRecord) {
			throw new Error(`Post not found in database: ${params.postId}`);
		}

		post = postRecord;

		// Validate post eligibility (prevent duplicate publishing)
		if (post.post_status === "published") {
			return {
				success: false,
				prepare_only: prepareOnly,
				dry_run: prepareOnly,
				post_id: params.postId,
				error: "Post has already been published to Instagram. Republishing is prohibited.",
				error_code: "POST_ALREADY_PUBLISHED",
			};
		}

		if (post.post_status === "publishing") {
			return {
				success: false,
				prepare_only: prepareOnly,
				dry_run: prepareOnly,
				post_id: params.postId,
				error: "Publishing is currently in progress for this post.",
				error_code: "PUBLISHING_IN_PROGRESS",
			};
		}

		if (post.post_status !== "approved") {
			return {
				success: false,
				prepare_only: prepareOnly,
				dry_run: prepareOnly,
				post_id: params.postId,
				error: `Post status must be 'approved' to publish. Current status: '${post.post_status}'.`,
				error_code: "POST_NOT_APPROVED",
			};
		}

		// Check if a pre-generated publishing_slide JPEG exists for slide 1
		const { data: pubSlideAssets } = await supabase
			.from("social_content_assets")
			.select("*")
			.eq("post_id", params.postId)
			.eq("asset_type", "publishing_slide")
			.order("slide_number", { ascending: true });

		const pregeneratedJpeg = pubSlideAssets && pubSlideAssets.length > 0 ? pubSlideAssets[0] : null;

		if (pregeneratedJpeg) {
			// FAST PATH: Use existing pre-generated JPEG asset directly
			storagePath = pregeneratedJpeg.storage_path;
		} else {
			// FALLBACK PATH: Retrieve primary slide asset (slide 1 PNG) and convert
			const { data: assets, error: assetError } = await supabase
				.from("social_content_assets")
				.select("*")
				.eq("post_id", params.postId)
				.eq("asset_type", "slide")
				.order("slide_number", { ascending: true });

			if (assetError || !assets || assets.length === 0) {
				throw new Error(`No slide asset found for post ${params.postId}`);
			}

			const primaryAsset = assets[0];

			// Download asset from Supabase Storage
			const { data: blob, error: downloadError } = await supabase.storage
				.from(primaryAsset.storage_bucket || CAROUSEL_STORAGE_BUCKET)
				.download(primaryAsset.storage_path);

			if (downloadError || !blob) {
				throw new Error(`Failed to download slide from storage: ${downloadError?.message}`);
			}

			const rawBytes = new Uint8Array(await blob.arrayBuffer());

			// Check if already JPEG or convert from PNG
			let jpegBytes: Uint8Array;
			if (isValidJpegBuffer(rawBytes)) {
				jpegBytes = rawBytes;
			} else if (params.options?.customConverter) {
				jpegBytes = await params.options.customConverter(rawBytes, 1);
			} else {
				jpegBytes = await convertPngToJpegWithBrowser(rawBytes, env);
			}

			const validation = validateJpegSlide(jpegBytes, 1);
			if (!validation.valid) {
				throw new Error(`JPEG validation failed: ${validation.error}`);
			}

			// Upload JPEG publishing asset
			const jpegPath = `posts/${params.postId}/publishing/single-image.jpg`;
			const { error: uploadError } = await supabase.storage
				.from(CAROUSEL_STORAGE_BUCKET)
				.upload(jpegPath, jpegBytes, {
					contentType: "image/jpeg",
					upsert: true,
				});

			if (uploadError) {
				throw new Error(`Failed to upload JPEG publishing asset: ${uploadError.message}`);
			}

			storagePath = jpegPath;
		}

		// Format caption with hashtags
		const hashtags = Array.isArray(post.hashtags) ? post.hashtags : [];
		const hashtagString = hashtags.length > 0
			? "\n\n" + hashtags.map((h: string) => (h.startsWith("#") ? h : `#${h}`)).join(" ")
			: "";
		caption = `${post.instagram_caption || ""}${hashtagString}`.trim();
	} else if (params.storagePath) {
		storagePath = params.storagePath.trim();
		caption = (params.caption || "").trim();
	} else {
		throw new Error("Either 'postId' or 'storagePath' must be provided to publishSingleImage.");
	}

	// 2. Generate temporary signed HTTPS URL (60-minute TTL)
	const { data: signedData, error: signError } = await supabase.storage
		.from(CAROUSEL_STORAGE_BUCKET)
		.createSignedUrl(storagePath, SIGNED_URL_PUBLISH_EXPIRY_SECONDS);

	if (signError || !signedData?.signedUrl) {
		throw new Error(`Failed to generate signed URL for ${storagePath}: ${signError?.message}`);
	}

	const signedUrl = signedData.signedUrl;

	// 3. Create Instagram single-image container
	const containerId = await createSingleImageContainer(config, signedUrl, caption);

	// 4. Poll container status until ready (FINISHED)
	const containerStatus = await pollContainerUntilReady(config, containerId, {
		maxAttempts: params.options?.pollMaxAttempts,
		intervalMs: params.options?.pollIntervalMs,
	});

	if (containerStatus.status_code !== "FINISHED") {
		throw new Error(`Single image container processing did not finish successfully: ${containerStatus.status_code}`);
	}

	// 5. If prepare_only (default), safely return without publishing
	if (prepareOnly) {
		return {
			success: true,
			prepare_only: true,
			dry_run: true,
			post_id: params.postId,
			container_id: containerId,
			image_url: signedUrl,
			storage_path: storagePath,
		};
	}

	// 6. Live publishing (media_publish)
	const mediaId = await publishMediaContainer(config, containerId);
	const mediaDetails = await getPublishedMediaDetails(config, mediaId);

	// 7. Update post status in database if postId is present
	if (params.postId) {
		const now = new Date().toISOString();
		await supabase
			.from("social_content_posts")
			.update({
				post_status: "published",
				updated_at: now,
			})
			.eq("id", params.postId);
	}

	return {
		success: true,
		prepare_only: false,
		dry_run: false,
		post_id: params.postId,
		container_id: containerId,
		instagram_media_id: mediaId,
		instagram_permalink: mediaDetails.permalink,
		image_url: signedUrl,
		storage_path: storagePath,
	};
}

/**
 * Handles POST /api/ai/publish-instagram endpoint.
 * Gated: development-only. Default prepare_only: true.
 * Supports both single image (media_type: "IMAGE") and carousel (default / media_type: "CAROUSEL") publishing.
 */
export async function handlePublishInstagram(request: Request, env: Env): Promise<Response> {
	if (env.APP_ENV !== "development") {
		return new Response(JSON.stringify({ error: "Not Found", status: 404 }), {
			status: 404,
			headers: { "Content-Type": "application/json" },
		});
	}

	if (request.method !== "POST") {
		return new Response(
			JSON.stringify({ error: "Method Not Allowed", message: "Only POST requests are supported." }),
			{ status: 405, headers: { "Content-Type": "application/json" } }
		);
	}

	const contentType = request.headers.get("Content-Type") || "";
	if (!contentType.toLowerCase().includes("application/json")) {
		return new Response(
			JSON.stringify({ error: "Bad Request", message: "Content-Type must be application/json." }),
			{ status: 400, headers: { "Content-Type": "application/json" } }
		);
	}

	let body: any;
	try {
		body = await request.json();
	} catch {
		return new Response(
			JSON.stringify({ error: "Bad Request", message: "Invalid JSON body." }),
			{ status: 400, headers: { "Content-Type": "application/json" } }
		);
	}

	const postId = typeof body?.post_id === "string" ? body.post_id.trim() : "";
	const storagePath = typeof body?.storage_path === "string" ? body.storage_path.trim() : "";
	const mediaType = String(body?.media_type || (storagePath && !postId ? "IMAGE" : "CAROUSEL")).toUpperCase();

	if (!postId && !storagePath) {
		return new Response(
			JSON.stringify({ error: "Bad Request", message: "Valid 'post_id' UUID or 'storage_path' is required." }),
			{ status: 400, headers: { "Content-Type": "application/json" } }
		);
	}

	if (postId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(postId)) {
		return new Response(
			JSON.stringify({ error: "Bad Request", message: "Valid 'post_id' UUID is required." }),
			{ status: 400, headers: { "Content-Type": "application/json" } }
		);
	}

	// prepare_only defaults to true (never publishes without explicit false)
	const prepareOnly = body?.prepare_only !== undefined
		? Boolean(body.prepare_only)
		: (body?.dry_run !== undefined ? Boolean(body.dry_run) : true);

	try {
		if (mediaType === "IMAGE") {
			const result = await publishSingleImage(env, {
				postId: postId || undefined,
				storagePath: storagePath || undefined,
				caption: body?.caption,
				options: { prepareOnly },
			});
			return new Response(JSON.stringify(result), {
				status: result.success ? 200 : 400,
				headers: { "Content-Type": "application/json" },
			});
		} else {
			const result = await publishApprovedCarousel(env, postId, { prepareOnly });
			return new Response(JSON.stringify(result), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			});
		}
	} catch (err: any) {
		const message = sanitizeMetaError(err.message || "Failed to publish to Instagram.");
		return new Response(
			JSON.stringify({
				success: false,
				error: "Publishing Failed",
				message,
			}),
			{
				status: 500,
				headers: { "Content-Type": "application/json" },
			}
		);
	}
}
