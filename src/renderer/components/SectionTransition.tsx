import React from "react";
import { COLORS, TYPOGRAPHY } from "../tokens";

export interface SectionTransitionProps {
	sectionNumber: string;
	sectionTitle: string;
	isDark?: boolean;
}

export const SectionTransition: React.FC<SectionTransitionProps> = ({
	sectionNumber,
	sectionTitle,
	isDark = false,
}) => {
	const numColor = isDark ? COLORS.brandGold : COLORS.brandNavyAccent;
	const titleColor = isDark ? COLORS.textLightMuted : COLORS.textDarkMuted;

	return (
		<div
			style={{
				display: "flex",
				flexDirection: "row",
				alignItems: "center",
				marginBottom: "8px",
			}}
		>
			<span
				style={{
					fontFamily: TYPOGRAPHY.fontFamily,
					fontSize: "13px",
					fontWeight: TYPOGRAPHY.weights.extraBold,
					color: numColor,
					letterSpacing: "1.5px",
					marginRight: "8px",
				}}
			>
				{sectionNumber}
			</span>
			<span
				style={{
					fontFamily: TYPOGRAPHY.fontFamily,
					fontSize: "13px",
					fontWeight: TYPOGRAPHY.weights.bold,
					color: titleColor,
					letterSpacing: "1.5px",
					textTransform: "uppercase",
				}}
			>
				• {sectionTitle}
			</span>
		</div>
	);
};
