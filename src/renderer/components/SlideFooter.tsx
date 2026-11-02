import React from "react";
import { COLORS, TYPOGRAPHY } from "../tokens";

export interface SlideFooterProps {
	isDark?: boolean;
	sourceDomain?: string;
	isLastSlide?: boolean;
}

export const SlideFooter: React.FC<SlideFooterProps> = ({
	isDark = false,
	sourceDomain,
	isLastSlide = false,
}) => {
	const mutedColor = isDark ? COLORS.textLightMuted : COLORS.textDarkMuted;
	const borderColor = isDark ? "rgba(255, 255, 255, 0.1)" : COLORS.brandLightBorder;
	const accentColor = isDark ? COLORS.brandGold : COLORS.brandNavyAccent;

	return (
		<div
			style={{
				display: "flex",
				flexDirection: "row",
				justifyContent: "space-between",
				alignItems: "center",
				width: "100%",
				paddingTop: "24px",
				borderTop: `1px solid ${borderColor}`,
			}}
		>
			{/* Left: Brand Value Anchor */}
			<div style={{ display: "flex", flexDirection: "row", alignItems: "center" }}>
				<div
					style={{
						width: "6px",
						height: "6px",
						borderRadius: "3px",
						backgroundColor: accentColor,
						marginRight: "10px",
					}}
				/>
				<span
					style={{
						fontFamily: TYPOGRAPHY.fontFamily,
						fontSize: "15px",
						fontWeight: TYPOGRAPHY.weights.medium,
						color: mutedColor,
						letterSpacing: "0.5px",
					}}
				>
					Legal Learning • Exam Preparation • Indian Law Updates
				</span>
			</div>

			{/* Center: Source indicator if provided */}
			{sourceDomain ? (
				<div
					style={{
						display: "flex",
						alignItems: "center",
						padding: "6px 14px",
						borderRadius: "999px",
						backgroundColor: isDark ? "rgba(255, 255, 255, 0.06)" : "rgba(11, 37, 69, 0.05)",
					}}
				>
					<span
						style={{
							fontFamily: TYPOGRAPHY.fontFamily,
							fontSize: "13px",
							fontWeight: TYPOGRAPHY.weights.semiBold,
							color: mutedColor,
						}}
					>
						Source: {sourceDomain}
					</span>
				</div>
			) : null}

			{/* Right: Swipe prompt with sharp vector arrow */}
			<div style={{ display: "flex", flexDirection: "row", alignItems: "center" }}>
				<span
					style={{
						fontFamily: TYPOGRAPHY.fontFamily,
						fontSize: "15px",
						fontWeight: TYPOGRAPHY.weights.bold,
						color: accentColor,
						letterSpacing: "0.5px",
						marginRight: "8px",
					}}
				>
					{isLastSlide ? "Bookmark for revision" : "Swipe next"}
				</span>
				<svg
					width="18"
					height="18"
					viewBox="0 0 24 24"
					fill="none"
					stroke={accentColor}
					strokeWidth="2.5"
					strokeLinecap="round"
					strokeLinejoin="round"
				>
					{isLastSlide ? (
						<>
							<path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
						</>
					) : (
						<>
							<line x1="5" y1="12" x2="19" y2="12" />
							<polyline points="12 5 19 12 12 19" />
						</>
					)}
				</svg>
			</div>
		</div>
	);
};
