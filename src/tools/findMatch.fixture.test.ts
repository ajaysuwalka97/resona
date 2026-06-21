import assert from "node:assert/strict";
import test from "node:test";

import type { Candidate } from "../types/match";
import {
  findMatchCore,
  type CandidateScorer,
} from "./findMatch";
import { matcherFixtureCandidates } from "./findMatch.fixture";

function isDistributionStyleNeed(situationSummary: string): boolean {
  const normalized = situationSummary.toLowerCase();
  return (
    normalized.includes("distribution") ||
    normalized.includes("channel") ||
    normalized.includes("gtm") ||
    normalized.includes("operator")
  );
}

function scoreForCandidateId(candidateId: string, situationSummary: string) {
  switch (candidateId) {
    case "warm-distribution-operator":
      return {
        complementarity: 0.86,
        trigger: 0.83,
        selectedBringIndices: [0, 1],
        selectedTriggerIndex: 0,
        reason: "Strong distribution complementarity with specific trigger.",
      };
    case "acquaintance-distribution-broker":
      return {
        complementarity: 0.97,
        trigger: 0.88,
        selectedBringIndices: [0],
        selectedTriggerIndex: 0,
        reason: "Looks relevant but trust is weak.",
      };
    case "strong-conviction-founder":
      if (isDistributionStyleNeed(situationSummary)) {
        return {
          complementarity: 0.25,
          trigger: 0.18,
          selectedBringIndices: [0],
          selectedTriggerIndex: 0,
          reason: "Conviction profile does not directly match this distribution blocker.",
        };
      }
      return {
        complementarity: 0.89,
        trigger: 0.84,
        selectedBringIndices: [0, 1],
        selectedTriggerIndex: 0,
        reason: "Strong conviction-focused complementarity and trigger.",
      };
    case "warm-generic-trigger":
      return {
        complementarity: 0.62,
        trigger: 0.18,
        selectedBringIndices: [0],
        selectedTriggerIndex: 0,
        reason: "Trigger is generic category membership only.",
      };
    case "missing-evidence":
      return {
        complementarity: 0.9,
        trigger: 0.82,
        selectedBringIndices: [0],
        selectedTriggerIndex: 0,
        reason: "Would score high if evidence existed.",
      };
    default:
      return {
        complementarity: 0.2,
        trigger: 0.2,
        selectedBringIndices: [],
        selectedTriggerIndex: null,
        reason: "No strong match signal.",
      };
  }
}

const fixtureScorer: CandidateScorer = async ({ situationSummary, candidate }) =>
  scoreForCandidateId(candidate.id, situationSummary);

test("distribution-style ask selects warm edge over higher-fit acquaintance", async () => {
  const result = await findMatchCore(
    {
      situation_summary:
        "Lead is in, but founder wants to keep strategic allocation for someone who can open CPG distribution doors now.",
      need_dimension: "strategic distribution unlock",
    },
    "real",
    {
      candidateSource: matcherFixtureCandidates,
      candidateScorer: fixtureScorer,
    },
  );

  assert.ok(result.candidate);
  assert.equal(result.source, "off-script");
  assert.equal(result.candidate.id, "warm-distribution-operator");
  assert.ok(result.confidence);
  assert.equal(result.confidence?.trust, 0.65);
  assert.ok(result.selection);
  assert.equal(
    result.selection?.triggerSurface.label,
    "open strategic allocation needs real distribution unlock",
  );
  assert.ok(result.why_spine.trigger.length > 0);
  assert.ok(result.why_spine.complementarity.length > 0);
  assert.ok(result.why_spine.trust_bridge.length > 0);
  assert.ok(result.why_spine.frame.length > 0);
  assert.match(
    result.why_spine.trigger,
    /^This is Warm Distribution Operator\./,
  );
  assert.match(result.why_spine.trigger, /evidence/i);
});

test("conviction ask clears all bars with strong edge and emits reveal-ready spine", async () => {
  const result = await findMatchCore(
    {
      situation_summary:
        "Founder has momentum but remaining investors still need category conviction to close the round.",
      need_dimension: "belief conversion for final checks",
    },
    "real",
    {
      candidateSource: matcherFixtureCandidates,
      candidateScorer: fixtureScorer,
    },
  );

  assert.ok(result.candidate);
  assert.equal(result.source, "off-script");
  assert.equal(result.candidate.id, "strong-conviction-founder");
  assert.ok(result.confidence);
  assert.ok(result.selection);
  assert.equal(result.confidence?.trust, 0.9);
  assert.ok((result.confidence?.complementarity ?? 0) >= 0.55);
  assert.ok((result.confidence?.trigger ?? 0) >= 0.6);
  assert.ok((result.confidence?.overall ?? 0) >= 0.62);

  // Reveal contract: these strings are what the UI renders in the match card.
  assert.ok(result.why_spine.trigger.length > 0);
  assert.ok(result.why_spine.complementarity.length > 0);
  assert.ok(result.why_spine.trust_bridge.length > 0);
  assert.ok(result.why_spine.frame.length > 0);
  assert.match(
    result.why_spine.trigger,
    /^This is Strong Conviction Founder\./,
  );
  assert.match(result.why_spine.trust_bridge, /strong edge/i);
});

test("returns principled no-match when only acquaintance edge exists", async () => {
  const acquaintanceOnly = matcherFixtureCandidates.filter(
    (candidate) => candidate.id === "acquaintance-distribution-broker",
  );

  const result = await findMatchCore(
    {
      situation_summary:
        "Need a strategic distribution allocator who can safely be introduced now.",
    },
    "real",
    {
      candidateSource: acquaintanceOnly,
      candidateScorer: fixtureScorer,
    },
  );

  assert.equal(result.candidate, null);
  assert.match(
    result.no_match_reason ?? "",
    /warm\/strong trust edge/i,
  );
});

test("drops cards missing evidence and fails gracefully", async () => {
  const missingEvidenceCandidate: Candidate = {
    id: "missing-evidence",
    name: "Missing Evidence Candidate",
    qualityTier: "enriched",
    // Dormant metadata; matcher should ignore this for pooling.
    axisPrefilter: ["distribution"],
    brings: [
      {
        kind: "network",
        claim: "Claims broad access to retail operators.",
        evidence: "",
      },
    ],
    triggerSurfaces: [
      {
        label: "retail access",
        situationPattern: "Founder needs distribution doors.",
        whyThisPerson: "Supposedly has broad access.",
        evidence: "",
      },
    ],
    trustEdge: {
      band: "strong",
      rationale: "Known deeply by Ajay.",
      lastTouch: "2026-05",
    },
  };

  const result = await findMatchCore(
    {
      situation_summary:
        "Need strategic distribution support in the next two weeks.",
    },
    "real",
    {
      candidateSource: [missingEvidenceCandidate],
      candidateScorer: fixtureScorer,
    },
  );

  assert.equal(result.candidate, null);
  assert.match(
    result.no_match_reason ?? "",
    /specific, situation-grounded trigger|complementarity/i,
  );
});

test("LLM scoring runs in parallel over scoring pool", async () => {
  let activeCalls = 0;
  let maxConcurrent = 0;

  const delayedScorer: CandidateScorer = async ({ situationSummary, candidate }) => {
    activeCalls += 1;
    maxConcurrent = Math.max(maxConcurrent, activeCalls);
    await new Promise((resolve) => setTimeout(resolve, 25));
    activeCalls -= 1;
    return scoreForCandidateId(candidate.id, situationSummary);
  };

  await findMatchCore(
    {
      situation_summary:
        "Lead is secured; allocation is open for someone who can accelerate distribution now.",
    },
    "real",
    {
      candidateSource: matcherFixtureCandidates,
      candidateScorer: delayedScorer,
    },
  );

  assert.ok(
    maxConcurrent > 1,
    `Expected parallel scoring but observed max concurrency ${maxConcurrent}.`,
  );
});

function makeNoiseCandidate(id: string, label: string): Candidate {
  return {
    id,
    name: label,
    qualityTier: "enriched",
    brings: [
      {
        kind: "capability",
        claim: "Experienced in finance operations planning.",
        evidence: "Recently advised teams on forecasting cadence.",
      },
    ],
    triggerSurfaces: [
      {
        label: "finance operations support",
        situationPattern: "Needs budgeting process discipline.",
        whyThisPerson: "Operates strong finance playbooks.",
        evidence: "Has repeated advisory outcomes in finance workflows.",
      },
    ],
    trustEdge: {
      band: "warm",
      rationale: "Known and responsive in prior intros.",
      lastTouch: "2026-05",
    },
  };
}

test("semantic prefilter keeps relevant candidate inside capped scoring pool", async () => {
  const relevantCandidate: Candidate = {
    id: "relevant-design-partner",
    name: "Relevant Design Partner",
    qualityTier: "enriched",
    brings: [
      {
        kind: "network",
        claim: "Can open healthcare design-partner conversations quickly.",
        evidence: "Introduced three founders to active pilot buyers last quarter.",
      },
    ],
    triggerSurfaces: [
      {
        label: "healthcare design-partner unlock",
        situationPattern: "Founder needs design partners for pilot proof quickly.",
        whyThisPerson: "Maintains active design-partner operators in healthcare.",
        evidence: "Recent warm intros converted to pilot-scoping calls.",
      },
    ],
    trustEdge: {
      band: "warm",
      rationale: "Has run successful founder intros with Ajay recently.",
      lastTouch: "2026-05",
    },
  };

  const noiseCandidates = [
    makeNoiseCandidate("noise-1", "Noise Candidate 1"),
    makeNoiseCandidate("noise-2", "Noise Candidate 2"),
    makeNoiseCandidate("noise-3", "Noise Candidate 3"),
    makeNoiseCandidate("noise-4", "Noise Candidate 4"),
    makeNoiseCandidate("noise-5", "Noise Candidate 5"),
    makeNoiseCandidate("noise-6", "Noise Candidate 6"),
    makeNoiseCandidate("noise-7", "Noise Candidate 7"),
  ];

  const calledIds: string[] = [];
  const scorer: CandidateScorer = async ({ candidate }) => {
    calledIds.push(candidate.id);
    return {
      complementarity: 0.2,
      trigger: 0.2,
      selectedBringIndices: [0],
      selectedTriggerIndex: 0,
      reason: "Low confidence synthetic score for pool-shape test.",
    };
  };

  await findMatchCore(
    {
      situation_summary:
        "Need design partners in healthcare for immediate pilot validation.",
      need_dimension: "healthcare design partners",
    },
    "real",
    {
      candidateSource: [relevantCandidate, ...noiseCandidates],
      candidateScorer: scorer,
    },
  );

  assert.equal(calledIds.length, 6);
  assert.ok(calledIds.includes("relevant-design-partner"));
  assert.ok(!calledIds.includes("noise-7"));
});
