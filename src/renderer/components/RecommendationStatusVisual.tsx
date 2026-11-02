import React from "react";
import { COLORS, TYPOGRAPHY } from "../tokens";

export interface RecommendationStatusVisualProps {
	statusTitle?: string;
	description: string;
	isDark?: boolean;
	severity?: "caution" | "info" | "success";
}

export const RecommendationStatusVisual: React.FC<RecommendationStatusVisualProps> = ({
	statusTitle = "PROCEDURAL & CONSTITUTIONAL STATUS",
	description,
	isDark = false,
	severity = "caution",
}) => {
	let accentBg: string = "rgba(217, 119, 6, 0.12)";
	let accentBorder: string = "rgba(217, 119, 6, 0.35)";
	let accentColor: string = COLORS.accentAmberDeep;
	let indicatorDot: string = COLORS.accentAmber;

	if (severity === "success") {
		accentBg = "rgba(5, 150, 105, 0.12)";
		accentBorder = "rgba(5, 150, 105, 0.35)";
		accentColor = COLORS.accentEmerald;
		indicatorDot = COLORS.accentEmerald;
	} else if (severity === "info") {
		accentBg = isDark ? "rgba(197, 168, 128, 0.14)" : "rgba(11, 37, 69, 0.06)";
		accentBorder = isDark ? COLORS.brandGoldBorder : "rgba(11, 37, 69, 0.15)";
		accentColor = isDark ? COLORS.brandGold : COLORS.brandNavyAccent;
		indicatorDot = isDark ? COLORS.brandGold : COLORS.brandNavyAccent;
	}

	return (
		<div
			style={{
				display: "flex",
				flexDirection: "row",
				alignItems: "flex-start",
				backgroundColor: isDark ? "rgba(15, 23, 42, 0.65)" : accentBg,
				border: `1.5px solid ${accentBorder}`,
				borderRadius: "18px",
				padding: "18px 24px",
				...(isDark ? { boxShadow: "0 4px 16px rgba(0,0,0,0.25)" } : {}),
			}}
		>
			<div
				style={{
					width: "12px",
					height: "12px",
					borderRadius: "6px",
					backgroundColor: indicatorDot,
					marginRight: "16px",
					marginTop: "5px",
					flexShrink: 0,
				}}
			/>
			<div style={{ display: "flex", flexDirection: "column", flexGrow: 1 }}>
				<span
					style={{
						fontFamily: TYPOGRAPHY.fontFamily,
						fontSize: "12px",
						fontWeight: TYPOGRAPHY.weights.bold,
						color: accentColor,
						letterSpacing: "1.2px",
						textTransform: "uppercase",
						marginBottom: "4px",
					}}
				>
					{statusTitle}
				</span>
				<span
					style={{
						fontFamily: TYPOGRAPHY.fontFamily,
						fontSize: "16px",
						fontWeight: TYPOGRAPHY.weights.medium,
						color: isDark ? COLORS.textLightSecondary : COLORS.textDarkPrimary,
						lineHeight: 1.45,
					}}
				>
					{description}
				</span>
			</div>
		</div>
	);
};
