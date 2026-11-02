import React from "react";
import { COLORS, TYPOGRAPHY } from "../tokens";
import { getLawBrieflyLogoDataUrl } from "../assets";

export interface SlideHeaderProps {
	slideNumber: number;
	totalSlides: number;
	category?: string;
	isDark?: boolean;
}

export const SlideHeader: React.FC<SlideHeaderProps> = ({
	slideNumber,
	totalSlides,
	category = "LEGAL BRIEFING",
	isDark = false,
}) => {
	const textColor = isDark ? COLORS.textLightPrimary : COLORS.textDarkPrimary;
	const mutedColor = isDark ? COLORS.textLightMuted : COLORS.textDarkMuted;
	const badgeBg = isDark ? "rgba(197, 168, 128, 0.12)" : "rgba(11, 37, 69, 0.06)";
	const badgeBorder = isDark ? "rgba(197, 168, 128, 0.3)" : "rgba(11, 37, 69, 0.15)";
	const badgeTextColor = isDark ? COLORS.brandGold : COLORS.brandNavy;

	const formattedNumber = String(slideNumber).padStart(2, "0");
	const formattedTotal = String(totalSlides).padStart(2, "0");

	return (
		<div
			style={{
				display: "flex",
				flexDirection: "row",
				justifyContent: "space-between",
				alignItems: "center",
				width: "100%",
				paddingBottom: "24px",
				borderBottom: isDark ? `1px solid rgba(255, 255, 255, 0.08)` : `1px solid ${COLORS.brandLightBorder}`,
			}}
		>
			{/* Left: Authentic LawBriefly Monogram & Wordmark Lockup */}
			<div style={{ display: "flex", flexDirection: "row", alignItems: "center" }}>
				<img
					src={getLawBrieflyLogoDataUrl(isDark)}
					alt="LawBriefly"
					width={130}
					height={42}
					style={{
						width: "130px",
						height: "42px",
					}}
				/>
			</div>

			{/* Center: Editorial Category Badge */}
			<div
				style={{
					display: "flex",
					alignItems: "center",
					padding: "6px 16px",
					borderRadius: "999px",
					backgroundColor: badgeBg,
					border: `1px solid ${badgeBorder}`,
				}}
			>
				<span
					style={{
						fontFamily: TYPOGRAPHY.fontFamily,
						fontSize: "13px",
						fontWeight: TYPOGRAPHY.weights.bold,
						color: badgeTextColor,
						letterSpacing: "1.5px",
						textTransform: "uppercase",
					}}
				>
					{category}
				</span>
			</div>

			{/* Right: Slide Pagination Indicator */}
			<div
				style={{
					display: "flex",
					flexDirection: "row",
					alignItems: "center",
				}}
			>
				<span
					style={{
						fontFamily: TYPOGRAPHY.fontFamily,
						fontSize: "18px",
						fontWeight: TYPOGRAPHY.weights.bold,
						color: isDark ? COLORS.brandGold : COLORS.brandNavy,
					}}
				>
					{formattedNumber}
				</span>
				<span
					style={{
						fontFamily: TYPOGRAPHY.fontFamily,
						fontSize: "16px",
						fontWeight: TYPOGRAPHY.weights.medium,
						color: mutedColor,
						margin: "0 4px",
					}}
				>
					/
				</span>
				<span
					style={{
						fontFamily: TYPOGRAPHY.fontFamily,
						fontSize: "16px",
						fontWeight: TYPOGRAPHY.weights.medium,
						color: mutedColor,
					}}
				>
					{formattedTotal}
				</span>
			</div>
		</div>
	);
};
