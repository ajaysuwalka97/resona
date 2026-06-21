import type {
  Candidate,
  CandidateBring,
  CandidateTriggerSurface,
  MatchSelection,
  WhySpine,
} from "../types/match";

export function composeCandidateWhySpine(
  candidate: Candidate,
  situationSummary: string,
  selection?: MatchSelection,
): WhySpine {
  const normalizedSummary = normalizeSummary(situationSummary);
  const topBrings = pickTopBrings(candidate, selection);
  const triggerSurface = pickTriggerSurface(candidate, selection);

  return {
    trigger: buildTriggerLine(candidate, triggerSurface, normalizedSummary),
    complementarity: buildComplementarityLine(candidate, topBrings),
    trust_bridge: buildTrustBridgeLine(candidate),
    frame:
      `Use this intro to unlock ${normalizedSummary} through concrete complementarity, not a generic contact.`,
  };
}

function pickTopBrings(
  candidate: Candidate,
  selection?: MatchSelection,
): CandidateBring[] {
  if (selection?.topBrings?.length) {
    return selection.topBrings.slice(0, 2);
  }
  return candidate.brings.slice(0, 2);
}

function pickTriggerSurface(
  candidate: Candidate,
  selection?: MatchSelection,
): CandidateTriggerSurface | null {
  if (selection?.triggerSurface) {
    return selection.triggerSurface;
  }
  return candidate.triggerSurfaces[0] ?? null;
}

function normalizeSummary(summary: string): string {
  const trimmed = summary.trim().replace(/[.?!]+$/g, "").replace(/["“”]+/g, "'");
  if (!trimmed) {
    return "the immediate outcome and blocker";
  }
  return compactClause(trimmed, 92);
}

function buildTriggerLine(
  candidate: Candidate,
  triggerSurface: CandidateTriggerSurface | null,
  normalizedSummary: string,
): string {
  if (!triggerSurface) {
    return `This is ${candidate.name}. No specific trigger is grounded enough yet for ${normalizedSummary}.`;
  }

  const why = compactClause(triggerSurface.whyThisPerson, 90);
  const evidence = compactClause(triggerSurface.evidence, 90);

  return `This is ${candidate.name}. The specific click is ${triggerSurface.label}: ${why}. Evidence: ${evidence}.`;
}

function buildComplementarityLine(
  candidate: Candidate,
  topBrings: CandidateBring[],
): string {
  if (topBrings.length === 0) {
    return `I do not have grounded brings cards for ${candidate.name} yet, so complementarity is not proven.`;
  }

  const bringText = topBrings
    .slice(0, 2)
    .map((bring) => {
      const claim = compactClause(bring.claim, 80);
      const evidence = compactClause(bring.evidence, 80);
      return `${claim} (evidence: ${evidence})`;
    })
    .join("; ");

  return `For this gap, ${candidate.name} brings ${bringText}.`;
}

function buildTrustBridgeLine(candidate: Candidate): string {
  const rationale = compactClause(candidate.trustEdge.rationale, 100);
  const touch = candidate.trustEdge.lastTouch?.trim();

  if (!touch) {
    return `Ajay can route this safely via a ${candidate.trustEdge.band} edge: ${rationale}.`;
  }

  return `Ajay can route this safely via a ${candidate.trustEdge.band} edge (last touch ${touch}): ${rationale}.`;
}

function compactClause(clause: string, maxChars = 110): string {
  const normalized = clause.trim().replace(/\s+/g, " ").replace(/[.?!]+$/g, "");
  if (normalized.length <= maxChars) {
    return normalized;
  }
  const sliced = normalized.slice(0, maxChars).trimEnd();
  const lastSpaceIndex = sliced.lastIndexOf(" ");
  if (lastSpaceIndex > Math.floor(maxChars * 0.6)) {
    return sliced.slice(0, lastSpaceIndex).trimEnd();
  }
  return sliced;
}
