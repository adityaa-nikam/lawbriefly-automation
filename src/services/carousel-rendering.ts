/**
 * LawBriefly Instagram Carousel Rendering Service
 * Transforms validated ContentGenerationResponse into 1080x1350 PNG images
 * using React static component layout, embedded Montserrat typography,
 * and Cloudflare Browser Run (@cloudflare/puppeteer) in a single browser session.
 */

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import puppeteer from "@cloudflare/puppeteer";
import { zipSync } from "fflate";
import type { Env } from "../index";
import type {
	ContentGenerationResponse,
	CarouselSlideItem,
} from "./content-generation";
import { buildSlideElement, type RenderSlideContext } from "../renderer/slide-builder";
import { MONTSERRAT_BASE64 } from "../renderer/font-data";
import { CANVAS } from "../renderer/tokens";

export interface CarouselValidationResult {
	valid: boolean;
	error?: string;
	message?: string;
	statusCode?: number;
}

export interface RenderManifestSlide {
	slide_number: number;
	slide_role: string;
	filename: string;
	dimensions: {
		width: number;
		height: number;
	};
}

export interface RenderManifest {
	rendered_at: string;
	total_slides: number;
	dimensions: string;
	primary_category?: string;
	topic_title?: string;
	slides: RenderManifestSlide[];
}

/**
 * Validates a content package for rendering.
 * Rejects insufficient_evidence packages, invalid slide counts (< 4 or > 6),
 * malformed slides, and potential script injection.
 */
export function validateContentPackageForRendering(
	data: unknown
): CarouselValidationResult {
	if (!data || typeof data !== "object") {
		return {
			valid: false,
			error: "Bad Request",
			message: "Payload must be a non-null object.",
			statusCode: 400,
		};
	}

	const pkg = data as Partial<ContentGenerationResponse>;

	// Reject packages with insufficient evidence status
	if (pkg.generation_status === "insufficient_evidence") {
		return {
			valid: false,
			error: "Unprocessable Entity",
			message: "Cannot render carousel with insufficient_evidence status.",
			statusCode: 422,
		};
	}

	if (!Array.isArray(pkg.slides)) {
		return {
			valid: false,
			error: "Bad Request",
			message: "Carousel package must include a 'slides' array.",
			statusCode: 400,
		};
	}

	const slideCount = pkg.slides.length;
	if (slideCount < 4 || slideCount > 6) {
		return {
			valid: false,
			error: "Bad Request",
			message: `Carousel package must contain between 4 and 6 slides (received ${slideCount}).`,
			statusCode: 400,
		};
	}

	const validRoles = new Set([
		"cover",
		"what_happened",
		"legal_details",
		"why_it_matters",
		"sources_disclaimer",
		"additional_context",
	]);

	for (let i = 0; i < pkg.slides.length; i++) {
		const slide = pkg.slides[i];
		if (!slide || typeof slide !== "object") {
			return {
				valid: false,
				error: "Bad Request",
				message: `Slide at index ${i} is not a valid object.`,
				statusCode: 400,
			};
		}

		if (slide.slide_number !== i + 1) {
			return {
				valid: false,
				error: "Bad Request",
				message: `Slide at index ${i} has invalid slide_number ${slide.slide_number} (expected ${i + 1}).`,
				statusCode: 400,
			};
		}

		if (!slide.slide_role || !validRoles.has(slide.slide_role)) {
			return {
				valid: false,
				error: "Bad Request",
				message: `Slide ${i + 1} has unrecognized slide_role: '${slide.slide_role}'.`,
				statusCode: 400,
			};
		}

		if (!slide.headline || typeof slide.headline !== "string" || slide.headline.trim().length === 0) {
			return {
				valid: false,
				error: "Bad Request",
				message: `Slide ${i + 1} is missing a non-empty headline string.`,
				statusCode: 400,
			};
		}

		// Security: Reject arbitrary script/html injection attempts in content strings
		const textPayload = JSON.stringify(slide);
		if (/<script/i.test(textPayload) || /javascript:/i.test(textPayload)) {
			return {
				valid: false,
				error: "Bad Request",
				message: `Slide ${i + 1} contains prohibited script tags or URI schemes.`,
				statusCode: 400,
			};
		}
	}

	return { valid: true };
}

/**
 * Generates self-contained HTML for a single slide including base64 Montserrat font definitions
 */
export function generateSlideHtml(
	slide: CarouselSlideItem,
	slideIndex: number,
	totalSlides: number,
	context: RenderSlideContext = {}
): string {
	const reactElement = buildSlideElement(slide, slideIndex, totalSlides, context);
	const renderedMarkup = renderToStaticMarkup(reactElement);

	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="utf-8" />
	<meta name="viewport" content="width=1080, height=1350, initial-scale=1.0" />
	<title>LawBriefly Slide ${slideIndex + 1}</title>
	<style>
		@font-face {
			font-family: 'Montserrat';
			src: url(data:font/ttf;base64,${MONTSERRAT_BASE64.regular}) format('truetype');
			font-weight: 400;
			font-style: normal;
		}
		@font-face {
			font-family: 'Montserrat';
			src: url(data:font/ttf;base64,${MONTSERRAT_BASE64.medium}) format('truetype');
			font-weight: 500;
			font-style: normal;
		}
		@font-face {
			font-family: 'Montserrat';
			src: url(data:font/ttf;base64,${MONTSERRAT_BASE64.semiBold}) format('truetype');
			font-weight: 600;
			font-style: normal;
		}
		@font-face {
			font-family: 'Montserrat';
			src: url(data:font/ttf;base64,${MONTSERRAT_BASE64.bold}) format('truetype');
			font-weight: 700;
			font-style: normal;
		}
		@font-face {
			font-family: 'Montserrat';
			src: url(data:font/ttf;base64,${MONTSERRAT_BASE64.extraBold}) format('truetype');
			font-weight: 800;
			font-style: normal;
		}

		* {
			box-sizing: border-box;
			margin: 0;
			padding: 0;
		}

		html, body {
			width: 1080px;
			height: 1350px;
			overflow: hidden;
			font-family: 'Montserrat', sans-serif;
			-webkit-font-smoothing: antialiased;
			-moz-osx-font-smoothing: grayscale;
			background: #090D16;
		}

		#slide-container {
			width: 1080px;
			height: 1350px;
			position: relative;
			overflow: hidden;
			display: flex;
		}
	</style>
</head>
<body>
	<div id="slide-container">
		${renderedMarkup}
	</div>
</body>
</html>`;
}

/**
 * Formats slide filename for standard packaging
 */
export function getSlideFilename(slideNumber: number, role: string): string {
	const padded = String(slideNumber).padStart(2, "0");
	const slug = role.replace(/_/g, "-");
	return `slide-${padded}-${slug}.png`;
}

/**
 * Renders all slides in a package using Cloudflare Browser Run.
 * Reuses a single browser session for the entire carousel.
 */
export async function renderCarouselWithBrowser(
	contentPackage: ContentGenerationResponse,
	env: Env
): Promise<{ zipBuffer: Uint8Array; manifest: RenderManifest }> {
	if (!env.MYBROWSER) {
		throw new Error("Browser binding MYBROWSER is not available in environment.");
	}

	const totalSlides = contentPackage.slides.length;
	const context: RenderSlideContext = {
		topicTitle: contentPackage.topic?.topic_title,
		legalDomain: contentPackage.topic?.legal_domain,
		sources: contentPackage.source_attributions?.map((s) => ({
			domain: s.source_domain,
			title: s.original_title,
			url: s.original_url,
		})) || [],
		isSingleSource: contentPackage.source_metrics?.source_diversity_status === "single_domain",
	};

	const manifestSlides: RenderManifestSlide[] = [];
	const zipFiles: Record<string, Uint8Array> = {};

	// Launch single browser instance for all slides
	const browser = await puppeteer.launch(env.MYBROWSER);

	try {
		const page = await browser.newPage();
		await page.setViewport({
			width: CANVAS.width,
			height: CANVAS.height,
			deviceScaleFactor: 1,
		});

		// Render slides sequentially
		for (let i = 0; i < totalSlides; i++) {
			const slide = contentPackage.slides[i];
			const filename = getSlideFilename(slide.slide_number, slide.slide_role);
			const html = generateSlideHtml(slide, i, totalSlides, context);

			await page.setContent(html, { waitUntil: "networkidle0" });

			// Verify fonts readiness in DOM
			await page.evaluate("document.fonts.ready");

			// Capture screenshot at exact 1080 x 1350
			const screenshot = (await page.screenshot({
				type: "png",
				clip: {
					x: 0,
					y: 0,
					width: CANVAS.width,
					height: CANVAS.height,
				},
			})) as Uint8Array;

			zipFiles[filename] = screenshot;
			manifestSlides.push({
				slide_number: slide.slide_number,
				slide_role: slide.slide_role,
				filename,
				dimensions: {
					width: CANVAS.width,
					height: CANVAS.height,
				},
			});
		}
	} finally {
		// Browser cleanup is guaranteed on both success and error
		await browser.close();
	}

	const manifest: RenderManifest = {
		rendered_at: new Date().toISOString(),
		total_slides: totalSlides,
		dimensions: `${CANVAS.width}x${CANVAS.height}`,
		primary_category: contentPackage.topic?.legal_domain,
		topic_title: contentPackage.topic?.topic_title,
		slides: manifestSlides,
	};

	zipFiles["manifest.json"] = new TextEncoder().encode(
		JSON.stringify(manifest, null, 2)
	);

	const zipBuffer = zipSync(zipFiles);
	return { zipBuffer, manifest };
}

/**
 * Handles POST /api/ai/render-carousel endpoint
 * Strictly gated to APP_ENV === "development".
 */
export async function handleRenderCarousel(
	request: Request,
	env: Env
): Promise<Response> {
	if (env.APP_ENV !== "development") {
		return new Response(
			JSON.stringify({ error: "Not Found", status: 404 }),
			{ status: 404, headers: { "Content-Type": "application/json" } }
		);
	}

	if (request.method !== "POST") {
		return new Response(
			JSON.stringify({ error: "Method Not Allowed", status: 405 }),
			{ status: 405, headers: { "Content-Type": "application/json" } }
		);
	}

	const contentType = request.headers.get("content-type") || "";
	if (!contentType.includes("application/json")) {
		return new Response(
			JSON.stringify({
				error: "Bad Request",
				message: "Content-Type must be application/json.",
				status: 400,
			}),
			{ status: 400, headers: { "Content-Type": "application/json" } }
		);
	}

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return new Response(
			JSON.stringify({
				error: "Bad Request",
				message: "Malformed JSON body.",
				status: 400,
			}),
			{ status: 400, headers: { "Content-Type": "application/json" } }
		);
	}

	const validation = validateContentPackageForRendering(body);
	if (!validation.valid) {
		const statusCode = validation.statusCode || 400;
		return new Response(
			JSON.stringify({
				error: validation.error || "Bad Request",
				message: validation.message,
				status: statusCode,
			}),
			{
				status: statusCode,
				headers: { "Content-Type": "application/json" },
			}
		);
	}

	const contentPackage = body as ContentGenerationResponse;

	try {
		const { zipBuffer, manifest } = await renderCarouselWithBrowser(
			contentPackage,
			env
		);

		return new Response(zipBuffer, {
			status: 200,
			headers: {
				"Content-Type": "application/zip",
				"Content-Disposition": 'attachment; filename="lawbriefly-carousel.zip"',
				"X-LawBriefly-Slides-Rendered": String(manifest.total_slides),
				"X-LawBriefly-Dimensions": manifest.dimensions,
			},
		});
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : String(err);
		return new Response(
			JSON.stringify({
				error: "Internal Server Error",
				message: `Browser rendering execution failed: ${message}`,
				status: 500,
			}),
			{
				status: 500,
				headers: { "Content-Type": "application/json" },
			}
		);
	}
}
