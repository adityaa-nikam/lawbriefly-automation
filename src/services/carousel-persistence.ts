/**
 * LawBriefly Carousel Persistence Service (Task 15)
 * Persists validated generated carousel images, manifest, and content metadata into Supabase.
 * - Manages storage in the private 'lawbriefly-carousel-assets' bucket.
 * - Idempotently stores posts and asset metadata in PostgreSQL.
 * - Generates temporary signed preview URLs (default 900s / 15 mins).
 * - Enforces zero leakage of signed URLs or credentials into permanent storage.
 */

import type { Env } from "../index";
import { getSupabaseClient } from "./supabase";
import type {
	ContentGenerationResponse,
} from "./content-generation";
import type {
	RenderedCarouselArtifact,
	RenderedSlideArtifact,
} from "./carousel-rendering";

export const CAROUSEL_STORAGE_BUCKET = "lawbriefly-carousel-assets";
export const SIGNED_URL_DEFAULT_EXPIRY_SECONDS = 900; // 15 minutes
export const RENDERER_VERSION = "v2";
export const SUPABASE_STORAGE_MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

export interface PersistedAssetMetadata {
	id?: string;
	post_id: string;
	asset_type: "slide" | "manifest" | "publishing_slide";
	asset_key: string;
	slide_number: number | null;
	storage_bucket: string;
	storage_path: string;
	mime_type: string;
	width: number | null;
	height: number | null;
	size_bytes: number;
	sha256: string;
	signed_url?: string;
	created_at?: string;
}

export interface PersistCarouselResult {
	success: boolean;
	post_id: string;
	post_status: "stored";
	content_fingerprint: string;
	is_duplicate: boolean;
	carousel_slide_count: number;
	storage_bucket: string;
	assets: PersistedAssetMetadata[];
	signed_urls: Record<string, string>;
	signed_urls_expire_seconds: number;
	error?: string;
}

/**
 * Computes SHA-256 hash string for arbitrary binary or string data using standard Web Crypto API.
 */
export async function calculateSha256(data: Uint8Array | string): Promise<string> {
	const buffer = typeof data === "string" ? new TextEncoder().encode(data) : data;
	const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
	const hashArray = Array.from(new Uint8Array(hashBuffer));
	return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Deterministically computes a canonical content fingerprint for duplicate prevention.
 * Canonicalizes topic, slide contents, headlines, captions, hashtags, and renderer version.
 * Excludes transient timestamps to guarantee idempotency.
 */
export async function computeContentFingerprint(
	contentPackage: ContentGenerationResponse,
	rendererVersion = RENDERER_VERSION
): Promise<string> {
	const canonical = {
		renderer_version: rendererVersion,
		topic: {
			candidate_id: contentPackage.topic?.candidate_id || null,
			topic_title: (contentPackage.topic?.topic_title || "").trim().toLowerCase(),
			legal_domain: (contentPackage.topic?.legal_domain || "").trim().toLowerCase(),
			jurisdiction: (contentPackage.topic?.jurisdiction || "").trim().toLowerCase(),
		},
		slides: (contentPackage.slides || []).map((s) => ({
			slide_number: s.slide_number,
			slide_role: s.slide_role,
			headline: (s.headline || "").trim(),
			subtitle: (s.subtitle || "").trim(),
			body_text: (s.body_text || "").trim(),
		})),
		caption: (contentPackage.instagram_caption || "").trim(),
		hashtags: [...(contentPackage.hashtags || [])].sort(),
	};

	const canonicalJson = JSON.stringify(canonical);
	return await calculateSha256(canonicalJson);
}

/**
 * Validates a PNG file's standard magic bytes (89 50 4E 47 0D 0A 1A 0A).
 */
export function isValidPngBuffer(bytes: Uint8Array): boolean {
	if (!bytes || bytes.length < 8) return false;
	return (
		bytes[0] === 0x89 &&
		bytes[1] === 0x50 &&
		bytes[2] === 0x4e &&
		bytes[3] === 0x47 &&
		bytes[4] === 0x0d &&
		bytes[5] === 0x0a &&
		bytes[6] === 0x1a &&
		bytes[7] === 0x0a
	);
}

/**
 * Validates a JPEG file's standard magic bytes (FF D8 ... FF D9).
 */
export function isValidJpegBuffer(bytes: Uint8Array): boolean {
	if (!bytes || bytes.length < 4) return false;
	return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9;
}

/**
 * Extracts dimensions from JPEG SOF markers.
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
 * Validates input parameters for carousel persistence.
 * Enforces evidence requirements, slide counts (4-6), slide order, image dimensions, and PNG signatures.
 */
export function validatePersistenceInput(
	contentPackage: ContentGenerationResponse,
	renderedArtifact: RenderedCarouselArtifact
): { valid: boolean; error?: string } {
	if (!contentPackage || typeof contentPackage !== "object") {
		return { valid: false, error: "Content package must be a non-null object." };
	}

	if (contentPackage.generation_status !== "ready_for_review") {
		return {
			valid: false,
			error: `Cannot persist carousel with generation_status: '${contentPackage.generation_status}'. Must be 'ready_for_review'.`,
		};
	}

	if (contentPackage.evidence?.human_review_required !== true) {
		return {
			valid: false,
			error: "Cannot persist carousel: human_review_required must be strictly true.",
		};
	}

	const slideCount = contentPackage.slides?.length || 0;
	if (slideCount < 4 || slideCount > 6) {
		return {
			valid: false,
			error: `Carousel package must contain between 4 and 6 slides (received ${slideCount}).`,
		};
	}

	if (!renderedArtifact || !Array.isArray(renderedArtifact.slides)) {
		return {
			valid: false,
			error: "Rendered artifact must include a slides array.",
		};
	}

	if (renderedArtifact.slides.length !== slideCount) {
		return {
			valid: false,
			error: `Slide count mismatch: content package has ${slideCount} slides but rendered artifact has ${renderedArtifact.slides.length} slides.`,
		};
	}

	// Validate slide sequential order, dimensions, and image magic bytes
	for (let i = 0; i < renderedArtifact.slides.length; i++) {
		const slide = renderedArtifact.slides[i];
		const expectedSlideNum = i + 1;
		if (slide.slide_number !== expectedSlideNum) {
			return {
				valid: false,
				error: `Slide ordering mismatch at index ${i}: expected slide_number ${expectedSlideNum}, got ${slide.slide_number}.`,
			};
		}

		if (slide.width !== 1080 || slide.height !== 1350) {
			return {
				valid: false,
				error: `Slide ${slide.slide_number} has invalid dimensions: ${slide.width}x${slide.height} (expected 1080x1350).`,
			};
		}

		if (slide.mime_type !== "image/png") {
			return {
				valid: false,
				error: `Slide ${slide.slide_number} has invalid mime_type: '${slide.mime_type}' (expected 'image/png').`,
			};
		}

		if (slide.bytes.length > SUPABASE_STORAGE_MAX_FILE_SIZE_BYTES) {
			return {
				valid: false,
				error: `Slide ${slide.slide_number} PNG size (${slide.bytes.length} bytes) exceeds Supabase storage limit of 5 MB.`,
			};
		}

		if (!isValidPngBuffer(slide.bytes)) {
			return {
				valid: false,
				error: `Slide ${slide.slide_number} does not contain a valid PNG signature.`,
			};
		}

		// Validate dual-format JPEG if present
		if (slide.jpeg_bytes) {
			if (slide.jpeg_bytes.length > SUPABASE_STORAGE_MAX_FILE_SIZE_BYTES) {
				return {
					valid: false,
					error: `Slide ${slide.slide_number} JPEG size (${slide.jpeg_bytes.length} bytes) exceeds Supabase storage limit of 5 MB.`,
				};
			}

			if (!isValidJpegBuffer(slide.jpeg_bytes)) {
				return {
					valid: false,
					error: `Slide ${slide.slide_number} does not contain a valid JPEG signature.`,
				};
			}

			const jpegDims = getJpegDimensions(slide.jpeg_bytes);
			if (!jpegDims || jpegDims.width !== 1080 || jpegDims.height !== 1350) {
				return {
					valid: false,
					error: `Slide ${slide.slide_number} JPEG has invalid dimensions: ${jpegDims?.width}x${jpegDims?.height} (expected 1080x1350).`,
				};
			}
		}
	}

	// Validate manifest
	if (!renderedArtifact.manifestBytes || renderedArtifact.manifestBytes.length === 0) {
		return { valid: false, error: "Rendered artifact manifest is empty or missing." };
	}

	return { valid: true };
}

/**
 * Persists a rendered carousel and its complete content package into Supabase Storage and PostgreSQL.
 * Guarantees idempotency via SHA-256 fingerprint, performs staged uploads with cleanup compensation,
 * and generates short-lived signed preview URLs.
 */
export async function persistRenderedCarousel(
	env: Env,
	contentPackage: ContentGenerationResponse,
	renderedArtifact: RenderedCarouselArtifact,
	signedUrlExpirySeconds = SIGNED_URL_DEFAULT_EXPIRY_SECONDS
): Promise<PersistCarouselResult> {
	// 1. Validate inputs
	const validation = validatePersistenceInput(contentPackage, renderedArtifact);
	if (!validation.valid) {
		throw new Error(validation.error);
	}

	const supabase = getSupabaseClient(env);
	const fingerprint = await computeContentFingerprint(contentPackage, RENDERER_VERSION);

	// 2. Idempotency Check: check if post already exists
	const { data: existingPosts, error: checkError } = await supabase
		.from("social_content_posts")
		.select("id, post_status, carousel_slide_count")
		.eq("content_fingerprint", fingerprint)
		.limit(1);

	if (checkError) {
		throw new Error(`Database error checking existing post: ${checkError.message}`);
	}

	const existingPost = existingPosts && existingPosts.length > 0 ? existingPosts[0] : null;

	if (existingPost) {
		// If post already stored successfully, return existing post without duplicating uploads
		if (existingPost.post_status === "stored") {
			const { data: existingAssets, error: assetsError } = await supabase
				.from("social_content_assets")
				.select("*")
				.eq("post_id", existingPost.id)
				.order("slide_number", { ascending: true, nullsFirst: false });

			if (assetsError) {
				throw new Error(`Database error fetching existing assets: ${assetsError.message}`);
			}

			// Generate fresh signed URLs for existing assets
			const signedUrls: Record<string, string> = {};
			const assetsWithSignedUrls: PersistedAssetMetadata[] = [];

			for (const asset of existingAssets || []) {
				const { data: signedData, error: signError } = await supabase.storage
					.from(asset.storage_bucket)
					.createSignedUrl(asset.storage_path, signedUrlExpirySeconds);

				const signedUrl = !signError && signedData?.signedUrl ? signedData.signedUrl : "";
				if (signedUrl) {
					signedUrls[asset.asset_key] = signedUrl;
				}

				assetsWithSignedUrls.push({
					...asset,
					signed_url: signedUrl,
				});
			}

			return {
				success: true,
				post_id: existingPost.id,
				post_status: "stored",
				content_fingerprint: fingerprint,
				is_duplicate: true,
				carousel_slide_count: existingPost.carousel_slide_count,
				storage_bucket: CAROUSEL_STORAGE_BUCKET,
				assets: assetsWithSignedUrls,
				signed_urls: signedUrls,
				signed_urls_expire_seconds: signedUrlExpirySeconds,
			};
		}

		// If post is actively being stored by another process, prevent duplicate race
		if (existingPost.post_status === "storing") {
			throw new Error("A persistence operation for this content is currently in progress. Please retry shortly.");
		}

		// If post previously failed storage, allow controlled retry by resetting status to 'storing'
		if (existingPost.post_status === "storage_failed") {
			const { error: resetError } = await supabase
				.from("social_content_posts")
				.update({ post_status: "storing", updated_at: new Date().toISOString() })
				.eq("id", existingPost.id);

			if (resetError) {
				throw new Error(`Failed to reset failed post status for retry: ${resetError.message}`);
			}
		}
	}

	// 3. Create or claim post record in 'storing' status
	let postId = existingPost?.id;
	if (!postId) {
		const newPostPayload = {
			content_fingerprint: fingerprint,
			candidate_id: contentPackage.topic?.candidate_id || null,
			topic_title: contentPackage.topic?.topic_title,
			legal_domain: contentPackage.topic?.legal_domain || "general_law",
			jurisdiction: contentPackage.topic?.jurisdiction || "India",
			generation_status: contentPackage.generation_status,
			post_status: "storing",
			carousel_slide_count: contentPackage.slides.length,
			instagram_caption: contentPackage.instagram_caption,
			hashtags: contentPackage.hashtags || [],
			content_package: contentPackage,
			source_metrics: contentPackage.source_metrics || {},
			source_attributions: contentPackage.source_attributions || [],
			render_manifest: renderedArtifact.manifest,
			renderer_version: RENDERER_VERSION,
			human_review_required: true,
		};

		const { data: insertedPost, error: insertError } = await supabase
			.from("social_content_posts")
			.insert(newPostPayload)
			.select("id")
			.single();

		if (insertError || !insertedPost) {
			throw new Error(`Database error creating post record: ${insertError?.message || "Unknown error"}`);
		}

		postId = insertedPost.id;
	}

	// 4. Staged Storage Uploads with Compensation Tracking
	const newlyUploadedPaths: string[] = [];

	try {
		// Upload slides sequentially (both PNG and pre-generated JPEG)
		for (const slide of renderedArtifact.slides) {
			const slidePadded = String(slide.slide_number).padStart(2, "0");
			const pngStoragePath = `posts/${postId}/slide-${slidePadded}.png`;

			const { error: uploadError } = await supabase.storage
				.from(CAROUSEL_STORAGE_BUCKET)
				.upload(pngStoragePath, slide.bytes, {
					contentType: "image/png",
					upsert: true,
				});

			if (uploadError) {
				throw new Error(`Failed to upload slide ${slide.slide_number} PNG to storage: ${uploadError.message}`);
			}

			newlyUploadedPaths.push(pngStoragePath);

			// Upload pre-generated JPEG if present
			if (slide.jpeg_bytes) {
				const jpegStoragePath = `posts/${postId}/publishing/slide-${slidePadded}.jpg`;
				const { error: jpegUploadError } = await supabase.storage
					.from(CAROUSEL_STORAGE_BUCKET)
					.upload(jpegStoragePath, slide.jpeg_bytes, {
						contentType: "image/jpeg",
						upsert: true,
					});

				if (jpegUploadError) {
					throw new Error(`Failed to upload slide ${slide.slide_number} JPEG to storage: ${jpegUploadError.message}`);
				}

				newlyUploadedPaths.push(jpegStoragePath);
			}
		}

		// Upload manifest.json
		const manifestStoragePath = `posts/${postId}/manifest.json`;
		const { error: manifestUploadError } = await supabase.storage
			.from(CAROUSEL_STORAGE_BUCKET)
			.upload(manifestStoragePath, renderedArtifact.manifestBytes, {
				contentType: "application/json",
				upsert: true,
			});

		if (manifestUploadError) {
			throw new Error(`Failed to upload manifest.json to storage: ${manifestUploadError.message}`);
		}

		newlyUploadedPaths.push(manifestStoragePath);

		// 5. Build and insert asset metadata records
		const assetRows: any[] = [];

		for (const slide of renderedArtifact.slides) {
			const slidePadded = String(slide.slide_number).padStart(2, "0");
			const pngStoragePath = `posts/${postId}/slide-${slidePadded}.png`;
			const checksum = await calculateSha256(slide.bytes);

			assetRows.push({
				post_id: postId,
				asset_type: "slide",
				asset_key: `slide-${slidePadded}`,
				slide_number: slide.slide_number,
				storage_bucket: CAROUSEL_STORAGE_BUCKET,
				storage_path: pngStoragePath,
				mime_type: "image/png",
				width: slide.width,
				height: slide.height,
				size_bytes: slide.bytes.length,
				sha256: checksum,
			});

			// Insert publishing_slide record for JPEG
			if (slide.jpeg_bytes) {
				const jpegStoragePath = `posts/${postId}/publishing/slide-${slidePadded}.jpg`;
				const jpegChecksum = await calculateSha256(slide.jpeg_bytes);

				assetRows.push({
					post_id: postId,
					asset_type: "publishing_slide",
					asset_key: `slide-${slidePadded}-jpeg`,
					slide_number: slide.slide_number,
					storage_bucket: CAROUSEL_STORAGE_BUCKET,
					storage_path: jpegStoragePath,
					mime_type: "image/jpeg",
					width: slide.width,
					height: slide.height,
					size_bytes: slide.jpeg_bytes.length,
					sha256: jpegChecksum,
				});
			}
		}

		const manifestChecksum = await calculateSha256(renderedArtifact.manifestBytes);
		assetRows.push({
			post_id: postId,
			asset_type: "manifest",
			asset_key: "manifest",
			slide_number: null,
			storage_bucket: CAROUSEL_STORAGE_BUCKET,
			storage_path: manifestStoragePath,
			mime_type: "application/json",
			width: null,
			height: null,
			size_bytes: renderedArtifact.manifestBytes.length,
			sha256: manifestChecksum,
		});

		// Clean up any stale asset records for this post before inserting
		await supabase.from("social_content_assets").delete().eq("post_id", postId);

		const { data: insertedAssets, error: assetInsertError } = await supabase
			.from("social_content_assets")
			.insert(assetRows)
			.select("*");

		if (assetInsertError || !insertedAssets) {
			throw new Error(`Failed to insert asset records into database: ${assetInsertError?.message || "Unknown error"}`);
		}

		// 6. Mark Post Stored upon 100% completion
		const completedAt = new Date().toISOString();
		const { error: markStoredError } = await supabase
			.from("social_content_posts")
			.update({
				post_status: "stored",
				storage_completed_at: completedAt,
				render_manifest: renderedArtifact.manifest,
				updated_at: completedAt,
			})
			.eq("id", postId);

		if (markStoredError) {
			throw new Error(`Failed to update post status to 'stored': ${markStoredError.message}`);
		}

		// 7. Generate temporary signed preview URLs for verification
		const signedUrls: Record<string, string> = {};
		const finalAssets: PersistedAssetMetadata[] = [];

		for (const asset of insertedAssets) {
			const { data: signedData, error: signError } = await supabase.storage
				.from(CAROUSEL_STORAGE_BUCKET)
				.createSignedUrl(asset.storage_path, signedUrlExpirySeconds);

			const signedUrl = !signError && signedData?.signedUrl ? signedData.signedUrl : "";
			if (signedUrl) {
				signedUrls[asset.asset_key] = signedUrl;
			}

			finalAssets.push({
				...asset,
				signed_url: signedUrl,
			});
		}

		return {
			success: true,
			post_id: postId,
			post_status: "stored",
			content_fingerprint: fingerprint,
			is_duplicate: false,
			carousel_slide_count: contentPackage.slides.length,
			storage_bucket: CAROUSEL_STORAGE_BUCKET,
			assets: finalAssets,
			signed_urls: signedUrls,
			signed_urls_expire_seconds: signedUrlExpirySeconds,
		};
	} catch (err: any) {
		// Partial failure compensation cleanup
		let cleanupErrorMsg = "";
		if (newlyUploadedPaths.length > 0) {
			try {
				await supabase.storage.from(CAROUSEL_STORAGE_BUCKET).remove(newlyUploadedPaths);
			} catch (cleanErr: any) {
				cleanupErrorMsg = ` (Compensation cleanup failed for: ${newlyUploadedPaths.join(", ")})`;
			}
		}

		// Mark post as storage_failed
		try {
			await supabase
				.from("social_content_posts")
				.update({
					post_status: "storage_failed",
					updated_at: new Date().toISOString(),
				})
				.eq("id", postId);
		} catch {
			// Best effort failure logging
		}

		throw new Error(`Carousel persistence failed: ${err.message}${cleanupErrorMsg}`);
	}
}

/**
 * Retrieves a stored carousel by its UUID, including fresh signed preview URLs.
 */
export async function getStoredCarouselById(
	env: Env,
	postId: string,
	signedUrlExpirySeconds = SIGNED_URL_DEFAULT_EXPIRY_SECONDS
): Promise<{
	post: any;
	assets: PersistedAssetMetadata[];
	signed_urls: Record<string, string>;
}> {
	const supabase = getSupabaseClient(env);

	const { data: post, error: postError } = await supabase
		.from("social_content_posts")
		.select("*")
		.eq("id", postId)
		.single();

	if (postError || !post) {
		throw new Error(`Stored carousel post not found: ${postId}`);
	}

	const { data: assets, error: assetsError } = await supabase
		.from("social_content_assets")
		.select("*")
		.eq("post_id", postId)
		.order("slide_number", { ascending: true, nullsFirst: false });

	if (assetsError) {
		throw new Error(`Failed to retrieve assets for post ${postId}: ${assetsError.message}`);
	}

	const signedUrls: Record<string, string> = {};
	const assetsWithSignedUrls: PersistedAssetMetadata[] = [];

	for (const asset of assets || []) {
		const { data: signedData, error: signError } = await supabase.storage
			.from(asset.storage_bucket)
			.createSignedUrl(asset.storage_path, signedUrlExpirySeconds);

		const signedUrl = !signError && signedData?.signedUrl ? signedData.signedUrl : "";
		if (signedUrl) {
			signedUrls[asset.asset_key] = signedUrl;
		}

		assetsWithSignedUrls.push({
			...asset,
			signed_url: signedUrl,
		});
	}

	return {
		post,
		assets: assetsWithSignedUrls,
		signed_urls: signedUrls,
	};
}

/**
 * Handles POST /api/ai/store-carousel endpoint.
 * Development-only endpoint to render a validated content package and persist it into Supabase Storage.
 */
export async function handleStoreCarousel(
	request: Request,
	env: Env
): Promise<Response> {
	// Gating: strictly development-only
	if (env.APP_ENV !== "development") {
		return new Response(
			JSON.stringify({ error: "Not Found", status: 404 }),
			{ status: 404, headers: { "Content-Type": "application/json" } }
		);
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

	if (!body || typeof body !== "object") {
		return new Response(
			JSON.stringify({ error: "Bad Request", message: "Payload must be a non-null object." }),
			{ status: 400, headers: { "Content-Type": "application/json" } }
		);
	}

	// Reject unexpected top-level properties
	const allowedKeys = new Set(["content_package"]);
	const keys = Object.keys(body);
	const unexpected = keys.filter((k) => !allowedKeys.has(k));
	if (unexpected.length > 0) {
		return new Response(
			JSON.stringify({
				error: "Bad Request",
				message: `Unexpected payload properties: ${unexpected.join(", ")}. Only 'content_package' is permitted.`,
			}),
			{ status: 400, headers: { "Content-Type": "application/json" } }
		);
	}

	const contentPackage = body.content_package;
	if (!contentPackage || typeof contentPackage !== "object") {
		return new Response(
			JSON.stringify({ error: "Bad Request", message: "Missing required 'content_package' object." }),
			{ status: 400, headers: { "Content-Type": "application/json" } }
		);
	}

	// Reject insufficient evidence
	if (contentPackage.generation_status === "insufficient_evidence") {
		return new Response(
			JSON.stringify({
				error: "Unprocessable Entity",
				message: "Cannot persist carousel with insufficient_evidence status.",
			}),
			{ status: 422, headers: { "Content-Type": "application/json" } }
		);
	}

	if (contentPackage.generation_status !== "ready_for_review") {
		return new Response(
			JSON.stringify({
				error: "Bad Request",
				message: `Invalid generation_status: '${contentPackage.generation_status}'. Must be 'ready_for_review'.`,
			}),
			{ status: 400, headers: { "Content-Type": "application/json" } }
		);
	}

	try {
		// Import renderCarouselArtifacts dynamically to avoid circular references
		const { renderCarouselArtifacts } = await import("./carousel-rendering");

		// 1. Render slides through trusted renderer (strictly once)
		const renderedArtifact = await renderCarouselArtifacts(contentPackage, env);

		// 2. Persist into Supabase Storage and PostgreSQL
		const persistResult = await persistRenderedCarousel(env, contentPackage, renderedArtifact);

		return new Response(JSON.stringify(persistResult), {
			status: 200,
			headers: { "Content-Type": "application/json" },
		});
	} catch (err: any) {
		const message = err.message || "Internal server error";
		const statusCode = message.includes("in progress") ? 409 : 500;

		return new Response(
			JSON.stringify({
				success: false,
				error: statusCode === 409 ? "Conflict" : "Internal Server Error",
				message,
			}),
			{
				status: statusCode,
				headers: { "Content-Type": "application/json" },
			}
		);
	}
}
