export type StyleMemory = {
  concise: boolean;
  direct: boolean;
  avoidProfileRecap: boolean;
};

export const DEFAULT_STYLE_MEMORY: StyleMemory = {
  concise: false,
  direct: false,
  avoidProfileRecap: false,
};

export function mergeStyleMemory(
  current: StyleMemory,
  patch: Partial<StyleMemory>,
): StyleMemory {
  return {
    concise: patch.concise ?? current.concise,
    direct: patch.direct ?? current.direct,
    avoidProfileRecap: patch.avoidProfileRecap ?? current.avoidProfileRecap,
  };
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function inferStyleMemoryPatch(text: string): Partial<StyleMemory> {
  const normalized = normalize(text);
  if (!normalized) {
    return {};
  }

  const patch: Partial<StyleMemory> = {};
  const wantsConcise =
    normalized.includes("keep it short") ||
    normalized.includes("be short") ||
    normalized.includes("be concise") ||
    normalized.includes("brief") ||
    normalized.includes("less words") ||
    normalized.includes("fewer words");
  const wantsDirect =
    normalized.includes("be direct") ||
    normalized.includes("be straight") ||
    normalized.includes("straight to the point") ||
    normalized.includes("to the point") ||
    normalized.includes("no fluff");
  const avoidProfileRecap =
    normalized.includes("dont read linkedin") ||
    normalized.includes("stop reading linkedin") ||
    normalized.includes("stop profile recap") ||
    normalized.includes("no profile recap") ||
    normalized.includes("too robotic") ||
    normalized.includes("sounds robotic");

  if (wantsConcise) {
    patch.concise = true;
  }
  if (wantsDirect) {
    patch.direct = true;
  }
  if (avoidProfileRecap) {
    patch.avoidProfileRecap = true;
  }
  return patch;
}

const ambiguousReplyTokens = new Set([
  "all",
  "any",
  "anyone",
  "anything",
  "fine",
  "good",
  "hmm",
  "numbers",
  "okay",
  "ok",
  "people",
  "same",
  "similar",
  "something",
  "sure",
  "whatever",
  "yes",
  "yeah",
]);

const constraintStopWords = new Set([
  "about",
  "across",
  "after",
  "also",
  "and",
  "another",
  "because",
  "find",
  "for",
  "from",
  "help",
  "just",
  "match",
  "more",
  "need",
  "one",
  "same",
  "second",
  "someone",
  "that",
  "this",
  "with",
]);

function tokenizeConstraint(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 2 && !constraintStopWords.has(token));
}

export function isAmbiguousShortReply(text: string): boolean {
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (tokens.length === 0) {
    return true;
  }
  if (tokens.length > 4) {
    return false;
  }
  return tokens.every((token) => ambiguousReplyTokens.has(token));
}

export function isIncompleteUtterance(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  if (!normalized) {
    return true;
  }

  const incompletePatterns = [
    /\b(for|to|with|about|because|who|that|which|and|or|but|so|i'm|im|looking|need|want|trying)\s*\.{0,3}$/,
    /^so i(?:'m| am)? looking(?:\s+for)?\s*\.{0,3}$/i,
    /^i(?:'m| am)? looking for\s*\.{0,3}$/i,
    /^i(?:'m| am)? trying to\s*\.{0,3}$/i,
    /^i need\s*\.{0,3}$/i,
    /^i want\s*\.{0,3}$/i,
    /\.\.\.$/,
  ];

  return incompletePatterns.some((pattern) => pattern.test(normalized));
}

export function situationSummaryGroundedInUserSpeech(
  userUtterances: string[],
  situationSummary: string,
): boolean {
  const userTokens = new Set(
    userUtterances.flatMap((utterance) => tokenizeConstraint(utterance)),
  );
  if (userTokens.size === 0) {
    return false;
  }

  const summaryTokens = tokenizeConstraint(situationSummary);
  if (summaryTokens.length === 0) {
    return false;
  }

  const overlap = summaryTokens.filter((token) => userTokens.has(token)).length;
  return overlap >= 2;
}

export function isLikelyMatchRejection(text: string): boolean {
  const normalized = normalize(text);
  if (!normalized) {
    return false;
  }
  return (
    normalized.includes("not relevant") ||
    normalized.includes("not useful") ||
    normalized.includes("wrong person") ||
    normalized.includes("does not fit") ||
    normalized.includes("doesnt fit") ||
    normalized.includes("not what i asked") ||
    normalized.includes("not for me")
  );
}

export function styleMemoryPromptLine(memory: StyleMemory): string {
  const flags: string[] = [];
  if (memory.concise) {
    flags.push("keep responses concise");
  }
  if (memory.direct) {
    flags.push("be direct and avoid fluff");
  }
  if (memory.avoidProfileRecap) {
    flags.push("avoid profile-recital openings");
  }
  if (flags.length === 0) {
    return "No explicit style memory captured yet.";
  }
  return `Style memory: ${flags.join("; ")}.`;
}

export type TranscriptTurn = {
  role: "assistant" | "user";
  text: string;
};

export function parseTranscriptTurns(transcript: string): TranscriptTurn[] {
  const turns: TranscriptTurn[] = [];
  const lines = transcript
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    if (line.startsWith("Resona:")) {
      turns.push({
        role: "assistant",
        text: line.slice("Resona:".length).trim(),
      });
      continue;
    }
    if (line.startsWith("You:")) {
      turns.push({
        role: "user",
        text: line.slice("You:".length).trim(),
      });
    }
  }

  return turns;
}

export type TranscriptQualitySummary = {
  turnCount: number;
  assistantTurnCount: number;
  userTurnCount: number;
  openerRoboticRisk: boolean;
  assistantQuestionCount: number;
  noGuessBehaviorPresent: boolean;
};

export function evaluateTranscriptQuality(
  transcript: string,
): TranscriptQualitySummary {
  const turns = parseTranscriptTurns(transcript);
  const assistantTurns = turns.filter((turn) => turn.role === "assistant");
  const userTurns = turns.filter((turn) => turn.role === "user");
  const opener = assistantTurns[0]?.text ?? "";
  const openerCommaCount = (opener.match(/,/g) ?? []).length;
  const openerRoboticRisk = openerCommaCount >= 3 || opener.length > 220;
  const assistantQuestionCount = assistantTurns.filter((turn) =>
    turn.text.includes("?")
  ).length;
  const noGuessBehaviorPresent = assistantTurns.some((turn) => {
    const normalized = normalize(turn.text);
    return (
      normalized.includes("i wont guess") ||
      normalized.includes("i don t have someone i d stake a warm intro on")
    );
  });

  return {
    turnCount: turns.length,
    assistantTurnCount: assistantTurns.length,
    userTurnCount: userTurns.length,
    openerRoboticRisk,
    assistantQuestionCount,
    noGuessBehaviorPresent,
  };
}
