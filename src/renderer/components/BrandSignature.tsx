import React from "react";
import { COLORS, TYPOGRAPHY } from "../tokens";
import { getLbMonogramSvg } from "../assets";

export interface BrandSignatureProps {
	isDark?: boolean;
}

export const BrandSignature: React.FC<BrandSignatureProps> = ({ isDark = false }) => {
	const cardBg = isDark ? COLORS.brandDarkElevated : "rgba(11, 37, 69, 0.04)";
	const borderColor = isDark ? COLORS.brandGoldBorder : "rgba(11, 37, 69, 0.12)";
	const monogramColor = isDark ? COLORS.brandGold : COLORS.brandNavy;
	const textColor = isDark ? COLORS.textLightPrimary : COLORS.textDarkPrimary;
	const tagColor = isDark ? COLORS.brandGoldLight : COLORS.brandNavyAccent;

	return (
		<div
			style={{
				display: "flex",
				flexDirection: "row",
				alignItems: "center",
				justifyContent: "space-between",
				backgroundColor: cardBg,
				border: `1.5px solid ${borderColor}`,
				borderRadius: "20px",
				padding: "20px 26px",
				marginBottom: "18px",
			}}
		>
			{/* Left: Brand Monogram + Wordmark */}
			<div style={{ display: "flex", flexDirection: "row", alignItems: "center" }}>
				{getLbMonogramSvg(monogramColor, 44)}
				<div style={{ display: "flex", flexDirection: "column", marginLeft: "14px" }}>
					<div style={{ display: "flex", flexDirection: "row", alignItems: "baseline" }}>
						<span
							style={{
								fontFamily: TYPOGRAPHY.fontFamily,
								fontSize: "24px",
								fontWeight: TYPOGRAPHY.weights.bold,
								color: textColor,
								letterSpacing: "-0.5px",
							}}
						>
							Law
						</span>
						<span
							style={{
								fontFamily: TYPOGRAPHY.fontFamily,
								fontSize: "24px",
								fontWeight: TYPOGRAPHY.weights.bold,
								color: tagColor,
								letterSpacing: "-0.5px",
							}}
						>
							Briefly
						</span>
					</div>
					<span
						style={{
							fontFamily: TYPOGRAPHY.fontFamily,
							fontSize: "12px",
							fontWeight: TYPOGRAPHY.weights.bold,
							color: isDark ? COLORS.textLightMuted : COLORS.textDarkMuted,
							letterSpacing: "1px",
							textTransform: "uppercase",
							marginTop: "2px",
						}}
					>
						Indian Legal Media & Analysis
					</span>
				</div>
			</div>

			{/* Right: Official Tagline Pill */}
			<div
				style={{
					display: "flex",
					flexDirection: "column",
					alignItems: "flex-end",
				}}
			>
				<span
					style={{
						fontFamily: TYPOGRAPHY.fontFamily,
						fontSize: "13px",
						fontWeight: TYPOGRAPHY.weights.semiBold,
						color: isDark ? COLORS.brandGold : COLORS.brandNavy,
						letterSpacing: "0.5px",
					}}
				>
					Legal Learning • Exam Preparation • Indian Law Updates
				</span>
				<span
					style={{
						fontFamily: TYPOGRAPHY.fontFamily,
						fontSize: "11px",
						fontWeight: TYPOGRAPHY.weights.medium,
						color: isDark ? COLORS.textLightMuted : COLORS.textDarkMuted,
						marginTop: "3px",
					}}
				>
					Verified Editorial Publication
				</span>
			</div>
		</div>
	);
};
