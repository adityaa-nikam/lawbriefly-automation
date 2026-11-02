import React from "react";
import { COLORS, TYPOGRAPHY } from "../tokens";

export interface EditorialHeroProps {
	kicker: string;
	headline: string;
	subtitle?: string;
	isDark?: boolean;
	highlightPill?: string;
}

export const EditorialHero: React.FC<EditorialHeroProps> = ({
	kicker,
	headline,
	subtitle,
	isDark = true,
	highlightPill,
}) => {
	const kickerColor = isDark ? COLORS.brandGold : COLORS.brandNavyAccent;
	const headlineColor = isDark ? COLORS.textLightPrimary : COLORS.textDarkPrimary;
	const subtitleColor = isDark ? COLORS.textLightSecondary : COLORS.textDarkSecondary;

	return (
		<div
			style={{
				display: "flex",
				flexDirection: "column",
				width: "100%",
				marginBottom: "28px",
			}}
		>
			{/* Top Editorial Kicker & Tag */}
			<div
				style={{
					display: "flex",
					flexDirection: "row",
					alignItems: "center",
					justifyContent: "space-between",
					marginBottom: "16px",
				}}
			>
				<div style={{ display: "flex", flexDirection: "row", alignItems: "center" }}>
					<div
						style={{
							width: "8px",
							height: "8px",
							borderRadius: "4px",
							backgroundColor: isDark ? COLORS.brandGold : COLORS.brandNavyAccent,
							marginRight: "10px",
						}}
					/>
					<span
						style={{
							fontFamily: TYPOGRAPHY.fontFamily,
							fontSize: `${TYPOGRAPHY.sizes.kicker}px`,
							fontWeight: TYPOGRAPHY.weights.bold,
							color: kickerColor,
							letterSpacing: TYPOGRAPHY.letterSpacing.kicker,
							textTransform: "uppercase",
						}}
					>
						{kicker}
					</span>
				</div>

				{highlightPill ? (
					<div
						style={{
							display: "flex",
							alignItems: "center",
							padding: "4px 12px",
							borderRadius: "999px",
							backgroundColor: isDark ? "rgba(197, 168, 128, 0.15)" : COLORS.brandNavySurface,
							border: isDark ? `1px solid ${COLORS.brandGoldBorder}` : "1px solid rgba(11, 37, 69, 0.15)",
						}}
					>
						<span
							style={{
								fontFamily: TYPOGRAPHY.fontFamily,
								fontSize: "12px",
								fontWeight: TYPOGRAPHY.weights.bold,
								color: isDark ? COLORS.brandGold : COLORS.brandNavy,
								letterSpacing: "1px",
								textTransform: "uppercase",
							}}
						>
							{highlightPill}
						</span>
					</div>
				) : null}
			</div>

			{/* Main Expressive Headline */}
			<div style={{ display: "flex", flexDirection: "column", marginBottom: "18px" }}>
				<span
					style={{
						fontFamily: TYPOGRAPHY.fontFamily,
						fontSize: `${TYPOGRAPHY.sizes.headlineCover}px`,
						fontWeight: TYPOGRAPHY.weights.extraBold,
						color: headlineColor,
						lineHeight: TYPOGRAPHY.lineHeights.headline,
						letterSpacing: TYPOGRAPHY.letterSpacing.headline,
					}}
				>
					{headline}
				</span>
			</div>

			{/* Architectural Dual-Accent Rule */}
			<div
				style={{
					display: "flex",
					width: "140px",
					height: "4px",
					borderRadius: "2px",
					backgroundImage: isDark
						? `linear-gradient(to right, ${COLORS.brandGold}, ${COLORS.brandNavyAccent})`
						: `linear-gradient(to right, ${COLORS.brandNavyAccent}, ${COLORS.brandGold})`,
					marginBottom: subtitle ? "20px" : "0px",
				}}
			/>

			{/* Subtitle */}
			{subtitle ? (
				<div style={{ display: "flex", flexDirection: "column" }}>
					<span
						style={{
							fontFamily: TYPOGRAPHY.fontFamily,
							fontSize: `${TYPOGRAPHY.sizes.subtitleCover}px`,
							fontWeight: TYPOGRAPHY.weights.medium,
							color: subtitleColor,
							lineHeight: TYPOGRAPHY.lineHeights.subtitle,
						}}
					>
						{subtitle}
					</span>
				</div>
			) : null}
		</div>
	);
};
