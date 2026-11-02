import React from "react";
import { COLORS, TYPOGRAPHY } from "../tokens";

export interface NumberComparisonProps {
	title?: string;
	fromLabel: string;
	fromValue: string;
	fromSubtext?: string;
	toLabel: string;
	toValue: string;
	toSubtext?: string;
	multiplierBadge?: string;
	isDark?: boolean;
}

export const NumberComparison: React.FC<NumberComparisonProps> = ({
	title = "PROSECUTION THRESHOLD REVISION",
	fromLabel,
	fromValue,
	fromSubtext,
	toLabel,
	toValue,
	toSubtext,
	multiplierBadge = "5x Increase",
	isDark = false,
}) => {
	const containerBg = isDark ? COLORS.brandDarkElevated : COLORS.brandLightElevated;
	const borderColor = isDark ? COLORS.brandDarkBorder : COLORS.brandLightBorder;

	return (
		<div
			style={{
				display: "flex",
				flexDirection: "column",
				backgroundColor: containerBg,
				border: `1.5px solid ${borderColor}`,
				borderRadius: "24px",
				padding: "26px 30px",
				boxShadow: isDark ? "0 10px 30px rgba(0,0,0,0.35)" : "0 8px 24px rgba(0,0,0,0.04)",
				marginBottom: "22px",
			}}
		>
			{/* Header with Title and Comparison Multiplier Pill */}
			<div
				style={{
					display: "flex",
					flexDirection: "row",
					justifyContent: "space-between",
					alignItems: "center",
					marginBottom: "20px",
					paddingBottom: "14px",
					borderBottom: isDark ? "1px solid rgba(255,255,255,0.08)" : `1px solid ${COLORS.brandLightBorder}`,
				}}
			>
				<span
					style={{
						fontFamily: TYPOGRAPHY.fontFamily,
						fontSize: "13px",
						fontWeight: TYPOGRAPHY.weights.bold,
						color: isDark ? COLORS.brandGold : COLORS.brandNavyAccent,
						letterSpacing: "1.5px",
						textTransform: "uppercase",
					}}
				>
					{title}
				</span>

				{multiplierBadge ? (
					<div
						style={{
							display: "flex",
							alignItems: "center",
							padding: "6px 14px",
							borderRadius: "999px",
							backgroundColor: "rgba(5, 150, 105, 0.14)",
							border: "1px solid rgba(5, 150, 105, 0.3)",
						}}
					>
						<span
							style={{
								fontFamily: TYPOGRAPHY.fontFamily,
								fontSize: "13px",
								fontWeight: TYPOGRAPHY.weights.bold,
								color: COLORS.accentEmerald,
								letterSpacing: "0.5px",
							}}
						>
							{multiplierBadge}
						</span>
					</div>
				) : null}
			</div>

			{/* Side-by-Side Comparison Blocks */}
			<div
				style={{
					display: "flex",
					flexDirection: "row",
					alignItems: "stretch",
					justifyContent: "space-between",
					gap: "20px",
				}}
			>
				{/* "From" Side (Current Baseline) */}
				<div
					style={{
						display: "flex",
						flexDirection: "column",
						flex: 1,
						backgroundColor: isDark ? "rgba(255, 255, 255, 0.03)" : "rgba(11, 37, 69, 0.03)",
						border: isDark ? "1px solid rgba(255, 255, 255, 0.06)" : "1px solid rgba(11, 37, 69, 0.08)",
						borderRadius: "18px",
						padding: "20px 22px",
					}}
				>
					<span
						style={{
							fontFamily: TYPOGRAPHY.fontFamily,
							fontSize: "12px",
							fontWeight: TYPOGRAPHY.weights.bold,
							color: isDark ? COLORS.textLightMuted : COLORS.textDarkMuted,
							letterSpacing: "1px",
							textTransform: "uppercase",
							marginBottom: "8px",
						}}
					>
						{fromLabel}
					</span>
					<div style={{ display: "flex", flexDirection: "row", alignItems: "baseline", marginBottom: "6px" }}>
						<span
							style={{
								fontFamily: TYPOGRAPHY.fontFamily,
								fontSize: "48px",
								fontWeight: TYPOGRAPHY.weights.bold,
								color: isDark ? COLORS.textLightSecondary : COLORS.textDarkSecondary,
								lineHeight: 1.1,
							}}
						>
							{fromValue}
						</span>
					</div>
					{fromSubtext ? (
						<span
							style={{
								fontFamily: TYPOGRAPHY.fontFamily,
								fontSize: "14px",
								fontWeight: TYPOGRAPHY.weights.medium,
								color: isDark ? COLORS.textLightMuted : COLORS.textDarkMuted,
								lineHeight: 1.35,
							}}
						>
							{fromSubtext}
						</span>
					) : null}
				</div>

				{/* Directional Transition Arrow Icon */}
				<div
					style={{
						display: "flex",
						alignItems: "center",
						justifyContent: "center",
						padding: "0 4px",
					}}
				>
					<div
						style={{
							display: "flex",
							alignItems: "center",
							justifyContent: "center",
							width: "44px",
							height: "44px",
							borderRadius: "22px",
							backgroundColor: isDark ? "rgba(197, 168, 128, 0.15)" : COLORS.brandNavySurface,
						}}
					>
						<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={isDark ? COLORS.brandGold : COLORS.brandNavyAccent} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
							<line x1="5" y1="12" x2="19" y2="12" />
							<polyline points="12 5 19 12 12 19" />
						</svg>
					</div>
				</div>

				{/* "To" Side (Proposed Expansion - Highlighted) */}
				<div
					style={{
						display: "flex",
						flexDirection: "column",
						flex: 1,
						backgroundColor: isDark ? "rgba(5, 150, 105, 0.12)" : "rgba(5, 150, 105, 0.08)",
						border: "1.5px solid rgba(5, 150, 105, 0.28)",
						borderRadius: "18px",
						padding: "20px 22px",
					}}
				>
					<span
						style={{
							fontFamily: TYPOGRAPHY.fontFamily,
							fontSize: "12px",
							fontWeight: TYPOGRAPHY.weights.bold,
							color: COLORS.accentEmerald,
							letterSpacing: "1px",
							textTransform: "uppercase",
							marginBottom: "8px",
						}}
					>
						{toLabel}
					</span>
					<div style={{ display: "flex", flexDirection: "row", alignItems: "baseline", marginBottom: "6px" }}>
						<span
							style={{
								fontFamily: TYPOGRAPHY.fontFamily,
								fontSize: "48px",
								fontWeight: TYPOGRAPHY.weights.extraBold,
								color: isDark ? "#34D399" : COLORS.accentEmeraldDeep,
								lineHeight: 1.1,
							}}
						>
							{toValue}
						</span>
					</div>
					{toSubtext ? (
						<span
							style={{
								fontFamily: TYPOGRAPHY.fontFamily,
								fontSize: "14px",
								fontWeight: TYPOGRAPHY.weights.semiBold,
								color: isDark ? COLORS.textLightSecondary : COLORS.textDarkSecondary,
								lineHeight: 1.35,
							}}
						>
							{toSubtext}
						</span>
					) : null}
				</div>
			</div>
		</div>
	);
};
