export type TrustBand = "acquaintance" | "warm" | "strong";
export type CandidateBringKind =
  | "capability"
  | "resource"
  | "judgment"
  | "network"
  | "lived_experience";

export type CandidateBring = {
  kind: CandidateBringKind;
  claim: string;
  evidence: string;
};

export type CandidateTriggerSurface = {
  label: string;
  situationPattern: string;
  whyThisPerson: string;
  evidence: string;
};

export type CandidateTrustEdge = {
  band: TrustBand;
  rationale: string;
  lastTouch?: string;
};

export type Candidate = {
  id: string;
  name: string;
  qualityTier: "golden" | "enriched" | "tag-only";
  axisPrefilter?: string[];
  brings: CandidateBring[];
  triggerSurfaces: CandidateTriggerSurface[];
  trustEdge: CandidateTrustEdge;
};

export type WhySpine = {
  trigger: string;
  complementarity: string;
  trust_bridge: string;
  frame: string;
};

export type MatchConfidence = {
  overall: number;
  complementarity: number;
  trigger: number;
  trust: number;
  reason: string;
};

export type MatchSelection = {
  topBrings: CandidateBring[];
  triggerSurface: CandidateTriggerSurface;
};

export type MatchResult = {
  candidate: Candidate | null;
  why_spine: WhySpine;
  situation_summary: string;
  source: "off-script" | "no-match" | "cap";
  confidence?: MatchConfidence;
  selection?: MatchSelection;
  cap_status?: "open" | "reached";
  no_match_reason?: string;
  hard_cap_reached?: boolean;
  replacement_of_candidate_id?: string;
};
