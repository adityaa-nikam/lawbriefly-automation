import React from "react";
import { CANVAS, COLORS, TYPOGRAPHY } from "../tokens";
import { SlideHeader } from "./SlideHeader";
import { SlideFooter } from "./SlideFooter";
import { SourcePublicationBlock, type SourceItem } from "./SourcePublicationBlock";
import { RecommendationStatusVisual } from "./RecommendationStatusVisual";
import { BrandSignature } from "./BrandSignature";
import { SectionTransition } from "./SectionTransition";

export interface SourcesDisclaimerSlideProps {
	headline: string;
	sources: SourceItem[];
	slideNumber: number;
	totalSlides: number;
	sourceDomain?: string;
	isSingleSource?: boolean;
}

export const SourcesDisclaimerSlide: React.FC<SourcesDisclaimerSlideProps> = ({
	headline,
	sources,
	slideNumber,
	totalSlides,
	sourceDomain,
	isSingleSource = true,
}) => {
	const defaultSources: SourceItem[] =
		sources && sources.length > 0
			? sources
			: [
					{
						domain: "menafn.com",
						title: "CII Hails GST Reforms As Transition To Trust-Based Governance",
					},
			  ];

	return (
		<div
			style={{
				width: `${CANVAS.width}px`,
				height: `${CANVAS.height}px`,
				backgroundColor: COLORS.brandIvory,
				backgroundImage: `radial-gradient(circle at 50% 10%, rgba(11, 37, 69, 0.05) 0%, rgba(251, 251, 254, 0) 70%)`,
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
				category="EDITORIAL & SOURCES"
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
					<SectionTransition sectionNumber="04" sectionTitle="CLOSING SYNTHESIS & EDITORIAL PROVENANCE" />
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
						{headline || "Authoritative Sources & Editorial Notice"}
					</span>
				</div>

				{/* Visual Feature 1: SourcePublicationBlock */}
				<SourcePublicationBlock
					sources={defaultSources}
					isSingleSource={isSingleSource}
					isDark={false}
				/>

				{/* Visual Feature 2: RecommendationStatusVisual / Verification Limitations */}
				<RecommendationStatusVisual
					statusTitle="EDITORIAL VERIFICATION & LIMITATIONS"
					description="Single-source topic: factual assertions synthesized from industry media reporting. Independent statutory corroboration and official Gazette notification required before relying on proposals in active proceedings."
					isDark={false}
					severity="caution"
				/>

				{/* Visual Feature 3: Mandatory Legal Journalism Disclaimer */}
				<div
					style={{
						display: "flex",
						flexDirection: "column",
						backgroundColor: "rgba(11, 37, 69, 0.03)",
						border: `1.5px solid rgba(11, 37, 69, 0.09)`,
						borderRadius: "18px",
						padding: "18px 22px",
						margin: "16px 0",
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
							marginBottom: "4px",
						}}
					>
						Mandatory Legal Notice
					</span>
					<span
						style={{
							fontFamily: TYPOGRAPHY.fontFamily,
							fontSize: "15px",
							fontWeight: TYPOGRAPHY.weights.medium,
							color: COLORS.textDarkSecondary,
							lineHeight: 1.45,
						}}
					>
						LawBriefly provides legal journalism and analysis for informational and educational purposes only. This briefing does not constitute formal legal counsel or tax advisory. Verification against primary statutory Gazette notifications is advised.
					</span>
				</div>

				{/* Visual Feature 4: Authoritative BrandSignature Colophon */}
				<BrandSignature isDark={false} />
			</div>

			{/* Slide Footer */}
			<SlideFooter isDark={false} sourceDomain={sourceDomain} isLastSlide={true} />
		</div>
	);
};
