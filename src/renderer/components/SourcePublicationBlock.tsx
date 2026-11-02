import React from "react";
import { COLORS, TYPOGRAPHY } from "../tokens";

export interface SourceItem {
	domain: string;
	title: string;
	url?: string;
}

export interface SourcePublicationBlockProps {
	sources: SourceItem[];
	isSingleSource?: boolean;
	isDark?: boolean;
}

export const SourcePublicationBlock: React.FC<SourcePublicationBlockProps> = ({
	sources,
	isSingleSource = true,
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
				marginBottom: "18px",
			}}
		>
			<div
				style={{
					display: "flex",
					flexDirection: "row",
					justifyContent: "space-between",
					alignItems: "center",
					marginBottom: "14px",
					paddingBottom: "10px",
					borderBottom: isDark ? "1px solid rgba(255,255,255,0.08)" : `1px solid ${COLORS.brandLightBorder}`,
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
					}}
				>
					REPORTING PROVENANCE & ATTRIBUTION
				</span>

				<div
					style={{
						display: "flex",
						alignItems: "center",
						padding: "4px 10px",
						borderRadius: "999px",
						backgroundColor: isSingleSource ? "rgba(217, 119, 6, 0.12)" : "rgba(5, 150, 105, 0.12)",
					}}
				>
					<span
						style={{
							fontFamily: TYPOGRAPHY.fontFamily,
							fontSize: "11px",
							fontWeight: TYPOGRAPHY.weights.bold,
							color: isSingleSource ? COLORS.accentAmberDeep : COLORS.accentEmerald,
							letterSpacing: "0.5px",
						}}
					>
						{isSingleSource ? "SINGLE-SOURCE TOPIC" : "MULTI-SOURCE VERIFIED"}
					</span>
				</div>
			</div>

			{sources.map((src, idx) => (
				<div
					key={idx}
					style={{
						display: "flex",
						flexDirection: "column",
						marginBottom: idx < sources.length - 1 ? "12px" : "0px",
					}}
				>
					<div style={{ display: "flex", flexDirection: "row", alignItems: "center", marginBottom: "4px" }}>
						<span
							style={{
								fontFamily: TYPOGRAPHY.fontFamily,
								fontSize: "13px",
								fontWeight: TYPOGRAPHY.weights.bold,
								color: isDark ? COLORS.brandGold : COLORS.brandNavyAccent,
								backgroundColor: isDark ? "rgba(255,255,255,0.06)" : COLORS.brandNavySurface,
								padding: "2px 8px",
								borderRadius: "6px",
								marginRight: "8px",
							}}
						>
							{src.domain}
						</span>
					</div>
					<span
						style={{
							fontFamily: TYPOGRAPHY.fontFamily,
							fontSize: "16px",
							fontWeight: TYPOGRAPHY.weights.medium,
							color: isDark ? COLORS.textLightPrimary : COLORS.textDarkPrimary,
							lineHeight: 1.4,
						}}
					>
						{src.title}
					</span>
				</div>
			))}
		</div>
	);
};
