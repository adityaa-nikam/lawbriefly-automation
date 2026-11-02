import React from "react";
import { COLORS, TYPOGRAPHY } from "../tokens";
import { getLawBrieflyLogoDataUrl } from "../assets";

export interface BrandSignatureProps {
	isDark?: boolean;
}

export const BrandSignature: React.FC<BrandSignatureProps> = ({ isDark = false }) => {
	const cardBg = isDark ? COLORS.brandDarkElevated : "rgba(11, 37, 69, 0.04)";
	const borderColor = isDark ? COLORS.brandGoldBorder : "rgba(11, 37, 69, 0.12)";

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
			{/* Left: Authentic Brand Monogram + Wordmark Lockup */}
			<div style={{ display: "flex", flexDirection: "row", alignItems: "center" }}>
				<img
					src={getLawBrieflyLogoDataUrl(isDark)}
					alt="LawBriefly"
					width={140}
					height={45}
					style={{
						width: "140px",
						height: "45px",
					}}
				/>
				<div
					style={{
						width: "1.5px",
						height: "30px",
						backgroundColor: isDark ? "rgba(255, 255, 255, 0.2)" : "rgba(11, 37, 69, 0.2)",
						marginLeft: "18px",
						marginRight: "18px",
					}}
				/>
				<span
					style={{
						fontFamily: TYPOGRAPHY.fontFamily,
						fontSize: "12px",
						fontWeight: TYPOGRAPHY.weights.bold,
						color: isDark ? COLORS.textLightMuted : COLORS.textDarkMuted,
						letterSpacing: "1px",
						textTransform: "uppercase",
					}}
				>
					Indian Legal Media & Analysis
				</span>
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
