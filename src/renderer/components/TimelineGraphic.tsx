import React from "react";
import { COLORS, TYPOGRAPHY } from "../tokens";

export interface TimelineEntry {
	dateText: string;
	title: string;
	description?: string;
	isMilestone?: boolean;
}

export interface TimelineGraphicProps {
	entries: TimelineEntry[];
	isDark?: boolean;
}

export const TimelineGraphic: React.FC<TimelineGraphicProps> = ({
	entries,
	isDark = false,
}) => {
	const cardBg = isDark ? COLORS.brandDarkElevated : COLORS.brandLightElevated;
	const borderColor = isDark ? COLORS.brandDarkBorder : COLORS.brandLightBorder;

	return (
		<div
			style={{
				display: "flex",
				flexDirection: "column",
				backgroundColor: cardBg,
				border: `1.5px solid ${borderColor}`,
				borderRadius: "22px",
				padding: "24px 28px",
				boxShadow: isDark ? "0 8px 24px rgba(0,0,0,0.3)" : "0 6px 18px rgba(0,0,0,0.03)",
				marginBottom: "20px",
			}}
		>
			<span
				style={{
					fontFamily: TYPOGRAPHY.fontFamily,
					fontSize: "12px",
					fontWeight: TYPOGRAPHY.weights.bold,
					color: isDark ? COLORS.brandGold : COLORS.brandNavyAccent,
					letterSpacing: "1.2px",
					textTransform: "uppercase",
					marginBottom: "16px",
				}}
			>
				DEVELOPMENT TIMELINE
			</span>

			<div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
				{entries.map((item, idx) => (
					<div
						key={idx}
						style={{
							display: "flex",
							flexDirection: "row",
							alignItems: "flex-start",
						}}
					>
						<div
							style={{
								display: "flex",
								flexDirection: "column",
								alignItems: "center",
								marginRight: "14px",
							}}
						>
							<div
								style={{
									width: "12px",
									height: "12px",
									borderRadius: "6px",
									backgroundColor: item.isMilestone ? COLORS.brandGold : COLORS.brandNavyAccent,
									marginTop: "5px",
								}}
							/>
							{idx < entries.length - 1 ? (
								<div
									style={{
										width: "2px",
										height: "36px",
										backgroundColor: isDark ? "rgba(255,255,255,0.12)" : "rgba(11,37,69,0.12)",
										marginTop: "4px",
									}}
								/>
							) : null}
						</div>

						<div style={{ display: "flex", flexDirection: "column", flexGrow: 1 }}>
							<span
								style={{
									fontFamily: TYPOGRAPHY.fontFamily,
									fontSize: "12px",
									fontWeight: TYPOGRAPHY.weights.bold,
									color: isDark ? COLORS.brandGoldLight : COLORS.brandNavyAccent,
									letterSpacing: "0.5px",
									marginBottom: "2px",
								}}
							>
								{item.dateText}
							</span>
							<span
								style={{
									fontFamily: TYPOGRAPHY.fontFamily,
									fontSize: "16px",
									fontWeight: TYPOGRAPHY.weights.semiBold,
									color: isDark ? COLORS.textLightPrimary : COLORS.textDarkPrimary,
									lineHeight: 1.35,
								}}
							>
								{item.title}
							</span>
							{item.description ? (
								<span
									style={{
										fontFamily: TYPOGRAPHY.fontFamily,
										fontSize: "14px",
										fontWeight: TYPOGRAPHY.weights.medium,
										color: isDark ? COLORS.textLightMuted : COLORS.textDarkMuted,
										lineHeight: 1.35,
										marginTop: "3px",
									}}
								>
									{item.description}
								</span>
							) : null}
						</div>
					</div>
				))}
			</div>
		</div>
	);
};
