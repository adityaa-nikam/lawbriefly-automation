import React from "react";
import { CANVAS, COLORS, TYPOGRAPHY } from "../tokens";
import { SlideHeader } from "./SlideHeader";
import { SlideFooter } from "./SlideFooter";
import { StakeholderImpactVisual, type StakeholderPillar } from "./StakeholderImpactVisual";
import { EditorialQuote } from "./EditorialQuote";
import { SectionTransition } from "./SectionTransition";

export interface WhyItMattersSlideProps {
	headline: string;
	bodyText?: string;
	bullets: string[];
	category?: string;
	slideNumber: number;
	totalSlides: number;
	sourceDomain?: string;
	visualElement?: string;
}

export const WhyItMattersSlide: React.FC<WhyItMattersSlideProps> = ({
	headline,
	bodyText,
	bullets,
	category = "LEGAL SIGNIFICANCE",
	slideNumber,
	totalSlides,
	sourceDomain,
}) => {
	const bullet1 =
		bullets[0] ||
		"Enhanced working capital efficiency and reduced compliance friction across manufacturing and services.";
	const bullet2 =
		bullets[1] ||
		"Judicial discretion in sentencing expanded; coercive arrests eliminated for standard tax assessment disputes.";

	const pillars: StakeholderPillar[] = [
		{
			stakeholderGroup: "FOR ENTERPRISE & MSMES",
			headline: "Working Capital Protection",
			bulletPoints: [
				bullet1,
				"Eliminates coercive threat of custodial arrest during ongoing assessment audits.",
			],
			iconName: "rupee",
			badgeLabel: "COMMERCIAL IMPACT",
			accentColor: COLORS.accentEmerald,
			isPrimary: true,
		},
		{
			stakeholderGroup: "FOR ADVOCATES & TAX OFFICERS",
			headline: "Adjudication Integrity",
			bulletPoints: [
				bullet2,
				"Enforces CBIC documentary proof threshold before penal proceedings can be tabled.",
			],
			iconName: "document",
			badgeLabel: "PRACTICE IMPACT",
			accentColor: COLORS.brandGold,
			isPrimary: false,
		},
	];

	return (
		<div
			style={{
				width: `${CANVAS.width}px`,
				height: `${CANVAS.height}px`,
				backgroundColor: "#081220",
				backgroundImage: `radial-gradient(circle at 85% 15%, rgba(19, 62, 135, 0.38) 0%, rgba(8, 18, 32, 0) 65%), radial-gradient(circle at 15% 85%, rgba(5, 150, 105, 0.16) 0%, rgba(8, 18, 32, 0) 55%)`,
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
				isDark={true}
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
					<SectionTransition sectionNumber="03" sectionTitle="PRACTICE IMPACT & STAKEHOLDER SHIFTS" isDark={true} />
					<span
						style={{
							fontFamily: TYPOGRAPHY.fontFamily,
							fontSize: `${TYPOGRAPHY.sizes.headlineSlide}px`,
							fontWeight: TYPOGRAPHY.weights.extraBold,
							color: COLORS.textLightPrimary,
							lineHeight: 1.2,
							letterSpacing: "-0.5px",
						}}
					>
						{headline}
					</span>
				</div>

				{/* Visual Storytelling Feature: StakeholderImpactVisual (Split Comparison) */}
				<StakeholderImpactVisual pillars={pillars} isDark={true} />

				{/* High-Impact EditorialQuote Takeaway */}
				<EditorialQuote
					kicker="CORE TAKEAWAY FOR ADVOCATES & TAX PROFESSIONALS"
					quoteText={
						bodyText ||
						"The reform formally de-links commercial interpretation disputes from coercive criminal custody, requiring evidence-backed adjudication before penal intervention."
					}
					isDark={true}
				/>

				{/* Bottom Practical Advisory Strip */}
				<div
					style={{
						display: "flex",
						flexDirection: "row",
						alignItems: "center",
						backgroundColor: "rgba(255, 255, 255, 0.05)",
						border: `1px solid rgba(255, 255, 255, 0.1)`,
						borderRadius: "14px",
						padding: "14px 20px",
					}}
				>
					<span
						style={{
							fontFamily: TYPOGRAPHY.fontFamily,
							fontSize: "14px",
							fontWeight: TYPOGRAPHY.weights.medium,
							color: COLORS.textLightSecondary,
							lineHeight: 1.35,
						}}
					>
						Practical Guidance: Review ongoing audits and show-cause notices for compliance with CBIC documentary substantiation rules before responding to assessment orders.
					</span>
				</div>
			</div>

			{/* Slide Footer */}
			<SlideFooter isDark={true} sourceDomain={sourceDomain} isLastSlide={false} />
		</div>
	);
};
