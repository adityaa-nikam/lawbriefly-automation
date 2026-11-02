import React from "react";
import { COLORS, TYPOGRAPHY } from "../tokens";

export interface ProcessStage {
	stepNumber: number;
	stageTitle: string;
	authority: string;
	statusText: string;
	isCompleted?: boolean;
	isActive?: boolean;
}

export interface LegalProcessDiagramProps {
	stages?: ProcessStage[];
	isDark?: boolean;
}

const DEFAULT_STAGES: ProcessStage[] = [
	{
		stepNumber: 1,
		stageTitle: "Council Recommendation",
		authority: "GST Council Decision",
		statusText: "APPROVED IN PRINCIPLE",
		isCompleted: true,
	},
	{
		stepNumber: 2,
		stageTitle: "Parliamentary Bill",
		authority: "CGST Amendment Act",
		statusText: "PENDING INTRODUCTION",
		isActive: true,
	},
	{
		stepNumber: 3,
		stageTitle: "Gazette Notification",
		authority: "Central Govt Official Gazette",
		statusText: "AWAITED",
	},
	{
		stepNumber: 4,
		stageTitle: "Enforcement Date",
		authority: "Statutory Commencement § 1(2)",
		statusText: "OPERATIVE LAW",
	},
];

export const LegalProcessDiagram: React.FC<LegalProcessDiagramProps> = ({
	stages = DEFAULT_STAGES,
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
				padding: "26px 28px",
				boxShadow: isDark ? "0 10px 30px rgba(0,0,0,0.35)" : "0 8px 24px rgba(0,0,0,0.04)",
				marginBottom: "20px",
			}}
		>
			{/* Header */}
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
				<div style={{ display: "flex", flexDirection: "row", alignItems: "center" }}>
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
						LEGISLATIVE & PROCEDURAL SEQUENCE
					</span>
				</div>

				<div
					style={{
						display: "flex",
						alignItems: "center",
						padding: "4px 12px",
						borderRadius: "999px",
						backgroundColor: "rgba(217, 119, 6, 0.12)",
						border: "1px solid rgba(217, 119, 6, 0.3)",
					}}
				>
					<span
						style={{
							fontFamily: TYPOGRAPHY.fontFamily,
							fontSize: "11px",
							fontWeight: TYPOGRAPHY.weights.bold,
							color: COLORS.accentAmberDeep,
							letterSpacing: "0.5px",
						}}
					>
						STAGE 1 OF 4 COMPLETED
					</span>
				</div>
			</div>

			{/* 4 Process Step Cards in Flow */}
			<div
				style={{
					display: "flex",
					flexDirection: "row",
					alignItems: "stretch",
					justifyContent: "space-between",
					gap: "12px",
				}}
			>
				{stages.map((stage, idx) => {
					let nodeBg: string = isDark ? "rgba(255,255,255,0.04)" : "rgba(11, 37, 69, 0.03)";
					let nodeBorder: string = isDark ? "rgba(255,255,255,0.08)" : "rgba(11, 37, 69, 0.08)";
					let badgeBg: string = isDark ? "rgba(255,255,255,0.06)" : "rgba(11, 37, 69, 0.06)";
					let badgeColor: string = isDark ? COLORS.textLightMuted : COLORS.textDarkMuted;

					if (stage.isCompleted) {
						nodeBg = isDark ? "rgba(5, 150, 105, 0.12)" : "rgba(5, 150, 105, 0.08)";
						nodeBorder = "1.5px solid rgba(5, 150, 105, 0.35)";
						badgeBg = "rgba(5, 150, 105, 0.18)";
						badgeColor = COLORS.accentEmerald;
					} else if (stage.isActive) {
						nodeBg = isDark ? "rgba(197, 168, 128, 0.14)" : "rgba(197, 168, 128, 0.12)";
						nodeBorder = "1.5px solid rgba(197, 168, 128, 0.5)";
						badgeBg = "rgba(197, 168, 128, 0.22)";
						badgeColor = isDark ? COLORS.brandGold : "#92400E";
					}

					return (
						<div
							key={idx}
							style={{
								display: "flex",
								flexDirection: "column",
								flex: 1,
								backgroundColor: nodeBg,
								border: nodeBorder,
								borderRadius: "16px",
								padding: "16px 14px",
								position: "relative",
							}}
						>
							{/* Step Number Circle */}
							<div
								style={{
									display: "flex",
									flexDirection: "row",
									justifyContent: "space-between",
									alignItems: "center",
									marginBottom: "10px",
								}}
							>
								<div
									style={{
										display: "flex",
										alignItems: "center",
										justifyContent: "center",
										width: "28px",
										height: "28px",
										borderRadius: "14px",
										backgroundColor: stage.isCompleted
											? COLORS.accentEmerald
											: stage.isActive
											? COLORS.brandGold
											: isDark
											? "rgba(255,255,255,0.15)"
											: "rgba(11, 37, 69, 0.15)",
									}}
								>
									{stage.isCompleted ? (
										<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
											<polyline points="20 6 9 17 4 12" />
										</svg>
									) : (
										<span
											style={{
												fontFamily: TYPOGRAPHY.fontFamily,
												fontSize: "13px",
												fontWeight: TYPOGRAPHY.weights.bold,
												color: stage.isActive ? "#FFFFFF" : isDark ? COLORS.textLightMuted : COLORS.textDarkMuted,
											}}
										>
											{String(stage.stepNumber)}
										</span>
									)}
								</div>

								{/* Connecting chevron if not last */}
								{idx < stages.length - 1 ? (
									<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={isDark ? "rgba(255,255,255,0.2)" : "rgba(11,37,69,0.2)"} strokeWidth="2.5">
										<polyline points="9 18 15 12 9 6" />
									</svg>
								) : null}
							</div>

							<span
								style={{
									fontFamily: TYPOGRAPHY.fontFamily,
									fontSize: "15px",
									fontWeight: TYPOGRAPHY.weights.bold,
									color: isDark ? COLORS.textLightPrimary : COLORS.textDarkPrimary,
									lineHeight: 1.25,
									marginBottom: "4px",
								}}
							>
								{stage.stageTitle}
							</span>

							<span
								style={{
									fontFamily: TYPOGRAPHY.fontFamily,
									fontSize: "12px",
									fontWeight: TYPOGRAPHY.weights.medium,
									color: isDark ? COLORS.textLightMuted : COLORS.textDarkMuted,
									lineHeight: 1.3,
									marginBottom: "10px",
									flexGrow: 1,
								}}
							>
								{stage.authority}
							</span>

							{/* Status Badge */}
							<div
								style={{
									display: "flex",
									alignItems: "center",
									justifyContent: "center",
									padding: "4px 6px",
									borderRadius: "6px",
									backgroundColor: badgeBg,
								}}
							>
								<span
									style={{
										fontFamily: TYPOGRAPHY.fontFamily,
										fontSize: "9px",
										fontWeight: TYPOGRAPHY.weights.bold,
										color: badgeColor,
										letterSpacing: "0.5px",
										textAlign: "center",
									}}
								>
									{stage.statusText}
								</span>
							</div>
						</div>
					);
				})}
			</div>
		</div>
	);
};
