import {
  buildCommentCodingRequest,
  buildFindingCorroborationRequest,
  buildInterventionMatchingRequest,
  buildResponseQualityRequest,
} from "../app/lib/system-one.js";

export const evaluationCases = [
  {
    id: "themes_resource_and_process",
    application: "comment_coding",
    request: buildCommentCodingRequest({
      pillar: "Innovation process management",
      prompt: "What prevents good ideas from reaching implementation?",
      comment: "Teams can submit ideas, but nobody owns the handover and there is never protected time to run a pilot.",
    }),
    expect: {
      primary_pillar: { choice: ["process", "cross_cutting"] },
      theme_resource_constraints: { min: 0.65 },
      theme_process_clarity: { min: 0.65 },
      theme_implementation_and_adoption: { min: 0.65 },
      contains_identifying_detail: { max: 0.2 },
      actionability: { min: 1.25 },
    },
  },
  {
    id: "themes_safety",
    application: "comment_coding",
    request: buildCommentCodingRequest({
      pillar: "Innovation environment management",
      prompt: "What makes it easier or harder to experiment?",
      comment: "After the last failed pilot, the project lead was blamed publicly. People now keep early ideas to themselves.",
    }),
    expect: {
      primary_pillar: { choice: ["environment"] },
      theme_psychological_safety: { min: 0.8 },
      theme_experimentation: { min: 0.65 },
      contains_identifying_detail: { max: 0.35 },
      actionability: { min: 1.1 },
    },
  },
  {
    id: "themes_non_substantive",
    application: "comment_coding",
    request: buildCommentCodingRequest({
      pillar: "Strategic innovation intent",
      prompt: "What would improve innovation priorities?",
      comment: "No comment.",
    }),
    expect: {
      primary_pillar: { choice: ["none"] },
      actionability: { max: 0.35 },
      contains_identifying_detail: { max: 0.1 },
    },
  },
  {
    id: "finding_support",
    application: "finding_corroboration",
    request: buildFindingCorroborationRequest({
      comment: "The strategy deck exists, but my team cannot explain which two customer problems we are meant to prioritise this year.",
      finding: {
        title: "Strategy exists on paper, not in people's line of sight",
        conclusion: "A documented innovation strategy has not become operational meaning for employees.",
        alternatives: "The strategy may have been refreshed too recently to cascade.",
      },
    }),
    expect: {
      supports_finding: { min: 0.8 },
      contradicts_finding: { max: 0.2 },
      evidence_relevance: { min: 1.4 },
    },
  },
  {
    id: "finding_contradiction",
    application: "finding_corroboration",
    request: buildFindingCorroborationRequest({
      comment: "Our quarterly brief names the three innovation priorities, and every team has translated them into its own objectives.",
      finding: {
        title: "Strategy exists on paper, not in people's line of sight",
        conclusion: "A documented innovation strategy has not become operational meaning for employees.",
      },
    }),
    expect: {
      supports_finding: { max: 0.2 },
      contradicts_finding: { min: 0.8 },
      evidence_relevance: { min: 1.4 },
    },
  },
  {
    id: "finding_irrelevant",
    application: "finding_corroboration",
    request: buildFindingCorroborationRequest({
      comment: "The office coffee machine is unreliable on Mondays.",
      finding: {
        title: "Strategy exists on paper, not in people's line of sight",
        conclusion: "A documented innovation strategy has not become operational meaning for employees.",
      },
    }),
    expect: {
      supports_finding: { max: 0.15 },
      contradicts_finding: { max: 0.15 },
      evidence_relevance: { max: 0.35 },
    },
  },
  {
    id: "quality_usable",
    application: "response_quality",
    request: buildResponseQualityRequest({
      prompt: "What blocks experiments from progressing?",
      comment: "Legal review starts only after the pilot is designed, so teams lose six weeks and often abandon it.",
    }),
    expect: {
      quality: { choice: ["usable"] },
      contains_identifying_detail: { max: 0.2 },
    },
  },
  {
    id: "quality_gibberish",
    application: "response_quality",
    request: buildResponseQualityRequest({
      prompt: "What blocks experiments from progressing?",
      comment: "asdf qwerty 123 test test",
    }),
    expect: {
      quality: { choice: ["test_or_gibberish"] },
      contains_identifying_detail: { max: 0.1 },
    },
  },
  {
    id: "quality_identity_risk",
    application: "response_quality",
    request: buildResponseQualityRequest({
      prompt: "What makes it hard to raise ideas?",
      comment: "Nomsa Dlamini, the only procurement lead in Durban, rejected my proposal in the 12 August review.",
    }),
    expect: {
      quality: { choice: ["usable"] },
      contains_identifying_detail: { min: 0.9 },
    },
  },
  {
    id: "intervention_match",
    application: "intervention_matching",
    request: buildInterventionMatchingRequest({
      finding: {
        title: "Ideas disappear after submission",
        conclusion: "Employees do not know who owns submitted ideas and receive no status feedback.",
        validate: "Trace ten ideas from submission to current disposition.",
      },
      candidates: [
        { id: "transparent_funnel", summary: "Publish a visible idea funnel with owner, stage, decision date and feedback for every submission.", intendedOutcome: "Restore trust in idea capture and decisions." },
        { id: "skills_bootcamp", summary: "Run practical experimentation and business-case training for project teams.", intendedOutcome: "Improve experimentation capability." },
        { id: "customer_panel", summary: "Create a standing customer co-design panel for early discovery.", intendedOutcome: "Improve external problem evidence." },
      ],
    }),
    expect: {
      intervention: { choice: ["transparent_funnel"] },
    },
  },
  {
    id: "intervention_none",
    application: "intervention_matching",
    request: buildInterventionMatchingRequest({
      finding: {
        title: "Value is not measured",
        conclusion: "Teams stop tracking outcomes after launch, so realised benefits are unknown.",
      },
      candidates: [
        { id: "customer_panel", summary: "Create a standing customer co-design panel for early discovery." },
        { id: "psychological_safety", summary: "Train managers to respond constructively when employees challenge decisions." },
      ],
    }),
    expect: {
      intervention: { choice: ["none"] },
    },
  },
];
