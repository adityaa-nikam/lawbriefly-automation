// Centralized Design Tokens for LawBriefly Instagram Carousel Renderer
// Canvas Target: 1080 x 1350 px (4:5 Portrait Aspect Ratio)

export const CANVAS = {
	width: 1080,
	height: 1350,
	aspectRatio: "4:5",
	paddingHorizontal: 80,
	paddingVertical: 80,
	cardRadius: 24,
	badgeRadius: 999,
	borderWidth: 1.5,
	// Extended Layout Tokens
	innerPadding: 32,
	gapLarge: 28,
	gapMedium: 20,
	gapSmall: 12,
} as const;

export const COLORS = {
	// Deep Foundations (Cover & Dark Authority Slides)
	brandDark: "#090D16", // Deep Midnight Obsidian
	brandDarkDeep: "#050810", // Ultra-Deep Contrast Foundation
	brandDarkNavy: "#0B1528", // Rich Editorial Authority Navy
	brandDarkElevated: "#121824", // Elevated Card Surface on Dark
	brandDarkCard: "#161F30", // Card Surface with subtle blue tint
	brandDarkBorder: "#1E293B", // Border on Dark
	brandDarkSubtleBorder: "rgba(255, 255, 255, 0.08)",

	// Light Foundations (Editorial Light Slides)
	brandLight: "#F8F9FA", // Clean Alabaster / Warm White Foundation
	brandIvory: "#FBFBFE", // Pristine Swiss Editorial Surface
	brandLightElevated: "#FFFFFF", // Crisp White Card Surface
	brandLightCardMuted: "#F1F5F9", // Muted Card Surface
	brandLightBorder: "#E2E8F0", // Border on Light
	brandLightBorderStrong: "#CBD5E1",

	// Authoritative Brand Colors
	brandNavy: "#0B2545", // Primary LawBriefly Authority Navy
	brandNavyAccent: "#133E87", // Lighter Legal Navy Accent
	brandNavySurface: "rgba(11, 37, 69, 0.08)", // Tinted Navy Surface
	brandNavySoft: "rgba(11, 37, 69, 0.04)",

	// Editorial Accent Colors
	brandGold: "#C5A880", // Warm Editorial Gold / Ochre
	brandGoldLight: "#E8DCB8", // Subtle Gold Highlight
	brandGoldDeep: "#A88B60", // Deep Burnished Gold
	brandGoldMuted: "rgba(197, 168, 128, 0.15)", // Gold tint for badges/accents
	brandGoldBorder: "rgba(197, 168, 128, 0.4)", // Refined Gold Border
	brandGoldGlow: "rgba(197, 168, 128, 0.25)",

	// Secondary Semantic Accents
	accentEmerald: "#059669", // Approved / Voluntary Compliance
	accentEmeraldMuted: "rgba(5, 150, 105, 0.12)",
	accentEmeraldDeep: "#047857",
	accentEmeraldBorder: "rgba(5, 150, 105, 0.28)",

	accentCrimson: "#BE123C", // Criminal Liability / Penalty / Arrest Powers
	accentCrimsonMuted: "rgba(190, 18, 60, 0.12)",
	accentCrimsonDeep: "#9F1239",
	accentCrimsonBorder: "rgba(190, 18, 60, 0.25)",

	accentAmber: "#D97706", // Procedural Caution / Awaited Gazette
	accentAmberMuted: "rgba(217, 119, 6, 0.12)",
	accentAmberDeep: "#B45309",
	accentAmberBorder: "rgba(217, 119, 6, 0.3)",

	accentCobalt: "#2563EB", // Statutory Mechanism Accent
	accentCobaltMuted: "rgba(37, 99, 235, 0.10)",

	// Text Hierarchy - Dark Themes
	textLightPrimary: "#F8FAFC", // Crisp Bright White (Headlines on dark)
	textLightSecondary: "#CBD5E1", // Soft Silver (Subtitles & Body on dark)
	textLightMuted: "#94A3B8", // Muted Slate (Metadata & Disclaimers on dark)

	// Text Hierarchy - Light Themes
	textDarkPrimary: "#0F172A", // Deep Charcoal / Slate 900 (Headlines on light)
	textDarkSecondary: "#334155", // Charcoal / Slate 700 (Body & Bullets on light)
	textDarkMuted: "#64748B", // Slate 500 (Metadata & Citations on light)
} as const;

export const TYPOGRAPHY = {
	fontFamily: "Montserrat",
	weights: {
		regular: 400,
		medium: 500,
		semiBold: 600,
		bold: 700,
		extraBold: 800,
	},
	sizes: {
		heroStat: 88, // Massive numerical figures (e.g. 5x, 5 Cr)
		largeStat: 64, // Prominent secondary stat
		kicker: 16,
		headlineCover: 58,
		headlineSlide: 44,
		subtitleCover: 28,
		subtitleSlide: 26,
		cardTitle: 24,
		bodyText: 24,
		bulletText: 22,
		badgeText: 15,
		metaText: 18,
		footnoteText: 15,
		captionSmall: 13,
	},
	lineHeights: {
		tight: 1.05,
		heroStat: 1.0,
		headline: 1.22,
		subtitle: 1.35,
		body: 1.5,
		bullet: 1.45,
		meta: 1.4,
	},
	letterSpacing: {
		kicker: "2px",
		badge: "1.5px",
		headline: "-0.5px",
		tightHeading: "-1px",
		body: "0px",
	},
} as const;

