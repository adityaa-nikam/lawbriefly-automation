import React from "react";
import { COLORS, TYPOGRAPHY } from "../tokens";

export interface OversizedStatProps {
	value: string;
	label: string;
	contextNote?: string;
	badge?: string;
	isDark?: boolean;
	accentColor?: string;
}

export const OversizedStat: React.FC<OversizedStatProps> = ({
	value,
	label,
	contextNote,
	badge,
	isDark = false,
	accentColor = COLORS.brandNavyAccent,
}) => {
	const bgColor = isDark ? COLORS.brandDarkCard : COLORS.brandLightElevated;
	const borderColor = isDark ? COLORS.brandDarkBorder : COLORS.brandLightBorder;
	const textColor = isDark ? COLORS.textLightPrimary : COLORS.textDarkPrimary;
	const mutedColor = isDark ? COLORS.textLightMuted : COLORS.textDarkMuted;

	return (
		<div
			style={{
				display: "flex",
				flexDirection: "column",
				backgroundColor: bgColor,
				border: `1.5px solid ${borderColor}`,
				borderRadius: "22px",
				padding: "26px 30px",
				boxShadow: isDark ? "0 8px 24px rgba(0,0,0,0.3)" : "0 6px 20px rgba(0,0,0,0.04)",
			}}
		>
			<div
				style={{
					display: "flex",
					flexDirection: "row",
					justifyContent: "space-between",
					alignItems: "center",
					marginBottom: "10px",
				}}
			>
				<span
					style={{
						fontFamily: TYPOGRAPHY.fontFamily,
						fontSize: "13px",
						fontWeight: TYPOGRAPHY.weights.bold,
						color: accentColor,
						letterSpacing: "1.5px",
						textTransform: "uppercase",
					}}
				>
					{label}
				</span>

				{badge ? (
					<div
						style={{
							display: "flex",
							alignItems: "center",
							padding: "4px 10px",
							borderRadius: "999px",
							backgroundColor: isDark ? "rgba(197, 168, 128, 0.15)" : COLORS.brandNavySurface,
						}}
					>
						<span
							style={{
								fontFamily: TYPOGRAPHY.fontFamily,
								fontSize: "11px",
								fontWeight: TYPOGRAPHY.weights.bold,
								color: isDark ? COLORS.brandGold : COLORS.brandNavy,
							}}
						>
							{badge}
						</span>
					</div>
				) : null}
			</div>

			<div style={{ display: "flex", flexDirection: "row", alignItems: "baseline", marginBottom: "8px" }}>
				<span
					style={{
						fontFamily: TYPOGRAPHY.fontFamily,
						fontSize: `${TYPOGRAPHY.sizes.heroStat}px`,
						fontWeight: TYPOGRAPHY.weights.extraBold,
						color: textColor,
						lineHeight: TYPOGRAPHY.lineHeights.heroStat,
						letterSpacing: "-2px",
					}}
				>
					{value}
				</span>
			</div>

			{contextNote ? (
				<span
					style={{
						fontFamily: TYPOGRAPHY.fontFamily,
						fontSize: "16px",
						fontWeight: TYPOGRAPHY.weights.medium,
						color: mutedColor,
						lineHeight: 1.4,
					}}
				>
					{contextNote}
				</span>
			) : null}
		</div>
	);
};
