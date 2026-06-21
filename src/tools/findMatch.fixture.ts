import type { Candidate } from "../types/match";

export const matcherFixtureCandidates: Candidate[] = [
  {
    id: "warm-distribution-operator",
    name: "Warm Distribution Operator",
    qualityTier: "enriched",
    axisPrefilter: ["distribution"],
    brings: [
      {
        kind: "network",
        claim: "Can open direct introductions to CPG brand operators this quarter.",
        evidence: "Personally routed three CPG intros for Ajay in the last six weeks.",
      },
      {
        kind: "judgment",
        claim: "Knows how to fill a strategic allocation without diluting round quality.",
        evidence: "Advised two seed founders through strategic allocation decisions in 2026.",
      },
    ],
    triggerSurfaces: [
      {
        label: "open strategic allocation needs real distribution unlock",
        situationPattern: "Founder has capital committed but keeps strategic room open for GTM leverage.",
        whyThisPerson:
          "They pair check-writing proximity with active brand-operator routing, not just investor access.",
        evidence:
          "Has current operator channels in CPG and has recently routed warm intros that converted to meetings.",
      },
    ],
    trustEdge: {
      band: "warm",
      rationale:
        "Ajay and this operator have shipped multiple founder-intro loops together and can route asks without friction.",
      lastTouch: "2026-05",
    },
  },
  {
    id: "acquaintance-distribution-broker",
    name: "Acquaintance Distribution Broker",
    qualityTier: "enriched",
    axisPrefilter: ["distribution"],
    brings: [
      {
        kind: "network",
        claim: "Appears to have broad retail contacts.",
        evidence: "Was present in one networking event where retail leaders attended.",
      },
    ],
    triggerSurfaces: [
      {
        label: "distribution adjacency",
        situationPattern: "Any founder asking for distribution support.",
        whyThisPerson: "They are tagged in the distribution bucket.",
        evidence: "Category membership only.",
      },
    ],
    trustEdge: {
      band: "acquaintance",
      rationale:
        "Ajay has only met this person once in a group setting and has not routed founder intros through them yet.",
      lastTouch: "2026-03",
    },
  },
  {
    id: "strong-conviction-founder",
    name: "Strong Conviction Founder",
    qualityTier: "golden",
    axisPrefilter: ["conviction"],
    brings: [
      {
        kind: "lived_experience",
        claim: "Has personally raised in a category investors initially misread.",
        evidence: "Closed a difficult round after proving category traction with enterprise buyers.",
      },
      {
        kind: "judgment",
        claim: "Can sharpen investor narrative for skeptical late-stage allocators.",
        evidence: "Mentored four founders on conviction narratives for seed close conversations.",
      },
    ],
    triggerSurfaces: [
      {
        label: "remaining investors need category conviction",
        situationPattern: "Founder has momentum but needs belief conversion for final checks.",
        whyThisPerson:
          "They are a credible peer who has already solved this exact investor-conviction problem.",
        evidence:
          "Their own raise required changing investor belief in a misunderstood category before close.",
      },
    ],
    trustEdge: {
      band: "strong",
      rationale:
        "Ajay has an active, high-trust founder relationship and can make a high-context warm intro safely.",
      lastTouch: "2026-05",
    },
  },
  {
    id: "warm-generic-trigger",
    name: "Warm Generic Trigger",
    qualityTier: "enriched",
    axisPrefilter: ["distribution"],
    brings: [
      {
        kind: "capability",
        claim: "General startup advisor.",
        evidence: "Has advised founders occasionally on broad startup topics.",
      },
    ],
    triggerSurfaces: [
      {
        label: "distribution category tag",
        situationPattern: "Founder asks about distribution.",
        whyThisPerson: "This person sits in the distribution category.",
        evidence: "No situation-specific differentiator is available.",
      },
    ],
    trustEdge: {
      band: "warm",
      rationale:
        "Ajay knows this person and can reach them quickly, but role specificity is still generic.",
      lastTouch: "2026-04",
    },
  },
];
