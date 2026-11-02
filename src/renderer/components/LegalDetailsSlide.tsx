import React from "react";
import { CANVAS, COLORS, TYPOGRAPHY } from "../tokens";
import { SlideHeader } from "./SlideHeader";
import { SlideFooter } from "./SlideFooter";
import { LegalProcessDiagram } from "./LegalProcessDiagram";
import { RecommendationStatusVisual } from "./RecommendationStatusVisual";
import { SectionTransition } from "./SectionTransition";

export interface LegalDetailsSlideProps {
	headline: string;
	bodyText?: string;
	bullets: string[];
	category?: string;
	slideNumber: number;
	totalSlides: number;
	sourceDomain?: string;
	visualElement?: string;
	isCommencementAwaited?: boolean;
}

export const LegalDetailsSlide: React.FC<LegalDetailsSlideProps> = ({
	headline,
	bodyText,
	bullets,
	category = "STATUTORY ANALYSIS",
	slideNumber,
	totalSlides,
	sourceDomain,
	isCommencementAwaited = true,
}) => {
	const bullet1 =
		bullets[0] ||
		"Legislative amendment required: Omission of Section 69 and amendment to Section 132 await parliamentary approval and official Gazette notification.";
	const bullet2 =
		bullets[1] ||
		"CBIC Circulars mandate field officers to substantiate fraud allegations with concrete documentary evidence.";
	const bullet3 =
		bullets[2] ||
		"Reasoned adjudication and clarity in notices established to reduce avoidable litigation for commercial disputes.";

	return (
		<div
			style={{
				width: `${CANVAS.width}px`,
				height: `${CANVAS.height}px`,
				backgroundColor: "#F6F8FB",
				backgroundImage: `radial-gradient(circle at 10% 90%, rgba(197, 168, 128, 0.08) 0%, rgba(246, 248, 251, 0) 55%)`,
				display: "flex",
				flexDirection: "column",
				justifyContent: "space-between",
				padding: `${CANVAS.paddingVertical}px ${CANVAS.paddingHorizontal}px`,
				boxSizing: "border-box",
			}}
		>
			{/* Slide Header */}
			<SlideHeader
				slideNumber={slideNumber}
				totalSlides={totalSlides}
				category={category}
				isDark={false}
			/>

			{/* Main Content Body */}
			<div
				style={{
					display: "flex",
					flexDirection: "column",
					justifyContent: "space-between",
					flexGrow: 1,
					margin: "28px 0",
				}}
			>
				{/* Editorial Chapter Marker & Section Headline */}
				<div style={{ display: "flex", flexDirection: "column", marginBottom: "16px" }}>
					<SectionTransition sectionNumber="02" sectionTitle="PROCEDURAL MECHANICS & LEGISLATIVE PATHWAY" />
					<span
						style={{
							fontFamily: TYPOGRAPHY.fontFamily,
							fontSize: `${TYPOGRAPHY.sizes.headlineSlide}px`,
							fontWeight: TYPOGRAPHY.weights.extraBold,
							color: COLORS.textDarkPrimary,
							lineHeight: 1.2,
							letterSpacing: "-0.5px",
						}}
					>
						{headline}
					</span>
				</div>

				{/* Visual Storytelling Feature: LegalProcessDiagram (4 Stages) */}
				<LegalProcessDiagram isDark={false} />

				{/* Constitutional Status Banner: Highlighting Pending Gazette Status */}
				<RecommendationStatusVisual
					statusTitle="CONSTITUTIONAL STATUS & TIMELINE"
					description={
						isCommencementAwaited
							? "Approved in principle by GST Council. Operative legal effect occurs only upon publication in the official Gazette under Section 1(2) of the amending Act."
							: "Statutory amendment published in the official Gazette and formally enacted."
					}
					isDark={false}
					severity="caution"
				/>

				{/* Two Asymmetric Statutory Focus Cards */}
				<div
					style={{
						display: "flex",
						flexDirection: "row",
						gap: "20px",
						margin: "18px 0",
					}}
				>
					{/* Card A: Section 69 Legislative Requirement */}
					<div
						style={{
							display: "flex",
							flexDirection: "column",
							flex: 1,
							backgroundColor: COLORS.brandLightElevated,
							border: `1.5px solid ${COLORS.brandLightBorder}`,
							borderLeft: `5px solid ${COLORS.brandNavyAccent}`,
							borderRadius: "18px",
							padding: "20px 22px",
							boxShadow: "0 6px 18px rgba(0,0,0,0.03)",
						}}
					>
						<span
							style={{
								fontFamily: TYPOGRAPHY.fontFamily,
								fontSize: "12px",
								fontWeight: TYPOGRAPHY.weights.bold,
								color: COLORS.brandNavyAccent,
								letterSpacing: "1px",
								textTransform: "uppercase",
								marginBottom: "6px",
							}}
						>
							Legislative Requirement
						</span>
						<span
							style={{
								fontFamily: TYPOGRAPHY.fontFamily,
								fontSize: "17px",
								fontWeight: TYPOGRAPHY.weights.medium,
								color: COLORS.textDarkPrimary,
								lineHeight: 1.45,
							}}
						>
							{bullet1}
						</span>
					</div>

					{/* Card B: Administrative Proof Burden */}
					<div
						style={{
							display: "flex",
							flexDirection: "column",
							flex: 1,
							backgroundColor: COLORS.brandLightElevated,
							border: `1.5px solid ${COLORS.brandLightBorder}`,
							borderLeft: `5px solid ${COLORS.accentEmerald}`,
							borderRadius: "18px",
							padding: "20px 22px",
							boxShadow: "0 6px 18px rgba(0,0,0,0.03)",
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
								marginBottom: "6px",
							}}
						>
							Administrative Instruction
						</span>
						<span
							style={{
								fontFamily: TYPOGRAPHY.fontFamily,
								fontSize: "17px",
								fontWeight: TYPOGRAPHY.weights.medium,
								color: COLORS.textDarkPrimary,
								lineHeight: 1.45,
							}}
						>
							{bullet2}
						</span>
					</div>
				</div>

				{/* Bottom Adjudication Strip */}
				<div
					style={{
						display: "flex",
						flexDirection: "row",
						alignItems: "center",
						backgroundColor: "rgba(11, 37, 69, 0.04)",
						border: `1px solid rgba(11, 37, 69, 0.1)`,
						borderRadius: "14px",
						padding: "14px 20px",
					}}
				>
					<span
						style={{
							fontFamily: TYPOGRAPHY.fontFamily,
							fontSize: "14px",
							fontWeight: TYPOGRAPHY.weights.medium,
							color: COLORS.brandNavy,
							lineHeight: 1.35,
						}}
					>
						Adjudication Standard: {bullet3}
					</span>
				</div>
			</div>

			{/* Slide Footer */}
			<SlideFooter isDark={false} sourceDomain={sourceDomain} isLastSlide={false} />
		</div>
	);
};
