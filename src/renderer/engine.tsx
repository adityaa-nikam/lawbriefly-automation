import React from "react";
import satori from "satori";
import { Resvg } from "@resvg/resvg-js";
import fs from "fs";
import path from "path";
import { CANVAS } from "./tokens";
import { loadBundledFonts } from "./assets";
import { CoverSlide } from "./components/CoverSlide";
import { WhatHappenedSlide } from "./components/WhatHappenedSlide";
import { LegalDetailsSlide } from "./components/LegalDetailsSlide";
import { WhyItMattersSlide } from "./components/WhyItMattersSlide";
import { SourcesDisclaimerSlide } from "./components/SourcesDisclaimerSlide";
import type { CarouselSlideItem, ContentGenerationResponse } from "../services/content-generation";

import {
	buildSlideElement,
	type RenderSlideContext,
	getDomainKicker,
} from "./slide-builder";

export { buildSlideElement, type RenderSlideContext, getDomainKicker };

export interface RenderResult {
	slideNumber: number;
	slideRole: string;
	svg: string;
	pngBuffer: Buffer;
	width: number;
	height: number;
	sizeBytes: number;
}

export interface CarouselRenderOutput {
	success: boolean;
	totalSlides: number;
	slides: RenderResult[];
	outputDirectory?: string;
	validation: {
		allDimensionsValid: boolean;
		allFilesNonEmpty: boolean;
		allFontsLoaded: boolean;
		overflowDetected: boolean;
		details: string[];
	};
}

/**
 * Renders a single carousel slide to SVG string using Satori and bundled Montserrat fonts
 */
export async function renderSlideToSvg(
	slide: CarouselSlideItem,
	slideIndex: number,
	totalSlides: number,
	context: RenderSlideContext = {}
): Promise<string> {
	const fonts = loadBundledFonts();
	const element = buildSlideElement(slide, slideIndex, totalSlides, context);

	const svg = await satori(element, {
		width: CANVAS.width,
		height: CANVAS.height,
		fonts: fonts.map((f) => ({
			name: f.name,
			data: f.data,
			weight: f.weight,
			style: f.style,
		})),
	});

	return svg;
}

/**
 * Renders a single carousel slide to pixel-perfect PNG buffer
 */
export async function renderSlideToPng(
	slide: CarouselSlideItem,
	slideIndex: number,
	totalSlides: number,
	context: RenderSlideContext = {}
): Promise<RenderResult> {
	const svg = await renderSlideToSvg(slide, slideIndex, totalSlides, context);
	const resvg = new Resvg(svg, {
		fitTo: { mode: "width", value: CANVAS.width },
		font: { loadSystemFonts: false },
	});

	const rendered = resvg.render();
	const pngBuffer = rendered.asPng();

	const width = rendered.width;
	const height = rendered.height;
	const sizeBytes = pngBuffer.length;

	// Validate target dimensions
	if (width !== CANVAS.width || height !== CANVAS.height) {
		throw new Error(
			`Rendered PNG dimension mismatch: expected ${CANVAS.width}x${CANVAS.height}, got ${width}x${height}`
		);
	}

	if (sizeBytes < 1000) {
		throw new Error(`Rendered PNG buffer unexpectedly small (${sizeBytes} bytes) for slide ${slideIndex + 1}`);
	}

	return {
		slideNumber: slide.slide_number || slideIndex + 1,
		slideRole: slide.slide_role || "what_happened",
		svg,
		pngBuffer,
		width,
		height,
		sizeBytes,
	};
}

/**
 * Renders an entire Carousel content package to high-resolution PNGs
 */
export async function renderCarouselToPngs(
	contentPackage: ContentGenerationResponse,
	outputDir?: string
): Promise<CarouselRenderOutput> {
	if (!contentPackage.slides || contentPackage.slides.length === 0) {
		throw new Error("Cannot render carousel: Content package has 0 slides.");
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

	const results: RenderResult[] = [];
	const validationDetails: string[] = [];
	let allDimensionsValid = true;
	let allFilesNonEmpty = true;
	let overflowDetected = false;

	if (outputDir && !fs.existsSync(outputDir)) {
		fs.mkdirSync(outputDir, { recursive: true });
	}

	for (let i = 0; i < totalSlides; i++) {
		const slide = contentPackage.slides[i];
		const result = await renderSlideToPng(slide, i, totalSlides, context);
		results.push(result);

		if (result.width !== CANVAS.width || result.height !== CANVAS.height) {
			allDimensionsValid = false;
			validationDetails.push(`Slide ${result.slideNumber}: Dimension error ${result.width}x${result.height}`);
		}

		if (result.sizeBytes < 10000) {
			allFilesNonEmpty = false;
			validationDetails.push(`Slide ${result.slideNumber}: File size suspiciously small (${result.sizeBytes} bytes)`);
		}

		// Text fit & overflow inspection (exclude data URLs where 'NaN' can legitimately appear in base64)
		const svgWithoutDataUrls = result.svg.replace(/data:image\/[^;]+;base64,[A-Za-z0-9+/=]+/g, "");
		if (svgWithoutDataUrls.includes("NaN") || svgWithoutDataUrls.includes("undefined")) {
			overflowDetected = true;
			validationDetails.push(`Slide ${result.slideNumber}: SVG contains invalid numeric coordinates.`);
		}

		// Save to disk if output directory specified
		if (outputDir) {
			const filename = `slide-${String(result.slideNumber).padStart(2, "0")}.png`;
			const filePath = path.join(outputDir, filename);
			fs.writeFileSync(filePath, result.pngBuffer);
			validationDetails.push(`Saved ${filename} (${Math.round(result.sizeBytes / 1024)} KB)`);
		}
	}

	return {
		success: allDimensionsValid && allFilesNonEmpty && !overflowDetected,
		totalSlides: results.length,
		slides: results,
		outputDirectory: outputDir,
		validation: {
			allDimensionsValid,
			allFilesNonEmpty,
			allFontsLoaded: true,
			overflowDetected,
			details: validationDetails,
		},
	};
}
