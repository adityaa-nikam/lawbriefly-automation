import React from "react";
import { COLORS, TYPOGRAPHY } from "../tokens";
import { getVisualElementSvg } from "../assets";

export interface StakeholderPillar {
	stakeholderGroup: string;
	headline: string;
	bulletPoints: string[];
	iconName: string;
	badgeLabel: string;
	accentColor: string;
	isPrimary?: boolean;
}

export interface StakeholderImpactVisualProps {
	pillars: StakeholderPillar[];
	isDark?: boolean;
}

export const StakeholderImpactVisual: React.FC<StakeholderImpactVisualProps> = ({
	pillars,
	isDark = false,
}) => {
	return (
		<div
			style={{
				display: "flex",
				flexDirection: "row",
				gap: "20px",
				width: "100%",
				marginBottom: "20px",
			}}
		>
			{pillars.map((pillar, idx) => {
				const cardBg = isDark
					? pillar.isPrimary
						? "rgba(11, 37, 69, 0.55)"
						: COLORS.brandDarkElevated
					: pillar.isPrimary
					? "rgba(5, 150, 105, 0.05)"
					: COLORS.brandLightElevated;

				const borderColor = isDark
					? pillar.isPrimary
						? COLORS.brandGoldBorder
						: COLORS.brandDarkBorder
					: pillar.isPrimary
					? "rgba(5, 150, 105, 0.3)"
					: COLORS.brandLightBorder;

				return (
					<div
						key={idx}
						style={{
							display: "flex",
							flexDirection: "column",
							flex: 1,
							backgroundColor: cardBg,
							border: `1.5px solid ${borderColor}`,
							borderRadius: "22px",
							padding: "26px 26px",
							boxShadow: isDark ? "0 8px 24px rgba(0,0,0,0.3)" : "0 6px 18px rgba(0,0,0,0.03)",
						}}
					>
						{/* Pillar Header with Icon and Stakeholder Badge */}
						<div
							style={{
								display: "flex",
								flexDirection: "row",
								alignItems: "center",
								justifyContent: "space-between",
								marginBottom: "16px",
							}}
						>
							<div
								style={{
									display: "flex",
									alignItems: "center",
									justifyContent: "center",
									width: "48px",
									height: "48px",
									borderRadius: "14px",
									backgroundColor: isDark ? "rgba(255,255,255,0.08)" : COLORS.brandNavySurface,
								}}
							>
								{getVisualElementSvg(pillar.iconName, pillar.accentColor, 26)}
							</div>

							<div
								style={{
									display: "flex",
									alignItems: "center",
									padding: "4px 12px",
									borderRadius: "999px",
									backgroundColor: isDark ? "rgba(255,255,255,0.06)" : "rgba(11, 37, 69, 0.05)",
								}}
							>
								<span
									style={{
										fontFamily: TYPOGRAPHY.fontFamily,
										fontSize: "11px",
										fontWeight: TYPOGRAPHY.weights.bold,
										color: pillar.accentColor,
										letterSpacing: "1px",
										textTransform: "uppercase",
									}}
								>
									{pillar.badgeLabel}
								</span>
							</div>
						</div>

						{/* Group Title */}
						<span
							style={{
								fontFamily: TYPOGRAPHY.fontFamily,
								fontSize: "13px",
								fontWeight: TYPOGRAPHY.weights.bold,
								color: isDark ? COLORS.textLightMuted : COLORS.textDarkMuted,
								letterSpacing: "1px",
								textTransform: "uppercase",
								marginBottom: "6px",
							}}
						>
							{pillar.stakeholderGroup}
						</span>

						{/* Pillar Headline */}
						<span
							style={{
								fontFamily: TYPOGRAPHY.fontFamily,
								fontSize: "22px",
								fontWeight: TYPOGRAPHY.weights.bold,
								color: isDark ? COLORS.textLightPrimary : COLORS.textDarkPrimary,
								lineHeight: 1.3,
								marginBottom: "14px",
							}}
						>
							{pillar.headline}
						</span>

						{/* Detailed Points */}
						<div style={{ display: "flex", flexDirection: "column", gap: "10px", flexGrow: 1 }}>
							{pillar.bulletPoints.map((pt, pIdx) => (
								<div key={pIdx} style={{ display: "flex", flexDirection: "row", alignItems: "flex-start" }}>
									<div
										style={{
											width: "6px",
											height: "6px",
											borderRadius: "3px",
											backgroundColor: pillar.accentColor,
											marginTop: "8px",
											marginRight: "10px",
											flexShrink: 0,
										}}
									/>
									<span
										style={{
											fontFamily: TYPOGRAPHY.fontFamily,
											fontSize: "16px",
											fontWeight: TYPOGRAPHY.weights.medium,
											color: isDark ? COLORS.textLightSecondary : COLORS.textDarkSecondary,
											lineHeight: 1.45,
										}}
									>
										{pt}
									</span>
								</div>
							))}
						</div>
					</div>
				);
			})}
		</div>
	);
};
