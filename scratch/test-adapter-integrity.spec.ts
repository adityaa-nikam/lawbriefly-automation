import { describe, it, expect } from "vitest";
import {
	extractArticleIdsFromSelection,
	extractTopicArticlesFromSelection,
} from "../src/services/topic-article-extraction";
import type { GlobalTopicSelectionResponse } from "../src/services/topic-selection";

describe("Mercury Adapter Integrity Audit", () => {
	const mockGlobalSelection: GlobalTopicSelectionResponse = {
		success: true,
		provider: "openrouter",
		model: "inception/mercury-decide",
		window_days: 3,
		batch_size: 10,
		total_articles: 20,
		batch_count: 2,
		selection_status: "selected",
		selection_kind: "multi_source_trend",
		selected_topic: {
			candidate_id: "T002",
			topic_title: "Winning Legal Development",
			topic_summary: "Summary of winner",
			legal_domain: "corporate_commercial_law",
			jurisdiction: "india",
			editorial_angle: "Angle",
			selection_rationale: "Rationale",
			confidence: 0.94,
			evidence_metrics: {
				unique_article_count: 2,
				unique_source_host_count: 2,
				supporting_batch_count: 2,
				evidence_strength: "moderate_multi_source",
			},
			supporting_articles: [
				{
					article_id: "11111111-1111-4111-a111-111111111111",
					title: "Winner Article 1",
					description: "Desc 1",
					url: "https://ignored-mercury-url.com/1",
					last_seen_at: "2026-11-01T12:00:00Z",
				},
				{
					article_id: "22222222-2222-4222-a222-222222222222",
					title: "Winner Article 2",
					description: "Desc 2",
					url: "https://ignored-mercury-url.com/2",
					last_seen_at: "2026-11-01T13:00:00Z",
				},
			],
		},
		alternative_candidates: [
			{
				topic_title: "Losing Candidate 1",
				reason_not_selected: "Lower significance",
				article_ids: [
					"33333333-3333-4333-a333-333333333333",
					"44444444-4444-4444-a444-444444444444",
				],
			},
			{
				topic_title: "Losing Candidate 2",
				reason_not_selected: "Single source",
				article_ids: [
					"55555555-5555-4555-a555-555555555555",
				],
			},
		],
		quality_warnings: [],
	};

	it("extracts supporting article IDs exclusively from the selected topic and ignores alternative candidates", () => {
		const ids = extractArticleIdsFromSelection(mockGlobalSelection);

		expect(ids).toEqual([
			"11111111-1111-4111-a111-111111111111",
			"22222222-2222-4222-a222-222222222222",
		]);

		// Verify alternative candidate IDs were NOT collected
		expect(ids).not.toContain("33333333-3333-4333-a333-333333333333");
		expect(ids).not.toContain("44444444-4444-4444-a444-444444444444");
		expect(ids).not.toContain("55555555-5555-4555-a555-555555555555");
	});

	it("returns empty array safely when selection_status is no_strong_topic and selected_topic is null", () => {
		const noTopicSelection: GlobalTopicSelectionResponse = {
			...mockGlobalSelection,
			selection_status: "no_strong_topic",
			selection_kind: "no_strong_topic",
			selected_topic: null,
		};

		const ids = extractArticleIdsFromSelection(noTopicSelection);
		expect(ids).toEqual([]);
	});
});
