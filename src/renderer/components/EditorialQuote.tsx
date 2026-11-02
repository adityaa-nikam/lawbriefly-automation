import React from "react";
import { COLORS, TYPOGRAPHY } from "../tokens";

export interface EditorialQuoteProps {
	quoteText: string;
	attribution?: string;
	kicker?: string;
	isDark?: boolean;
}

export const EditorialQuote: React.FC<EditorialQuoteProps> = ({
	quoteText,
	attribution,
	kicker = "CORE TAKEAWAY",
	isDark = true,
}) => {
	const cardBg = isDark ? COLORS.brandDarkElevated : COLORS.brandLightElevated;
	const borderColor = isDark ? COLORS.brandGoldBorder : COLORS.brandNavyAccent;
	const textColor = isDark ? COLORS.textLightPrimary : COLORS.textDarkPrimary;
	const kickerColor = isDark ? COLORS.brandGold : COLORS.brandNavyAccent;

	return (
		<div
			style={{
				display: "flex",
				flexDirection: "column",
				backgroundColor: cardBg,
				border: `1.5px solid ${borderColor}`,
				borderLeft: `6px solid ${kickerColor}`,
				borderRadius: "20px",
				padding: "24px 28px",
				boxShadow: isDark ? "0 10px 28px rgba(0,0,0,0.4)" : "0 6px 20px rgba(0,0,0,0.04)",
				marginBottom: "20px",
			}}
		>
			<span
				style={{
					fontFamily: TYPOGRAPHY.fontFamily,
					fontSize: "12px",
					fontWeight: TYPOGRAPHY.weights.bold,
					color: kickerColor,
					letterSpacing: "1.5px",
					textTransform: "uppercase",
					marginBottom: "8px",
				}}
			>
				{kicker}
			</span>

			<span
				style={{
					fontFamily: TYPOGRAPHY.fontFamily,
					fontSize: "22px",
					fontWeight: TYPOGRAPHY.weights.semiBold,
					color: textColor,
					lineHeight: 1.45,
					marginBottom: attribution ? "10px" : "0px",
				}}
			>
				"{quoteText}"
			</span>

			{attribution ? (
				<span
					style={{
						fontFamily: TYPOGRAPHY.fontFamily,
						fontSize: "14px",
						fontWeight: TYPOGRAPHY.weights.medium,
						color: isDark ? COLORS.textLightMuted : COLORS.textDarkMuted,
						lineHeight: 1.3,
					}}
				>
					— {attribution}
				</span>
			) : null}
		</div>
	);
};
