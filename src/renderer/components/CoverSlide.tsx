import React from "react";
import { CANVAS, COLORS, TYPOGRAPHY } from "../tokens";
import { SlideHeader } from "./SlideHeader";
import { SlideFooter } from "./SlideFooter";
import { getJusticeScalesSvg } from "../assets";

export interface CoverSlideProps {
	headline: string;
	subtitle?: string;
	category?: string;
	slideNumber: number;
	totalSlides: number;
	keyTakeaway?: string;
	sourceDomain?: string;
}

export const CoverSlide: React.FC<CoverSlideProps> = ({
	headline,
	subtitle,
	category = "SPECIAL LEGAL BRIEFING",
	slideNumber,
	totalSlides,
	keyTakeaway,
	sourceDomain,
}) => {
	const takeawayText =
		keyTakeaway ||
		"GST Council recommends fundamental transition from coercive custody to trust-based economic governance.";

	return (
		<div
			style={{
				width: `${CANVAS.width}px`,
				height: `${CANVAS.height}px`,
				backgroundColor: "#070B14",
				backgroundImage: `radial-gradient(circle at 85% 18%, rgba(19, 62, 135, 0.42) 0%, rgba(7, 11, 20, 0) 65%), radial-gradient(circle at 15% 82%, rgba(197, 168, 128, 0.20) 0%, rgba(7, 11, 20, 0) 55%)`,
				display: "flex",
				flexDirection: "column",
				justifyContent: "space-between",
				padding: `${CANVAS.paddingVertical}px ${CANVAS.paddingHorizontal}px`,
				boxSizing: "border-box",
				position: "relative",
			}}
		>
			{/* Slide Header */}
			<SlideHeader
				slideNumber={slideNumber}
				totalSlides={totalSlides}
				category={category}
				isDark={true}
			/>

			{/* Main Editorial Hero Body */}
			<div
				style={{
					display: "flex",
					flexDirection: "column",
					justifyContent: "center",
					flexGrow: 1,
					margin: "32px 0",
				}}
			>
				{/* Top Editorial Kicker */}
				<div
					style={{
						display: "flex",
						flexDirection: "row",
						alignItems: "center",
						marginBottom: "20px",
					}}
				>
					<div
						style={{
							width: "10px",
							height: "10px",
							borderRadius: "5px",
							backgroundColor: COLORS.brandGold,
							marginRight: "12px",
							boxShadow: "0 0 10px rgba(197, 168, 128, 0.6)",
						}}
					/>
					<span
						style={{
							fontFamily: TYPOGRAPHY.fontFamily,
							fontSize: "14px",
							fontWeight: TYPOGRAPHY.weights.bold,
							color: COLORS.brandGold,
							letterSpacing: "2.2px",
							textTransform: "uppercase",
						}}
					>
						Indian Legal Analysis • Special Landmark Briefing
					</span>
				</div>

				{/* Expressive Editorial Headline */}
				<div style={{ display: "flex", flexDirection: "column", marginBottom: "22px" }}>
					<span
						style={{
							fontFamily: TYPOGRAPHY.fontFamily,
							fontSize: "62px",
							fontWeight: TYPOGRAPHY.weights.extraBold,
							color: COLORS.textLightPrimary,
							lineHeight: 1.16,
							letterSpacing: "-1.2px",
						}}
					>
						{headline}
					</span>
				</div>

				{/* Architectural Gradient Rule */}
				<div
					style={{
						display: "flex",
						width: "180px",
						height: "5px",
						borderRadius: "3px",
						backgroundImage: `linear-gradient(to right, ${COLORS.brandGold}, ${COLORS.brandNavyAccent})`,
						marginBottom: "24px",
					}}
				/>

				{/* Subtitle */}
				{subtitle ? (
					<div style={{ display: "flex", flexDirection: "column", marginBottom: "32px" }}>
						<span
							style={{
								fontFamily: TYPOGRAPHY.fontFamily,
								fontSize: "27px",
								fontWeight: TYPOGRAPHY.weights.medium,
								color: COLORS.textLightSecondary,
								lineHeight: 1.42,
							}}
						>
							{subtitle}
						</span>
					</div>
				) : null}

				{/* Asymmetric Visual Anchor: Scales Medallion + Core Takeaway */}
				<div
					style={{
						display: "flex",
						flexDirection: "row",
						alignItems: "center",
						backgroundColor: "rgba(18, 24, 38, 0.85)",
						border: `1.5px solid ${COLORS.brandGoldBorder}`,
						borderRadius: "24px",
						padding: "24px 28px",
						marginBottom: "20px",
						boxShadow: "0 16px 40px rgba(0, 0, 0, 0.55)",
					}}
				>
					<div
						style={{
							display: "flex",
							alignItems: "center",
							justifyContent: "center",
							width: "68px",
							height: "68px",
							borderRadius: "18px",
							backgroundColor: "rgba(197, 168, 128, 0.16)",
							border: "1px solid rgba(197, 168, 128, 0.35)",
							marginRight: "22px",
							flexShrink: 0,
						}}
					>
						{getJusticeScalesSvg(COLORS.brandGold, 44)}
					</div>

					<div style={{ display: "flex", flexDirection: "column", flexGrow: 1 }}>
						<span
							style={{
								fontFamily: TYPOGRAPHY.fontFamily,
								fontSize: "12px",
								fontWeight: TYPOGRAPHY.weights.bold,
								color: COLORS.brandGold,
								letterSpacing: "1.5px",
								textTransform: "uppercase",
								marginBottom: "4px",
							}}
						>
							Statutory Policy Anchor
						</span>
						<span
							style={{
								fontFamily: TYPOGRAPHY.fontFamily,
								fontSize: "20px",
								fontWeight: TYPOGRAPHY.weights.semiBold,
								color: COLORS.textLightPrimary,
								lineHeight: 1.4,
							}}
						>
							{takeawayText}
						</span>
					</div>
				</div>

				{/* 3-Column High-Impact Statutory Matrix */}
				<div
					style={{
						display: "flex",
						flexDirection: "row",
						gap: "16px",
						marginBottom: "22px",
					}}
				>
					<div
						style={{
							display: "flex",
							flexDirection: "column",
							flex: 1,
							backgroundColor: "rgba(18, 24, 38, 0.7)",
							border: "1.5px solid rgba(197, 168, 128, 0.3)",
							borderRadius: "18px",
							padding: "18px 20px",
						}}
					>
						<span
							style={{
								fontFamily: TYPOGRAPHY.fontFamily,
								fontSize: "11px",
								fontWeight: TYPOGRAPHY.weights.bold,
								color: COLORS.brandGold,
								letterSpacing: "1px",
								textTransform: "uppercase",
								marginBottom: "4px",
							}}
						>
							CGST § 69
						</span>
						<span
							style={{
								fontFamily: TYPOGRAPHY.fontFamily,
								fontSize: "20px",
								fontWeight: TYPOGRAPHY.weights.extraBold,
								color: "#FFFFFF",
								lineHeight: 1.2,
								marginBottom: "4px",
							}}
						>
							Arrest Powers
						</span>
						<span
							style={{
								fontFamily: TYPOGRAPHY.fontFamily,
								fontSize: "13px",
								fontWeight: TYPOGRAPHY.weights.medium,
								color: COLORS.textLightSecondary,
								lineHeight: 1.35,
							}}
						>
							Recommended for full omission from the Act
						</span>
					</div>

					<div
						style={{
							display: "flex",
							flexDirection: "column",
							flex: 1,
							backgroundColor: "rgba(18, 24, 38, 0.7)",
							border: "1.5px solid rgba(5, 150, 105, 0.3)",
							borderRadius: "18px",
							padding: "18px 20px",
						}}
					>
						<span
							style={{
								fontFamily: TYPOGRAPHY.fontFamily,
								fontSize: "11px",
								fontWeight: TYPOGRAPHY.weights.bold,
								color: "#34D399",
								letterSpacing: "1px",
								textTransform: "uppercase",
								marginBottom: "4px",
							}}
						>
							CGST § 132
						</span>
						<span
							style={{
								fontFamily: TYPOGRAPHY.fontFamily,
								fontSize: "20px",
								fontWeight: TYPOGRAPHY.weights.extraBold,
								color: "#FFFFFF",
								lineHeight: 1.2,
								marginBottom: "4px",
							}}
						>
							Rs 5 Cr Floor
						</span>
						<span
							style={{
								fontFamily: TYPOGRAPHY.fontFamily,
								fontSize: "13px",
								fontWeight: TYPOGRAPHY.weights.medium,
								color: COLORS.textLightSecondary,
								lineHeight: 1.35,
							}}
						>
							5x threshold increase to protect enterprise
						</span>
					</div>

					<div
						style={{
							display: "flex",
							flexDirection: "column",
							flex: 1,
							backgroundColor: "rgba(18, 24, 38, 0.7)",
							border: "1.5px solid rgba(255, 255, 255, 0.12)",
							borderRadius: "18px",
							padding: "18px 20px",
						}}
					>
						<span
							style={{
								fontFamily: TYPOGRAPHY.fontFamily,
								fontSize: "11px",
								fontWeight: TYPOGRAPHY.weights.bold,
								color: COLORS.textLightMuted,
								letterSpacing: "1px",
								textTransform: "uppercase",
								marginBottom: "4px",
							}}
						>
							Enforcement
						</span>
						<span
							style={{
								fontFamily: TYPOGRAPHY.fontFamily,
								fontSize: "20px",
								fontWeight: TYPOGRAPHY.weights.extraBold,
								color: "#FFFFFF",
								lineHeight: 1.2,
								marginBottom: "4px",
							}}
						>
							Trust-Based
						</span>
						<span
							style={{
								fontFamily: TYPOGRAPHY.fontFamily,
								fontSize: "13px",
								fontWeight: TYPOGRAPHY.weights.medium,
								color: COLORS.textLightSecondary,
								lineHeight: 1.35,
							}}
						>
							CBIC evidentiary substantiation mandate
						</span>
					</div>
				</div>

				{/* Bottom Statutory Status Banner */}
				<div
					style={{
						display: "flex",
						flexDirection: "row",
						alignItems: "center",
						backgroundColor: "rgba(255, 255, 255, 0.04)",
						border: "1px solid rgba(255, 255, 255, 0.1)",
						borderRadius: "14px",
						padding: "12px 18px",
					}}
				>
					<div
						style={{
							width: "8px",
							height: "8px",
							borderRadius: "4px",
							backgroundColor: COLORS.brandGold,
							marginRight: "10px",
							flexShrink: 0,
						}}
					/>
					<span
						style={{
							fontFamily: TYPOGRAPHY.fontFamily,
							fontSize: "13px",
							fontWeight: TYPOGRAPHY.weights.medium,
							color: COLORS.textLightMuted,
							letterSpacing: "0.5px",
						}}
					>
						Constitutional Note: Council recommendations form policy intent; operative law takes effect upon Parliamentary enactment and Gazette notification.
					</span>
				</div>
			</div>

			{/* Slide Footer */}
			<SlideFooter isDark={true} sourceDomain={sourceDomain} isLastSlide={false} />
		</div>
	);
};
