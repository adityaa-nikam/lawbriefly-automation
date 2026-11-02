import React from "react";
import { CANVAS, COLORS, TYPOGRAPHY } from "../tokens";
import { SlideHeader } from "./SlideHeader";
import { SlideFooter } from "./SlideFooter";
import { NumberComparison } from "./NumberComparison";
import { SectionTransition } from "./SectionTransition";

export interface WhatHappenedSlideProps {
	headline: string;
	bodyText?: string;
	bullets: string[];
	category?: string;
	slideNumber: number;
	totalSlides: number;
	sourceDomain?: string;
	visualElement?: string;
}

export const WhatHappenedSlide: React.FC<WhatHappenedSlideProps> = ({
	headline,
	bodyText,
	bullets,
	category = "DEVELOPMENT SUMMARY",
	slideNumber,
	totalSlides,
	sourceDomain,
}) => {
	// Extract or fallback bullet content
	const bullet1 =
		bullets[0] ||
		"Omission of Section 69 arrest powers from the CGST Act removes coercive threat from tax administration.";
	const bullet2 =
		bullets[1] ||
		"Fivefold increase in monetary prosecution threshold from Rs 1 crore to Rs 5 crore protects legitimate business activity.";
	const bullet3 =
		bullets[2] ||
		"Imprisonment provisions and specified offences under Section 132 narrowed to separate civil disputes from deliberate fraud.";

	return (
		<div
			style={{
				width: `${CANVAS.width}px`,
				height: `${CANVAS.height}px`,
				backgroundColor: COLORS.brandIvory,
				backgroundImage: `radial-gradient(circle at 92% 8%, rgba(11, 37, 69, 0.06) 0%, rgba(251, 251, 254, 0) 60%)`,
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
					<SectionTransition sectionNumber="01" sectionTitle="FACTUAL OVERVIEW & COUNCIL DECISIONS" />
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

				{/* Visual Storytelling Feature: NumberComparison (Rs 1 Cr -> Rs 5 Cr) */}
				<NumberComparison
					title="MONETARY PROSECUTION THRESHOLD (CGST § 132)"
					fromLabel="CURRENT STATUTORY THRESHOLD"
					fromValue="Rs 1 Cr"
					fromSubtext="Existing limit for criminal prosecution"
					toLabel="PROPOSED THRESHOLD"
					toValue="Rs 5 Cr"
					toSubtext="Voluntary compliance buffer for enterprise"
					multiplierBadge="5x Expansion"
					isDark={false}
				/>

				{/* Asymmetric Split Layout: Section 69 Statutory Card (Left) + Substantive Points (Right) */}
				<div
					style={{
						display: "flex",
						flexDirection: "row",
						gap: "20px",
						alignItems: "stretch",
						marginBottom: "18px",
					}}
				>
					{/* Left Accent Card: § 69 Arrest Powers in Authority Navy */}
					<div
						style={{
							display: "flex",
							flexDirection: "column",
							width: "42%",
							backgroundColor: COLORS.brandNavy,
							borderRadius: "22px",
							padding: "24px 26px",
							boxShadow: "0 10px 28px rgba(11, 37, 69, 0.25)",
						}}
					>
						<div
							style={{
								display: "flex",
								alignItems: "center",
								padding: "4px 10px",
								borderRadius: "999px",
								backgroundColor: "rgba(197, 168, 128, 0.2)",
								border: "1px solid rgba(197, 168, 128, 0.4)",
								marginBottom: "12px",
								alignSelf: "flex-start",
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
								}}
							>
								CORE STATUTORY REFORM
							</span>
						</div>

						<span
							style={{
								fontFamily: TYPOGRAPHY.fontFamily,
								fontSize: "30px",
								fontWeight: TYPOGRAPHY.weights.extraBold,
								color: "#FFFFFF",
								lineHeight: 1.15,
								marginBottom: "4px",
							}}
						>
							§ 69 CGST Act
						</span>

						<span
							style={{
								fontFamily: TYPOGRAPHY.fontFamily,
								fontSize: "14px",
								fontWeight: TYPOGRAPHY.weights.bold,
								color: COLORS.accentCrimson,
								backgroundColor: "rgba(190, 18, 60, 0.18)",
								padding: "3px 8px",
								borderRadius: "6px",
								alignSelf: "flex-start",
								marginBottom: "14px",
							}}
						>
							POWER TO ARREST
						</span>

						<span
							style={{
								fontFamily: TYPOGRAPHY.fontFamily,
								fontSize: "16px",
								fontWeight: TYPOGRAPHY.weights.medium,
								color: COLORS.textLightSecondary,
								lineHeight: 1.45,
							}}
						>
							{bullet1}
						</span>
					</div>

					{/* Right Column: Structured Editorial Insights */}
					<div
						style={{
							display: "flex",
							flexDirection: "column",
							width: "58%",
							justifyContent: "space-between",
							gap: "14px",
						}}
					>
						{/* Card 1: Section 132 Offence Decriminalisation */}
						<div
							style={{
								display: "flex",
								flexDirection: "column",
								backgroundColor: COLORS.brandLightElevated,
								border: `1.5px solid ${COLORS.brandLightBorder}`,
								borderRadius: "18px",
								padding: "18px 22px",
								boxShadow: "0 4px 14px rgba(0,0,0,0.03)",
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
								Section 132 Offences Refined
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
								{bullet3}
							</span>
						</div>

						{/* Card 2: Industry Body Assessment (CII) */}
						<div
							style={{
								display: "flex",
								flexDirection: "column",
								backgroundColor: "rgba(197, 168, 128, 0.10)",
								border: `1.5px solid ${COLORS.brandGoldBorder}`,
								borderRadius: "18px",
								padding: "18px 22px",
							}}
						>
							<span
								style={{
									fontFamily: TYPOGRAPHY.fontFamily,
									fontSize: "12px",
									fontWeight: TYPOGRAPHY.weights.bold,
									color: "#92400E",
									letterSpacing: "1px",
									textTransform: "uppercase",
									marginBottom: "4px",
								}}
							>
								Apex Chamber Reaction
							</span>
							<span
								style={{
									fontFamily: TYPOGRAPHY.fontFamily,
									fontSize: "16px",
									fontWeight: TYPOGRAPHY.weights.medium,
									color: COLORS.textDarkPrimary,
									lineHeight: 1.45,
								}}
							>
								{bodyText || "Apex industry chamber CII praised the GST Council decisions on decriminalisation as a landmark transition toward trust-based economic governance."}
							</span>
						</div>
					</div>
				</div>

				{/* Bottom Editorial Footnote Strip */}
				<div
					style={{
						display: "flex",
						flexDirection: "row",
						alignItems: "center",
						backgroundColor: "rgba(11, 37, 69, 0.04)",
						border: `1px solid rgba(11, 37, 69, 0.1)`,
						borderRadius: "14px",
						padding: "12px 18px",
					}}
				>
					<div
						style={{
							width: "8px",
							height: "8px",
							borderRadius: "4px",
							backgroundColor: COLORS.brandNavyAccent,
							marginRight: "10px",
							flexShrink: 0,
						}}
					/>
					<span
						style={{
							fontFamily: TYPOGRAPHY.fontFamily,
							fontSize: "14px",
							fontWeight: TYPOGRAPHY.weights.medium,
							color: COLORS.brandNavy,
							lineHeight: 1.35,
						}}
					>
						Procedural Scope: Council recommendations form policy intent; operative statutory changes await Parliamentary enactment and Gazette notification.
					</span>
				</div>
			</div>

			{/* Slide Footer */}
			<SlideFooter isDark={false} sourceDomain={sourceDomain} isLastSlide={false} />
		</div>
	);
};
