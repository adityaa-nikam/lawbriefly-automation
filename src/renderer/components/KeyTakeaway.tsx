import React from "react";
import { COLORS, TYPOGRAPHY } from "../tokens";

export interface KeyTakeawayProps {
	text: string;
	label?: string;
	isDark?: boolean;
	icon?: React.ReactNode;
}

export const KeyTakeaway: React.FC<KeyTakeawayProps> = ({
	text,
	label = "CRUCIAL TAKEAWAY",
	isDark = true,
	icon,
}) => {
	const cardBg = isDark ? COLORS.brandDarkCard : COLORS.brandLightElevated;
	const borderColor = isDark ? COLORS.brandGoldBorder : COLORS.brandNavyAccent;
	const labelColor = isDark ? COLORS.brandGold : COLORS.brandNavyAccent;
	const textColor = isDark ? COLORS.textLightPrimary : COLORS.textDarkPrimary;

	return (
		<div
			style={{
				display: "flex",
				flexDirection: "row",
				alignItems: "center",
				backgroundColor: cardBg,
				border: `1.5px solid ${borderColor}`,
				borderRadius: "20px",
				padding: "20px 24px",
				boxShadow: isDark ? "0 10px 28px rgba(0,0,0,0.35)" : "0 6px 18px rgba(0,0,0,0.04)",
			}}
		>
			{icon ? (
				<div
					style={{
						display: "flex",
						alignItems: "center",
						justifyContent: "center",
						width: "48px",
						height: "48px",
						borderRadius: "14px",
						backgroundColor: isDark ? "rgba(197, 168, 128, 0.15)" : COLORS.brandNavySurface,
						marginRight: "18px",
						flexShrink: 0,
					}}
				>
					{icon}
				</div>
			) : null}

			<div style={{ display: "flex", flexDirection: "column", flexGrow: 1 }}>
				<span
					style={{
						fontFamily: TYPOGRAPHY.fontFamily,
						fontSize: "12px",
						fontWeight: TYPOGRAPHY.weights.bold,
						color: labelColor,
						letterSpacing: "1.2px",
						textTransform: "uppercase",
						marginBottom: "4px",
					}}
				>
					{label}
				</span>
				<span
					style={{
						fontFamily: TYPOGRAPHY.fontFamily,
						fontSize: "18px",
						fontWeight: TYPOGRAPHY.weights.semiBold,
						color: textColor,
						lineHeight: 1.45,
					}}
				>
					{text}
				</span>
			</div>
		</div>
	);
};
