import assert from "node:assert/strict";
import test from "node:test";

import {
  createIntroDraft,
  describeIntroNeed,
  humanizeNeedPhrase,
  isSelfConnectorDemo,
  shortCompanyLabel,
} from "./introDraft";
import type { MatchResult } from "../types/match";

const sampleMatch = {
  candidate: {
    id: "arbaz",
    name: "Arbaz Shaikh",
    qualityTier: "enriched",
    trustEdge: { band: "strong", rationale: "Deep working sessions." },
    brings: [],
    triggerSurfaces: [],
  },
  situation_summary:
    "I have the next build implementation details ready, but I need an implementation partner with graph database experience.",
  need_dimension:
    "an implementation partner who can break problems into smart steps with research-backed graph work",
  confidence: { overall: 0.84, complementarity: 0.8, trigger: 0.8, trust: 0.9, reason: "strong" },
  selection: {
    topBrings: [{ claim: "First-principles problem-definition", evidence: "patent" }],
    triggerSurface: { label: "thesis pressure-test", whyThisPerson: "x", evidence: "y" },
  },
  source: "off-script",
  why_spine: {
    trigger: "This is Arbaz Shaikh.",
    complementarity: "Research-grade depth.",
    trust_bridge: "Strong edge.",
    frame: "Why this matters now: implementation partner for graph build.",
  },
} satisfies MatchResult;

test("detects self-connector demo when founder shares connector first name", () => {
  assert.equal(isSelfConnectorDemo("Ajay Suwalka", "Ajay"), true);
  assert.equal(isSelfConnectorDemo("Umang Patel", "Ajay"), false);
});

test("humanizes first-person situation summaries for intro copy", () => {
  assert.match(
    humanizeNeedPhrase(
      "I have the next build implementation details ready, but I need an implementation partner",
    ),
    /they have/i,
  );
});

test("creates a clean self-demo intro without meta frame text", () => {
  const draft = createIntroDraft(
    sampleMatch,
    {
      name: "Ajay Suwalka",
      company:
        "AI relationship intelligence: find the 1 person who unlocks your next step.",
    },
    "Ajay",
  );

  assert.match(draft, /^Hey Ajay — would you warm-intro me to Arbaz Shaikh\?/);
  assert.doesNotMatch(draft, /Use this intro to unlock/i);
  assert.doesNotMatch(draft, /could you introduce Ajay Suwalka/i);
  assert.match(draft, /implementation partner who can break problems/i);
});

test("uses need_dimension before raw situation summary", () => {
  assert.match(
    describeIntroNeed(sampleMatch),
    /implementation partner who can break problems/i,
  );
});

test("shortens long company headlines for intro line", () => {
  assert.equal(
    shortCompanyLabel(
      "AI relationship intelligence: find the 1 person who unlocks your next step.",
    ),
    "AI relationship intelligence",
  );
});
