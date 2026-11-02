// Brand Assets, Icons & Font Loader for LawBriefly Carousel Renderer
import React from "react";
import fs from "fs";
import path from "path";

export interface FontDescriptor {
	name: string;
	data: Buffer;
	weight: 400 | 500 | 600 | 700 | 800;
	style: "normal" | "italic";
}

let cachedFonts: FontDescriptor[] | null = null;

/**
 * Loads and verifies bundled Montserrat font assets.
 * Throws if font files are missing or empty to prevent unverified system fallbacks.
 */
export function loadBundledFonts(baseDir = process.cwd()): FontDescriptor[] {
	if (cachedFonts) return cachedFonts;

	const fontsDir = path.resolve(baseDir, "assets", "fonts");
	const requiredWeights: { file: string; weight: 400 | 500 | 600 | 700 | 800 }[] = [
		{ file: "Montserrat-Regular.ttf", weight: 400 },
		{ file: "Montserrat-Medium.ttf", weight: 500 },
		{ file: "Montserrat-SemiBold.ttf", weight: 600 },
		{ file: "Montserrat-Bold.ttf", weight: 700 },
		{ file: "Montserrat-ExtraBold.ttf", weight: 800 },
	];

	const fonts: FontDescriptor[] = [];

	for (const req of requiredWeights) {
		const filePath = path.join(fontsDir, req.file);
		if (!fs.existsSync(filePath)) {
			throw new Error(`Bundled font asset missing: ${filePath}. Cannot fallback to system fonts.`);
		}
		const buf = fs.readFileSync(filePath);
		if (buf.length < 1000) {
			throw new Error(`Bundled font asset corrupted or empty: ${filePath}`);
		}
		fonts.push({
			name: "Montserrat",
			data: buf,
			weight: req.weight,
			style: "normal",
		});
	}

	cachedFonts = fonts;
	return fonts;
}

/**
 * Loads an asset from assets/brand as a base64 Data URL.
 */
export function getBrandAssetDataUrl(filename: string, baseDir = process.cwd()): string {
	const filePath = path.resolve(baseDir, "assets", "brand", filename);
	if (!fs.existsSync(filePath)) {
		throw new Error(`Brand asset file missing: ${filePath}`);
	}
	const ext = path.extname(filename).toLowerCase().replace(".", "");
	const mime = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : "image/png";
	const buf = fs.readFileSync(filePath);
	return `data:${mime};base64,${buf.toString("base64")}`;
}

/**
 * Crisp Vector SVG of LawBriefly LB Monogram
 * Based on the authoritative brand monogram:
 * Seamless interlocking of 'L' and 'B' with fluid negative space wave connecting them.
 */
export function getLbMonogramSvg(color = "#FFFFFF", size = 48): React.ReactElement {
	return (
		<svg width={size} height={size} viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
			<path
				d="M20 18C20 13.58 23.58 10 28 10H44C48.42 10 52 13.58 52 18V60C52 68.84 44.84 76 36 76H28C23.58 76 20 72.42 20 68V18Z"
				fill={color}
			/>
			<path
				d="M54 10H68C76.84 10 84 17.16 84 26C84 32.5 80.12 38.1 74.5 40.5C81.4 43.2 86 50.1 86 58C86 67.94 77.94 76 68 76H46C42 76 40 73 40 69C40 63 47 61 51 57C56 52 56 46 56 42V10H54Z"
				fill={color}
			/>
			<path
				d="M20 66C20 74.84 27.16 82 36 82H58C73.46 82 86 69.46 86 54C86 52 85.8 50 85.3 48.2C82 58 73 65 62 65H42C33.16 65 26 57.84 26 49V66H20Z"
				fill={color}
				opacity={0.95}
			/>
		</svg>
	);
}

/**
 * Crisp Vector SVG of LawBriefly Balanced Justice Scale Icon
 * Perfectly matches Balanced Justice Scale Icon.png with sharp vector edges.
 */
export function getJusticeScalesSvg(color = "#C5A880", size = 48): React.ReactElement {
	return (
		<svg width={size} height={size} viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
			<circle cx="50" cy="14" r="5.5" fill={color} />
			<circle cx="50" cy="27" r="4" fill={color} />
			<path d="M47 31H53L55 78H45L47 31Z" fill={color} />
			<rect x="42" y="78" width="16" height="4" rx="1" fill={color} />
			<rect x="36" y="82" width="28" height="4" rx="1" fill={color} />
			<rect x="30" y="86" width="40" height="5" rx="1.5" fill={color} />
			<path
				d="M20 28C32 25 42 26 50 26C58 26 68 25 80 28C81.5 28.4 82 29.8 81.5 31C81 32.2 79.8 32.8 78.5 32.5C68 30 58 31 50 31C42 31 32 30 21.5 32.5C20.2 32.8 19 32.2 18.5 31C18 29.8 18.5 28.4 20 28Z"
				fill={color}
			/>
			<circle cx="20" cy="29" r="4.5" fill={color} />
			<line x1="20" y1="33" x2="10" y2="58" stroke={color} strokeWidth="2.5" />
			<line x1="20" y1="33" x2="30" y2="58" stroke={color} strokeWidth="2.5" />
			<path d="M8 58H32C32 66 26.6 72 20 72C13.4 72 8 66 8 58Z" fill={color} />
			<circle cx="80" cy="29" r="4.5" fill={color} />
			<line x1="80" y1="33" x2="70" y2="58" stroke={color} strokeWidth="2.5" />
			<line x1="80" y1="33" x2="90" y2="58" stroke={color} strokeWidth="2.5" />
			<path d="M68 58H92C92 66 86.6 72 80 72C73.4 72 68 66 68 58Z" fill={color} />
		</svg>
	);
}

/**
 * Returns SVG for allowlist visual elements
 */
export function getVisualElementSvg(elementName: string, color = "#C5A880", size = 36): React.ReactElement | null {
	switch (elementName) {
		case "scales":
			return getJusticeScalesSvg(color, size);
		case "monogram":
			return getLbMonogramSvg(color, size);
		case "gavel":
			return (
				<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
					<path d="m14 13-7.5 7.5c-.8.8-2 .8-2.8 0s-.8-2 0-2.8L11 10" />
					<path d="m16 16 6-6" />
					<path d="m8 8 6-6" />
					<path d="m9 7 8 8" />
					<path d="m21 11-8-8" />
				</svg>
			);
		case "courthouse":
			return (
				<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
					<path d="m2 9 10-5 10 5v2H2z" />
					<line x1="6" y1="11" x2="6" y2="19" />
					<line x1="10" y1="11" x2="10" y2="19" />
					<line x1="14" y1="11" x2="14" y2="19" />
					<line x1="18" y1="11" x2="18" y2="19" />
					<path d="M2 19h20" />
					<path d="M1 22h22" />
				</svg>
			);
		case "document":
			return (
				<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
					<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
					<polyline points="14 2 14 8 20 8" />
					<line x1="16" y1="13" x2="8" y2="13" />
					<line x1="16" y1="17" x2="8" y2="17" />
				</svg>
			);
		case "shield":
			return (
				<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
					<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
					<path d="m9 12 2 2 4-4" />
				</svg>
			);
		case "timeline":
		case "calendar":
			return (
				<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
					<rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
					<line x1="16" y1="2" x2="16" y2="6" />
					<line x1="8" y1="2" x2="8" y2="6" />
					<line x1="3" y1="10" x2="21" y2="10" />
				</svg>
			);
		case "rupee":
			return (
				<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
					<path d="M6 3h12" />
					<path d="M6 8h12" />
					<path d="m6 13 8.5 8" />
					<path d="M6 13h3a4 4 0 0 0 0-8" />
				</svg>
			);
		case "chart":
			return (
				<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
					<line x1="18" y1="20" x2="18" y2="10" />
					<line x1="12" y1="20" x2="12" y2="4" />
					<line x1="6" y1="20" x2="6" y2="14" />
					<line x1="2" y1="20" x2="22" y2="20" />
				</svg>
			);
		default:
			// Fallback to authoritative justice scales
			return getJusticeScalesSvg(color, size);
	}
}

/**
 * Convenience alias for getVisualElementSvg
 */
export const getIconSvg = getVisualElementSvg;

/**
 * Authoritative brand assets inventory
 */
export const BRAND_ASSETS = {
	logo: "Minimalist LawBriefly Logo (1).png",
	monogramBanner: "LB-FINAL.png",
	scalesIcon: "Balanced Justice Scale Icon.png",
	linkedinBanner: "lawbriefly-linkdln-banner1.jpg",
	legalLearningBanner: "Minimal Legal Learning Banner.png",
	fonts: {
		regular: "Montserrat-Regular.ttf",
		medium: "Montserrat-Medium.ttf",
		semiBold: "Montserrat-SemiBold.ttf",
		bold: "Montserrat-Bold.ttf",
		extraBold: "Montserrat-ExtraBold.ttf",
	},
} as const;
