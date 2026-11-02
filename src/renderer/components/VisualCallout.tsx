import React from "react";
import { COLORS, TYPOGRAPHY } from "../tokens";

export interface VisualCalloutProps {
	label?: string;
	children?: React.ReactNode;
	text?: string;
	isDark?: boolean;
	variant?: "navy" | "gold" | "emerald" | "amber";
}

export const VisualCallout: React.FC<VisualCalloutProps> = ({
	label,
	children,
	text,
	isDark = false,
	variant = "navy",
}) => {
	let accentBorder: string = COLORS.brandNavyAccent;
	let accentBg: string = "rgba(11, 37, 69, 0.04)";
	let labelColor: string = COLORS.brandNavy;

	if (variant === "gold") {
		accentBorder = COLORS.brandGold;
		accentBg = isDark ? "rgba(197, 168, 128, 0.12)" : "rgba(197, 168, 128, 0.14)";
		labelColor = isDark ? COLORS.brandGold : "#92400E";
	} else if (variant === "emerald") {
		accentBorder = COLORS.accentEmerald;
		accentBg = "rgba(5, 150, 105, 0.08)";
		labelColor = COLORS.accentEmerald;
	} else if (variant === "amber") {
		accentBorder = COLORS.accentAmber;
		accentBg = "rgba(217, 119, 6, 0.10)";
		labelColor = COLORS.accentAmberDeep;
	}

	return (
		<div
			style={{
				display: "flex",
				flexDirection: "column",
				backgroundColor: accentBg,
				borderLeft: `5px solid ${accentBorder}`,
				borderTop: `1px solid ${isDark ? "rgba(255,255,255,0.06)" : "rgba(11,37,69,0.06)"}`,
				borderRight: `1px solid ${isDark ? "rgba(255,255,255,0.06)" : "rgba(11,37,69,0.06)"}`,
				borderBottom: `1px solid ${isDark ? "rgba(255,255,255,0.06)" : "rgba(11,37,69,0.06)"}`,
				borderRadius: "16px",
				padding: "18px 22px",
			}}
		>
			{label ? (
				<span
					style={{
						fontFamily: TYPOGRAPHY.fontFamily,
						fontSize: "12px",
						fontWeight: TYPOGRAPHY.weights.bold,
						color: labelColor,
						letterSpacing: "1.2px",
						textTransform: "uppercase",
						marginBottom: "6px",
					}}
				>
					{label}
				</span>
			) : null}

			{text ? (
				<span
					style={{
						fontFamily: TYPOGRAPHY.fontFamily,
						fontSize: "16px",
						fontWeight: TYPOGRAPHY.weights.medium,
						color: isDark ? COLORS.textLightSecondary : COLORS.textDarkPrimary,
						lineHeight: 1.45,
					}}
				>
					{text}
				</span>
			) : (
				children
			)}
		</div>
	);
};
