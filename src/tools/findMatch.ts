import { tool } from "@openai/agents/realtime";
import { z } from "zod";

import candidatesSeed from "../../candidates.json";
import type {
  Candidate,
  CandidateBring,
  CandidateBringKind,
  CandidateTriggerSurface,
  MatchConfidence,
  MatchResult,
  MatchSelection,
  TrustBand,
} from "../types/match";
import { composeCandidateWhySpine } from "./whySpine";

const findMatchInputSchema = z.object({
  situation_summary: z
    .string()
    .min(1, "situation_summary is required"),
  need_dimension: z
    .string()
    .optional(),
  replace_last_match: z
    .boolean()
    .optional(),
});

const llmScoreSchema = z.object({
  complementarity: z.number().min(0).max(1),
  trigger: z.number().min(0).max(1),
  selectedBringIndices: z.array(z.number().int().min(0)).max(2),
  selectedTriggerIndex: z.number().int().min(0).nullable(),
  reason: z.string().min(1).max(280),
});

type LlmScore = z.infer<typeof llmScoreSchema>;

type CandidateScorerInput = {
  situationSummary: string;
  candidate: Candidate;
  signal?: AbortSignal;
};

export type CandidateScorer = (
  input: CandidateScorerInput,
) => Promise<LlmScore>;

const bringKinds: CandidateBringKind[] = [
  "capability",
  "resource",
  "judgment",
  "network",
  "lived_experience",
];
const validBringKindSet = new Set<CandidateBringKind>(bringKinds);

const trustBandScores: Record<TrustBand, number> = {
  acquaintance: 0.35,
  warm: 0.65,
  strong: 0.9,
};

const MATCH_CONFIDENCE_MIN = 0.62;
const COMPLEMENTARITY_MIN = 0.55;
const TRIGGER_MIN = 0.6;
const TRUST_MIN = 0.4;
const MAX_SCORING_POOL = 6;
const SCORER_TIMEOUT_MS = 5_600;
const SCORER_SLOW_WARN_MS = 3_500;

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeNeedDimension(value: string | undefined): string | undefined {
  return asNonEmptyString(value) ?? undefined;
}

function parseBrings(value: unknown): CandidateBring[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const parsed: CandidateBring[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const asRecord = item as Record<string, unknown>;
    const kind = asRecord.kind;
    const claim = asNonEmptyString(asRecord.claim);
    const evidence = asNonEmptyString(asRecord.evidence);
    if (!claim || !evidence || !validBringKindSet.has(kind as CandidateBringKind)) {
      // Evidence is mandatory; drop the card when missing.
      continue;
    }
    parsed.push({
      kind: kind as CandidateBringKind,
      claim,
      evidence,
    });
  }
  return parsed;
}

function parseTriggerSurfaces(value: unknown): CandidateTriggerSurface[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const parsed: CandidateTriggerSurface[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const asRecord = item as Record<string, unknown>;
    const label = asNonEmptyString(asRecord.label);
    const situationPattern = asNonEmptyString(asRecord.situationPattern);
    const whyThisPerson = asNonEmptyString(asRecord.whyThisPerson);
    const evidence = asNonEmptyString(asRecord.evidence);
    if (!label || !situationPattern || !whyThisPerson || !evidence) {
      // Evidence is mandatory; drop the trigger surface when missing.
      continue;
    }
    parsed.push({
      label,
      situationPattern,
      whyThisPerson,
      evidence,
    });
  }
  return parsed;
}

function parseTrustBand(value: unknown): TrustBand {
  if (value === "strong" || value === "warm" || value === "acquaintance") {
    return value;
  }
  return "acquaintance";
}

function parseTrustEdge(
  value: unknown,
): Candidate["trustEdge"] {
  if (!value || typeof value !== "object") {
    return {
      band: "acquaintance",
      rationale: "Relationship detail is missing in the current graph snapshot.",
    };
  }

  const asRecord = value as Record<string, unknown>;
  const rationale = asNonEmptyString(asRecord.rationale)
    ?? "Relationship detail is missing in the current graph snapshot.";
  const lastTouch = asNonEmptyString(asRecord.lastTouch) ?? undefined;

  return {
    band: parseTrustBand(asRecord.band),
    rationale,
    ...(lastTouch ? { lastTouch } : {}),
  };
}

function parseQualityTier(value: unknown): Candidate["qualityTier"] | null {
  if (value === "golden" || value === "enriched" || value === "tag-only") {
    return value;
  }
  return null;
}

function parseCandidate(value: unknown): Candidate | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const asRecord = value as Record<string, unknown>;
  const id = asNonEmptyString(asRecord.id);
  const name = asNonEmptyString(asRecord.name);
  const qualityTier = parseQualityTier(asRecord.qualityTier);

  if (!id || !name || !qualityTier) {
    return null;
  }

  return {
    id,
    name,
    qualityTier,
    brings: parseBrings(asRecord.brings),
    triggerSurfaces: parseTriggerSurfaces(asRecord.triggerSurfaces),
    trustEdge: parseTrustEdge(asRecord.trustEdge),
  };
}

const rawSeedRows = Array.isArray(candidatesSeed) ? candidatesSeed : [];
const candidates = rawSeedRows
  .map((row) => parseCandidate(row))
  .filter((candidate): candidate is Candidate => !!candidate);

const rejectedSeedRows = Math.max(0, rawSeedRows.length - candidates.length);
const EXCLUDED_CANDIDATE_IDS = new Set(["umang-chhaparia"]);

const tier2EligibleCandidates = candidates.filter(
  (candidate) => candidate.qualityTier !== "tag-only",
);

const stopWords = new Set([
  "about",
  "across",
  "after",
  "again",
  "almost",
  "also",
  "and",
  "because",
  "between",
  "close",
  "could",
  "faster",
  "from",
  "have",
  "help",
  "just",
  "more",
  "need",
  "raise",
  "someone",
  "that",
  "their",
  "them",
  "they",
  "this",
  "with",
  "would",
]);

type CandidateScore = {
  candidate: Candidate;
  overall: number;
  confidence: MatchConfidence;
  selection: MatchSelection | null;
};

type RankedCandidatesDiagnostics = {
  attempted: number;
  scored: number;
  droppedTimeout: number;
  droppedError: number;
};

type RankedCandidatesResult = {
  ranked: CandidateScore[];
  diagnostics: RankedCandidatesDiagnostics;
};

class ScorerTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScorerTimeoutError";
  }
}

class CandidateScoringError extends Error {
  candidateId: string;
  elapsedMs: number;
  kind: "timeout" | "error";

  constructor(
    candidateId: string,
    elapsedMs: number,
    kind: "timeout" | "error",
    detail: string,
  ) {
    super(detail);
    this.name = "CandidateScoringError";
    this.candidateId = candidateId;
    this.elapsedMs = elapsedMs;
    this.kind = kind;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 2 && !stopWords.has(token));
}

function summarizeIssue(situationSummary: string): string | null {
  const normalized = situationSummary.trim();
  if (normalized.length < 16) {
    return "Need a little more context. Share the outcome you need and what is blocking it.";
  }

  const tokens = tokenize(normalized);
  if (tokens.length < 2) {
    return "Could you add one concrete blocker so I can avoid a generic match?";
  }

  return null;
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  onTimeout?: () => void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      onTimeout?.();
      reject(new ScorerTimeoutError(`Timed out after ${timeoutMs}ms.`));
    }, timeoutMs);

    promise.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

function logScorerLatency(
  candidateId: string,
  elapsedMs: number,
  status: "ok" | "timeout" | "error",
  detail?: string,
) {
  if (status === "ok" && elapsedMs < SCORER_SLOW_WARN_MS) {
    return;
  }

  const base = `[find_match] scorer ${status} candidate=${candidateId} elapsed_ms=${elapsedMs}`;
  if (status === "ok") {
    console.info(base);
    return;
  }

  console.warn(detail ? `${base} detail=${detail}` : base);
}

function resolveApiBaseUrl(): string {
  const configured = (import.meta as { env?: Record<string, unknown> }).env
    ?.VITE_API_BASE_URL;
  if (typeof configured === "string" && configured.trim().length > 0) {
    return configured;
  }
  return "http://localhost:8787";
}

function resolveApiAuthKey(): string | undefined {
  const configured = (import.meta as { env?: Record<string, unknown> }).env
    ?.VITE_RESONA_API_KEY;
  if (typeof configured === "string" && configured.trim().length > 0) {
    return configured.trim();
  }
  return undefined;
}

const defaultCandidateScorer: CandidateScorer = async ({
  situationSummary,
  candidate,
  signal,
}) => {
  const apiAuthKey = resolveApiAuthKey();
  const response = await fetch(`${resolveApiBaseUrl()}/api/match/score`, {
    signal,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(apiAuthKey
        ? {
            "x-resona-api-key": apiAuthKey,
          }
        : {}),
    },
    body: JSON.stringify({
      situation_summary: situationSummary,
      candidate,
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(
      `LLM scoring request failed (${response.status}): ${detail.slice(0, 220)}`,
    );
  }

  const payload = await response.json() as {
    ok?: boolean;
    score?: unknown;
    error?: string;
  };

  if (!payload.ok || !payload.score) {
    throw new Error(payload.error ?? "Missing score payload from scorer endpoint.");
  }

  return llmScoreSchema.parse(payload.score);
};

function trustBandScore(band: TrustBand): number {
  return trustBandScores[band] ?? trustBandScores.acquaintance;
}

function resolveSelectedBrings(
  candidate: Candidate,
  selectedBringIndices: number[],
): CandidateBring[] {
  return selectedBringIndices
    .map((index) => candidate.brings[index])
    .filter((bring): bring is CandidateBring => !!bring)
    .slice(0, 2);
}

function resolveSelectedTriggerSurface(
  candidate: Candidate,
  selectedTriggerIndex: number | null,
): CandidateTriggerSurface | null {
  if (selectedTriggerIndex === null) {
    return null;
  }
  if (selectedTriggerIndex < 0 || selectedTriggerIndex >= candidate.triggerSurfaces.length) {
    return null;
  }
  return candidate.triggerSurfaces[selectedTriggerIndex] ?? null;
}

function confidenceReason(score: CandidateScore, llmReason: string): string {
  if (clearsConfidenceBar(score)) {
    return llmReason;
  }

  const reasons: string[] = [];
  if (score.confidence.trust < TRUST_MIN) {
    reasons.push("trust edge below warm-intro floor");
  }
  if (score.confidence.trigger < TRIGGER_MIN) {
    reasons.push("trigger lacks situation-specific grounding");
  }
  if (score.confidence.complementarity < COMPLEMENTARITY_MIN) {
    reasons.push("complementarity is not grounded enough");
  }
  if (score.overall < MATCH_CONFIDENCE_MIN) {
    reasons.push("overall confidence is below acceptance bar");
  }
  if (reasons.length === 0) {
    return llmReason || "Signal is not strong enough for a safe warm intro.";
  }
  return reasons.join("; ");
}

async function scoreCandidate(
  situationSummary: string,
  candidate: Candidate,
  scorer: CandidateScorer,
): Promise<CandidateScore> {
  const controller = new AbortController();
  const llmScore = await withTimeout(
    scorer({
      situationSummary,
      candidate,
      signal: controller.signal,
    }),
    SCORER_TIMEOUT_MS,
    () => controller.abort(),
  );

  const trust = trustBandScore(candidate.trustEdge.band);
  const topBrings = resolveSelectedBrings(candidate, llmScore.selectedBringIndices);
  const triggerSurface = resolveSelectedTriggerSurface(
    candidate,
    llmScore.selectedTriggerIndex,
  );

  const complementarity = topBrings.length > 0
    ? clamp(llmScore.complementarity, 0, 1)
    : 0;
  const trigger = triggerSurface ? clamp(llmScore.trigger, 0, 1) : 0;

  const fitCore = complementarity * 0.65 + trigger * 0.35;
  const overall = clamp(fitCore * (0.7 + 0.3 * trust), 0, 1);

  const selection = triggerSurface
    ? {
      topBrings,
      triggerSurface,
    }
    : null;

  const scored: CandidateScore = {
    candidate,
    overall,
    selection,
    confidence: {
      overall,
      complementarity,
      trigger,
      trust,
      reason: llmScore.reason,
    },
  };

  return {
    ...scored,
    confidence: {
      ...scored.confidence,
      reason: confidenceReason(scored, llmScore.reason),
    },
  };
}

function qualityTierRank(tier: Candidate["qualityTier"]): number {
  if (tier === "golden") {
    return 2;
  }
  if (tier === "enriched") {
    return 1;
  }
  return 0;
}

function overlapCount(tokens: string[], queryTokens: Set<string>): number {
  if (queryTokens.size === 0 || tokens.length === 0) {
    return 0;
  }
  const uniqueTokens = new Set(tokens);
  let matches = 0;
  for (const token of uniqueTokens) {
    if (queryTokens.has(token)) {
      matches += 1;
    }
  }
  return matches;
}

function candidateSemanticRelevance(
  candidate: Candidate,
  summaryTokens: Set<string>,
  needTokens: Set<string>,
): number {
  const weightedFields: Array<{ text: string; weight: number }> = [
    ...candidate.brings.flatMap((bring) => ([
      { text: bring.claim, weight: 1.8 },
      { text: bring.evidence, weight: 0.9 },
    ])),
    ...candidate.triggerSurfaces.flatMap((triggerSurface) => ([
      { text: triggerSurface.label, weight: 2.0 },
      { text: triggerSurface.situationPattern, weight: 1.8 },
      { text: triggerSurface.whyThisPerson, weight: 1.2 },
      { text: triggerSurface.evidence, weight: 0.8 },
    ])),
  ];

  return weightedFields.reduce((score, field) => {
    const tokens = tokenize(field.text);
    const summaryOverlap = overlapCount(tokens, summaryTokens) * field.weight;
    const needOverlap = overlapCount(tokens, needTokens) * field.weight * 1.2;
    return score + summaryOverlap + needOverlap;
  }, 0);
}

function prefilterCandidatePool(
  candidatesPool: Candidate[],
  excludedIds: Set<string>,
  situationSummary: string,
  needDimension?: string,
): Candidate[] {
  const summaryTokens = new Set(tokenize(situationSummary));
  const needTokens = new Set(tokenize(needDimension ?? ""));
  const softPool = candidatesPool
    .filter((candidate) => !excludedIds.has(candidate.id))
    .map((candidate) => {
      return {
        candidate,
        relevance: candidateSemanticRelevance(candidate, summaryTokens, needTokens),
        trust: trustBandScore(candidate.trustEdge.band),
      };
    })
    .sort((left, right) =>
      right.relevance - left.relevance
      || right.trust - left.trust
      || qualityTierRank(right.candidate.qualityTier) - qualityTierRank(left.candidate.qualityTier)
      || left.candidate.name.localeCompare(right.candidate.name))
    .slice(0, MAX_SCORING_POOL)
    .map((row) => row.candidate);

  return softPool;
}

function buildNoMatchResult(
  situationSummary: string,
  reason: string,
): MatchResult {
  return {
    candidate: null,
    source: "no-match",
    cap_status: "open",
    no_match_reason: reason,
    situation_summary: situationSummary,
    why_spine: {
      trigger:
        "No single candidate clicked yet for this exact situation with high enough confidence.",
      complementarity:
        "Grounded complementarity requires concrete brings cards and evidence, not just tag overlap.",
      trust_bridge:
        "Ajay should only route intros when trust edge and trigger both clear the confidence bar.",
      frame: "Ask one more clarifying question before recommending a person.",
    },
  };
}

function buildCapResult(
  situationSummary: string,
): MatchResult {
  return {
    candidate: null,
    source: "cap",
    cap_status: "reached",
    hard_cap_reached: true,
    no_match_reason:
      "Two matches already surfaced. Pivot to selecting a priority intro and draft the message.",
    situation_summary: situationSummary,
    why_spine: {
      trigger: "Two-match cap reached.",
      complementarity:
        "The flow intentionally stops at two recommendations so the founder can choose the strongest complementarity now.",
      trust_bridge: "Use one warm bridge now instead of generating extra low-signal options.",
      frame: "Choose priority match and move to intro draft.",
    },
  };
}

function buildMatchResult(
  candidate: Candidate,
  situationSummary: string,
  confidence: MatchConfidence,
  selection: MatchSelection,
): MatchResult {
  return {
    candidate,
    why_spine: composeCandidateWhySpine(
      candidate,
      situationSummary,
      selection,
    ),
    situation_summary: situationSummary,
    source: "off-script",
    confidence,
    selection,
    cap_status: "open",
  };
}

function candidatePool(source?: Candidate[]): Candidate[] {
  if (!source) {
    return tier2EligibleCandidates;
  }
  const normalized = source
    .map((candidate) => parseCandidate(candidate))
    .filter((candidate): candidate is Candidate => !!candidate);
  return normalized.filter((candidate) => candidate.qualityTier !== "tag-only");
}

async function getRankedCandidates(
  situationSummary: string,
  needDimension: string | undefined,
  scorer: CandidateScorer,
  pool: Candidate[],
  excludedIds: Set<string>,
): Promise<RankedCandidatesResult> {
  const scoringPool = prefilterCandidatePool(
    pool,
    excludedIds,
    situationSummary,
    needDimension,
  );
  const attempts = scoringPool.map(async (candidate) => {
    const startedAt = Date.now();
    try {
      const score = await scoreCandidate(situationSummary, candidate, scorer);
      const elapsedMs = Date.now() - startedAt;
      logScorerLatency(candidate.id, elapsedMs, "ok");
      return {
        score,
      };
    } catch (error) {
      const elapsedMs = Date.now() - startedAt;
      const detail = error instanceof Error
        ? error.message
        : "Unknown scorer error.";
      const kind = error instanceof ScorerTimeoutError
        || (error instanceof Error && /timeout|timed out|aborted/i.test(error.message))
        ? "timeout"
        : "error";
      throw new CandidateScoringError(
        candidate.id,
        elapsedMs,
        kind,
        detail,
      );
    }
  });

  const settled = await Promise.allSettled(attempts);
  const diagnostics: RankedCandidatesDiagnostics = {
    attempted: scoringPool.length,
    scored: 0,
    droppedTimeout: 0,
    droppedError: 0,
  };
  const ranked: CandidateScore[] = [];

  for (const attempt of settled) {
    if (attempt.status === "fulfilled") {
      diagnostics.scored += 1;
      ranked.push(attempt.value.score);
      continue;
    }

    const reason = attempt.reason;
    if (reason instanceof CandidateScoringError) {
      if (reason.kind === "timeout") {
        diagnostics.droppedTimeout += 1;
        logScorerLatency(
          reason.candidateId,
          reason.elapsedMs,
          "timeout",
          reason.message,
        );
      } else {
        diagnostics.droppedError += 1;
        logScorerLatency(
          reason.candidateId,
          reason.elapsedMs,
          "error",
          reason.message,
        );
      }
      continue;
    }

    diagnostics.droppedError += 1;
    const detail = reason instanceof Error ? reason.message : "Unknown scorer failure.";
    console.warn(
      `[find_match] scorer error candidate=unknown elapsed_ms=unknown detail=${detail}`,
    );
  }

  ranked.sort((left, right) =>
    right.overall - left.overall
    || right.confidence.trigger - left.confidence.trigger
    || right.confidence.complementarity - left.confidence.complementarity
    || right.confidence.trust - left.confidence.trust
    || left.candidate.name.localeCompare(right.candidate.name));

  return {
    ranked,
    diagnostics,
  };
}

function clearsConfidenceBar(score: CandidateScore): boolean {
  return (
    score.overall >= MATCH_CONFIDENCE_MIN &&
    score.confidence.complementarity >= COMPLEMENTARITY_MIN &&
    score.confidence.trigger >= TRIGGER_MIN &&
    score.confidence.trust >= TRUST_MIN &&
    !!score.selection &&
    score.selection.topBrings.length > 0
  );
}

function buildNoGuessReason(
  ranked: CandidateScore[],
  diagnostics: RankedCandidatesDiagnostics,
  eligiblePoolSize: number,
): string {
  if (eligiblePoolSize === 0) {
    return "The current candidate graph does not yet include v2 brings/trigger/trust records in the eligible pool, so I cannot make a grounded match.";
  }

  if (diagnostics.attempted > 0 && diagnostics.scored === 0) {
    if (diagnostics.droppedTimeout > 0 && diagnostics.droppedError === 0) {
      return "The scorer timed out across the current pool, so I cannot produce a grounded complementarity+trigger decision right now.";
    }
    return "The match scorer is temporarily unavailable, so I cannot produce a grounded complementarity+trigger decision right now.";
  }

  if (ranked.length > 0 && ranked.every((score) => score.confidence.trust < TRUST_MIN)) {
    return "I do not have a warm/strong trust edge for this ask right now. Most available edges are acquaintance-level, and I will not burn trust with a weak bridge.";
  }

  if (ranked.length > 0 && ranked.every((score) => score.confidence.trigger < TRIGGER_MIN)) {
    return "I do not have a candidate with a specific, situation-grounded trigger over peers here. Tag-level similarity alone is not enough.";
  }

  if (ranked.length > 0 && ranked.every((score) => score.confidence.complementarity < COMPLEMENTARITY_MIN)) {
    return "I do not have grounded complementarity cards that clearly map to this live blocker yet.";
  }

  return "I don't have someone I'd stake a warm intro on for that — and I won't guess, because a bad intro burns the relationship more than no intro. That's a principle, not a failure. Share one more precise constraint or a different angle, and I'll rematch.";
}

export type MatchMode = "dummy" | "real";

type CreateFindMatchToolOptions = {
  mode?: MatchMode;
  onMatch?: (result: MatchResult) => void;
  candidateScorer?: CandidateScorer;
  candidateSource?: Candidate[];
  allowMatchCall?: (input: {
    situation_summary: string;
    need_dimension?: string;
    replace_last_match?: boolean;
  }) => {
    allowed: boolean;
    stage?: string;
    reason?: string;
    next_input?: {
      situation_summary: string;
      need_dimension?: string;
      replace_last_match?: boolean;
    };
  };
};

export async function findMatchCore(
  input: { situation_summary: string; need_dimension?: string },
  _mode: MatchMode = "real",
  options: {
    excludedCandidateIds?: Set<string>;
    candidateScorer?: CandidateScorer;
    candidateSource?: Candidate[];
  } = {},
): Promise<MatchResult> {
  const parsed = findMatchInputSchema.parse(input);
  const normalizedNeedDimension = normalizeNeedDimension(parsed.need_dimension);
  const summaryIssue = summarizeIssue(parsed.situation_summary);
  if (summaryIssue) {
    return buildNoMatchResult(
      parsed.situation_summary,
      summaryIssue,
    );
  }
  const excludedCandidateIds = new Set([
    ...EXCLUDED_CANDIDATE_IDS,
    ...(options.excludedCandidateIds ?? []),
  ]);
  const scorer = options.candidateScorer ?? defaultCandidateScorer;
  const pool = candidatePool(options.candidateSource);
  const rankedResult = await getRankedCandidates(
    parsed.situation_summary,
    normalizedNeedDimension,
    scorer,
    pool,
    excludedCandidateIds,
  );
  const ranked = rankedResult.ranked;

  const best = ranked.find((candidate) => clearsConfidenceBar(candidate)) ?? null;
  if (!best || !best.selection) {
    return buildNoMatchResult(
      parsed.situation_summary,
      buildNoGuessReason(
        ranked,
        rankedResult.diagnostics,
        pool.length,
      ),
    );
  }

  return buildMatchResult(
    best.candidate,
    parsed.situation_summary,
    best.confidence,
    best.selection,
  );
}

export function createFindMatchTool(
  options: CreateFindMatchToolOptions = {},
) {
  const mode = options.mode ?? "real";
  let matchCount = 0;
  const selectedCandidateIds = new Set<string>();
  const selectedCandidateOrder: string[] = [];

  return tool({
    name: "find_match",
    description:
      "Find one high-trust candidate from Ajay's network for the founder's live need.",
    parameters: findMatchInputSchema,
    async execute(input) {
      const parsed = findMatchInputSchema.parse(input);
      const normalizedNeedDimension = normalizeNeedDimension(parsed.need_dimension);
      const normalizedInput = {
        situation_summary: parsed.situation_summary,
        ...(normalizedNeedDimension
          ? { need_dimension: normalizedNeedDimension }
          : {}),
        ...(parsed.replace_last_match ? { replace_last_match: true } : {}),
      };

      const gate = options.allowMatchCall?.(normalizedInput);
      if (gate && !gate.allowed) {
        const blocked = buildNoMatchResult(
          parsed.situation_summary,
          gate.reason ??
            "Need one more clarifying question before matching.",
        );
        options.onMatch?.(blocked);
        return blocked;
      }

      const effectiveInput = gate?.next_input
        ? findMatchInputSchema.parse(gate.next_input)
        : normalizedInput;
      const replacementTargetId =
        effectiveInput.replace_last_match && selectedCandidateOrder.length > 0
          ? selectedCandidateOrder[selectedCandidateOrder.length - 1] ?? null
          : null;

      if (matchCount >= 2 && !replacementTargetId) {
        const cappedResult = buildCapResult(
          effectiveInput.situation_summary,
        );
        options.onMatch?.(cappedResult);
        return cappedResult;
      }

      const result = await findMatchCore(
        {
          situation_summary: effectiveInput.situation_summary,
          ...(effectiveInput.need_dimension
            ? { need_dimension: effectiveInput.need_dimension }
            : {}),
        },
        mode,
        {
        excludedCandidateIds: selectedCandidateIds,
        candidateScorer: options.candidateScorer,
        candidateSource: options.candidateSource,
      });

      if (result.candidate) {
        if (replacementTargetId && selectedCandidateIds.has(replacementTargetId)) {
          selectedCandidateIds.delete(replacementTargetId);
          const replacementIndex = selectedCandidateOrder.lastIndexOf(
            replacementTargetId,
          );
          if (replacementIndex >= 0) {
            selectedCandidateOrder.splice(replacementIndex, 1);
          }
          matchCount = Math.max(0, matchCount - 1);
        }
        if (!selectedCandidateIds.has(result.candidate.id)) {
          matchCount += 1;
          selectedCandidateIds.add(result.candidate.id);
          selectedCandidateOrder.push(result.candidate.id);
        }
      }

      const resultWithMetadata = replacementTargetId
        ? {
            ...result,
            replacement_of_candidate_id: replacementTargetId,
          }
        : result;

      options.onMatch?.(resultWithMetadata);
      return resultWithMetadata;
    },
  });
}

export async function rehearseMatchSequence(
  inputs: Array<{ situation_summary: string; need_dimension?: string }>,
  mode: MatchMode = "real",
) {
  let matchCount = 0;
  const selectedCandidateIds = new Set<string>();

  const results: MatchResult[] = [];
  for (const input of inputs) {
    const parsed = findMatchInputSchema.parse(input);
    const normalizedNeedDimension = normalizeNeedDimension(parsed.need_dimension);
    const normalizedInput = {
      situation_summary: parsed.situation_summary,
      ...(normalizedNeedDimension
        ? { need_dimension: normalizedNeedDimension }
        : {}),
    };
    if (matchCount >= 2) {
      results.push(buildCapResult(parsed.situation_summary));
      continue;
    }

    const result = await findMatchCore(normalizedInput, mode, {
      excludedCandidateIds: selectedCandidateIds,
    });
    if (result.candidate) {
      matchCount += 1;
      selectedCandidateIds.add(result.candidate.id);
    }
    results.push(result);
  }

  return results;
}

export function getTier2Counts() {
  const total = candidates.length;
  const enriched = candidates.filter(
    (row) => row.qualityTier === "enriched",
  ).length;
  const tier2Eligible = candidates.filter(
    (row) => row.qualityTier !== "tag-only",
  ).length;
  const tagOnly = candidates.filter(
    (row) => row.qualityTier === "tag-only",
  ).length;

  return {
    total,
    enriched,
    tagOnly,
    tier2Eligible,
    rawSeedRows: rawSeedRows.length,
    rejectedForSchema: rejectedSeedRows,
  };
}
