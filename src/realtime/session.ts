import {
  OpenAIRealtimeWebRTC,
  RealtimeAgent,
  RealtimeSession,
} from "@openai/agents/realtime";

import { createFindMatchTool, type MatchMode } from "../tools/findMatch";
import type { MatchResult } from "../types/match";
import { buildResonaSystemPrompt } from "./resonaPrompt";

type RealtimeTokenResponse = {
  value: string;
  expires_at?: number;
  session?: {
    id?: string;
    model?: string;
  };
};

export type StartResonaSessionOptions = {
  apiBaseUrl: string;
  audioElement: HTMLAudioElement;
  matchMode: MatchMode;
  profileContext: SessionProfileContext;
  onTranscriptDelta?: (delta: string) => void;
  onToolActivity?: (message: string) => void;
  onConversationItem?: (item: {
    itemId: string;
    role: "user" | "assistant";
    text: string;
    status?: string;
  }) => void;
  onMatch?: (result: MatchResult) => void;
  onError?: (message: string) => void;
};

export type SessionProfileContext = {
  name: string;
  company: string;
  summary: string;
  raise_context: string;
  source: "cache" | "apify";
  fetched_at: string;
};

export type StartedResonaSession = {
  session: RealtimeSession;
  close: () => Promise<void>;
};

type ConversationStage =
  | "probe1"
  | "probe2"
  | "matchA"
  | "constraint"
  | "matchB"
  | "intro";

type StageGateResult = {
  allowed: boolean;
  stage: ConversationStage;
  reason?: string;
  carryoverContext?: {
    situationSummary: string;
    needDimension?: string;
    confirmationMessage: string;
  };
};

type ContextQuality = "high" | "partial";

function countWords(text: string): number {
  return text
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function normalizeAssistantDedupText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\u0600-\u06ff\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function assessProfileContext(profile: SessionProfileContext): {
  quality: ContextQuality;
  notes: string[];
} {
  const notes: string[] = [];
  const weakName =
    !profile.name.trim() || profile.name.toLowerCase() === "unknown";
  const weakCompany =
    !profile.company.trim() || profile.company.toLowerCase() === "no headline";
  const weakSummary = profile.summary.trim().length < 40;

  if (weakName) {
    notes.push("founder name is uncertain");
  }
  if (weakCompany) {
    notes.push("company context is weak");
  }
  if (weakSummary) {
    notes.push("summary detail is limited");
  }

  return {
    quality: notes.length === 0 ? "high" : "partial",
    notes,
  };
}

function buildWarmKickoffInstruction(
  profile: SessionProfileContext,
  contextQuality: ContextQuality,
): string {
  const calibrationLine =
    contextQuality === "partial"
      ? "Start with a calibration nudge before assumptions: ask what outcome they need most from this intro in the next two weeks."
      : "Open with confident context and ask one focused outcome nudge.";

  return [
    "Internal kickoff instruction:",
    `Start the conversation now. Greet ${profile.name} warmly as a trusted connector.`,
    `Use context from ${profile.source} profile data and keep tone practical, supportive, and specific.`,
    "First-impression guardrail: in your first response, use at most 2 short sentences.",
    `Sentence 1 should anchor who they are using name/company context ("${profile.name}" at "${profile.company}") and one short context clue only.`,
    "Sentence 2 should ask exactly one focused nudge question.",
    "Do not recite LinkedIn details or list multiple past companies/credentials in the opener.",
    calibrationLine,
    "Do not call any tools in this first response.",
  ].join(" ");
}

function extractUserUtterance(item: any): string {
  const content = Array.isArray(item?.content) ? item.content : [];
  return content
    .map((part: any) => {
      if (part?.type === "input_audio" && typeof part.transcript === "string") {
        return part.transcript;
      }
      if (part?.type === "input_text" && typeof part.text === "string") {
        return part.text;
      }
      return "";
    })
    .join(" ")
    .trim();
}

function isWarmKickoffText(text: string): boolean {
  return text.startsWith("Internal kickoff instruction:");
}

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

function hasConstraintShift(
  firstSummary: string,
  nextSummary: string,
  needDimension?: string,
): boolean {
  if (!firstSummary.trim()) {
    return true;
  }
  const normalizedFirst = firstSummary.trim().toLowerCase();
  const normalizedNext = nextSummary.trim().toLowerCase();
  if (normalizedNext.length === 0) {
    return false;
  }

  const firstTokens = new Set(tokenizeConstraint(firstSummary));
  const nextTokens = new Set(
    tokenizeConstraint(
      `${nextSummary} ${needDimension?.trim() ?? ""}`,
    ),
  );

  for (const token of nextTokens) {
    if (!firstTokens.has(token)) {
      return true;
    }
  }

  return normalizedNext !== normalizedFirst && nextTokens.size > 0;
}

function normalizeConstraintClause(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function buildCarryoverContext(
  firstSummary: string,
  firstNeedDimension: string,
  nextSummary: string,
  nextNeedDimension?: string,
): StageGateResult["carryoverContext"] {
  const baseSummary = normalizeConstraintClause(firstSummary);
  const baseNeed = normalizeConstraintClause(firstNeedDimension);
  const addedSummary = normalizeConstraintClause(nextSummary);
  const addedNeed = normalizeConstraintClause(nextNeedDimension ?? "");

  const mergedSummary = [
    addedSummary,
    baseSummary
      ? `Keep prior requirement in context: ${baseSummary}`
      : "",
  ]
    .filter(Boolean)
    .join(". ");

  const mergedNeed = [baseNeed, addedNeed]
    .filter(Boolean)
    .join(" + ");

  const confirmationMessage = [
    "Keeping your earlier constraint in play",
    addedNeed
      ? `and adding this one: ${addedNeed}.`
      : `and adding this one: ${addedSummary}.`,
  ].join(" ");

  return {
    situationSummary: mergedSummary,
    needDimension: mergedNeed || undefined,
    confirmationMessage,
  };
}

type ConversationItem = {
  itemId: string;
  role: "user" | "assistant";
  text: string;
  status?: string;
};

function extractAssistantUtterance(item: any): string {
  const content = Array.isArray(item?.content) ? item.content : [];
  const audioTranscript = content
    .map((part: any) => {
      if (
        part?.type === "output_audio" &&
        typeof part.transcript === "string"
      ) {
        return part.transcript;
      }
      return "";
    })
    .join(" ")
    .trim();
  if (audioTranscript) {
    return audioTranscript;
  }

  return content
    .map((part: any) => {
      if (part?.type === "output_text" && typeof part.text === "string") {
        return part.text;
      }
      return "";
    })
    .join(" ")
    .trim();
}

function createStageController() {
  let transcriptWordCount = 0;
  let userTurnCount = 0;
  let firstMatchWordCount = 0;
  let firstMatchTurnCount = 0;
  let firstMatchSituationSummary = "";
  let firstMatchNeedDimension = "";
  let pendingMatchNeedDimension = "";
  let successfulMatchCount = 0;
  let stage: ConversationStage = "probe1";

  function updateStage() {
    if (successfulMatchCount >= 2) {
      stage = "intro";
      return;
    }

    if (successfulMatchCount === 1) {
      const wordsSinceFirstMatch = transcriptWordCount - firstMatchWordCount;
      const turnsSinceFirstMatch = userTurnCount - firstMatchTurnCount;
      stage = turnsSinceFirstMatch < 1 && wordsSinceFirstMatch < 8
        ? "constraint"
        : "matchB";
      return;
    }

    if (userTurnCount >= 2 || transcriptWordCount >= 30) {
      stage = "matchA";
      return;
    }

    if (userTurnCount >= 1 || transcriptWordCount >= 8) {
      stage = "probe2";
      return;
    }

    stage = "probe1";
  }

  return {
    observeUserWordDelta(wordDelta: number, isNewTurn: boolean) {
      transcriptWordCount += Math.max(0, wordDelta);
      if (isNewTurn) {
        userTurnCount += 1;
      }
      updateStage();
      return stage;
    },
    noteMatchAttempt(_situationSummary: string, needDimension?: string) {
      pendingMatchNeedDimension = needDimension?.trim() ?? "";
    },
    onMatch(result: MatchResult) {
      if (!result.candidate || result.source === "cap" || result.source === "no-match") {
        updateStage();
        return;
      }

      successfulMatchCount += 1;
      if (successfulMatchCount === 1) {
        firstMatchWordCount = transcriptWordCount;
        firstMatchTurnCount = userTurnCount;
        firstMatchSituationSummary = result.situation_summary;
        firstMatchNeedDimension = pendingMatchNeedDimension;
      }
      updateStage();
    },
    canCallMatch(
      situationSummary: string,
      needDimension?: string,
    ): StageGateResult {
      updateStage();
      if (successfulMatchCount >= 2) {
        return {
          allowed: false,
          stage,
          reason:
            "Two matches are already complete. Pivot to intro drafting for the stronger fit.",
        };
      }

      if (stage === "probe1" || stage === "probe2" || stage === "constraint") {
        return {
          allowed: false,
          stage,
          reason:
            "Ask one more clarifying question before matching so recommendation quality stays high.",
        };
      }

      if (
        successfulMatchCount === 1 &&
        !hasConstraintShift(
          `${firstMatchSituationSummary} ${firstMatchNeedDimension}`,
          situationSummary,
          needDimension,
        )
      ) {
        return {
          allowed: false,
          stage,
          reason:
            "Add one new constraint or angle before requesting another match so the second result is genuinely different.",
        };
      }

      return {
        allowed: true,
        stage,
        ...(successfulMatchCount === 1
          ? {
              carryoverContext: buildCarryoverContext(
                firstMatchSituationSummary,
                firstMatchNeedDimension,
                situationSummary,
                needDimension,
              ),
            }
          : {}),
      };
    },
  };
}

async function mintRealtimeToken(
  apiBaseUrl: string,
): Promise<RealtimeTokenResponse> {
  const response = await fetch(`${apiBaseUrl}/api/realtime/session`, {
    method: "POST",
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(
      `Failed to mint realtime token (${response.status}): ${errorBody}`,
    );
  }

  const data = (await response.json()) as RealtimeTokenResponse;
  if (!data.value) {
    throw new Error("Realtime token response missing `value`.");
  }

  return data;
}

export async function startResonaSession(
  options: StartResonaSessionOptions,
): Promise<StartedResonaSession> {
  if (!options.profileContext?.name || !options.profileContext?.summary) {
    throw new Error("Profile context is required before starting a Resona session.");
  }

  const stageController = createStageController();
  const profileAssessment = assessProfileContext(options.profileContext);
  const token = await mintRealtimeToken(options.apiBaseUrl);

  const findMatchTool = createFindMatchTool({
    mode: options.matchMode,
    allowMatchCall: (input) => {
      const gate = stageController.canCallMatch(
        input.situation_summary,
        input.need_dimension,
      );
      if (!gate.allowed) {
        options.onToolActivity?.(
          `Holding off for now (${gate.stage}). ${gate.reason ?? "Need one more user clarification."}`,
        );
      } else {
        if (gate.carryoverContext) {
          input.situation_summary = gate.carryoverContext.situationSummary;
          if (gate.carryoverContext.needDimension) {
            input.need_dimension = gate.carryoverContext.needDimension;
          }
          options.onToolActivity?.(gate.carryoverContext.confirmationMessage);
        }
        stageController.noteMatchAttempt(
          input.situation_summary,
          input.need_dimension,
        );
      }
      return gate;
    },
    onMatch: (result) => {
      stageController.onMatch(result);
      options.onMatch?.(result);
    },
  });

  const agent = new RealtimeAgent({
    name: "Resona",
    instructions: buildResonaSystemPrompt({
      founderName: options.profileContext.name,
      company: options.profileContext.company,
      summary: options.profileContext.summary,
      raiseContext: options.profileContext.raise_context,
      profileSource: options.profileContext.source,
      contextQuality: profileAssessment.quality,
    }),
    tools: [findMatchTool],
  });

  const transport = new OpenAIRealtimeWebRTC({
    audioElement: options.audioElement,
  });

  const session = new RealtimeSession(agent, {
    model: "gpt-realtime-2",
    transport,
    config: {
      audio: {
        input: {
          transcription: {
            model: "gpt-4o-mini-transcribe",
          },
          turnDetection: {
            type: "server_vad",
            createResponse: true,
            interruptResponse: false,
            threshold: 0.65,
            silenceDurationMs: 700,
            prefixPaddingMs: 280,
          },
        },
      },
    },
  });

  (session as any).on("agent_tool_start", (_ctx: any, _agent: any, toolDef: any) => {
    options.onToolActivity?.(
      `Looking across Ajay's network with ${toolDef?.name ?? "the matcher"}...`,
    );
  });

  (session as any).on("agent_tool_end", () => {
    options.onToolActivity?.("Got it — shaping the best-fit recommendation.");
  });

  (session as any).on("error", (error: any) => {
    const message =
      (typeof error?.error?.message === "string" && error.error.message) ||
      (typeof error?.message === "string" && error.message) ||
      (typeof error?.error === "string" && error.error) ||
      null;

    if (message) {
      options.onError?.(message);
    }
  });

  (session.transport as any).on(
    "audio_transcript_delta",
    ({ delta }: { delta: string }) => {
      options.onTranscriptDelta?.(delta);
    },
  );

  const userWordCountByItemId = new Map<string, number>();
  const latestConversationByItemKey = new Map<
    string,
    {
      text: string;
      status?: string;
    }
  >();
  let lastAssistantEmission: {
    normalizedText: string;
    key: string;
    emittedAtMs: number;
  } | null = null;

  const emitConversationItem = (item: ConversationItem) => {
    const text = item.text.trim();
    if (!item.itemId || !text || isWarmKickoffText(text)) {
      return;
    }
    const key = `${item.role}:${item.itemId}`;
    const previous = latestConversationByItemKey.get(key);
    if (previous?.text === text && previous.status === item.status) {
      return;
    }

    if (item.role === "assistant") {
      const normalizedText = normalizeAssistantDedupText(text);
      const isCompletedAssistantTurn = item.status === "completed";
      if (
        normalizedText &&
        isCompletedAssistantTurn &&
        normalizedText.length >= 60 &&
        lastAssistantEmission &&
        lastAssistantEmission.key !== key &&
        lastAssistantEmission.normalizedText === normalizedText &&
        Date.now() - lastAssistantEmission.emittedAtMs < 3000
      ) {
        latestConversationByItemKey.set(key, {
          text,
          status: item.status,
        });
        return;
      }
    }

    latestConversationByItemKey.set(key, {
      text,
      status: item.status,
    });
    options.onConversationItem?.({
      ...item,
      text,
    });

    if (item.role === "assistant") {
      const normalizedText = normalizeAssistantDedupText(text);
      if (normalizedText) {
        lastAssistantEmission = {
          normalizedText,
          key,
          emittedAtMs: Date.now(),
        };
      }
    }
  };

  const observeUserTranscript = (
    itemId: string | undefined,
    userText: string,
    isNewTurnHint = false,
  ) => {
    const normalized = userText.trim();
    if (!itemId || !normalized || isWarmKickoffText(normalized)) {
      return;
    }

    const currentWords = countWords(normalized);
    const previousWords = userWordCountByItemId.get(itemId) ?? 0;
    if (currentWords > previousWords) {
      stageController.observeUserWordDelta(
        currentWords - previousWords,
        previousWords === 0 || isNewTurnHint,
      );
      userWordCountByItemId.set(itemId, currentWords);
      if (previousWords === 0) {
        options.onToolActivity?.("Got you — hearing your context. Thinking through best fit.");
      }
    }
  };

  (session.transport as any).on("*", (event: any) => {
    if (event?.type !== "conversation.item.input_audio_transcription.completed") {
      return;
    }
    const itemId =
      typeof event?.item_id === "string" ? event.item_id : "";
    const transcript =
      typeof event?.transcript === "string" ? event.transcript : "";
    if (!itemId || !transcript) {
      return;
    }

    emitConversationItem({
      itemId,
      role: "user",
      text: transcript,
      status: "completed",
    });
    observeUserTranscript(itemId, transcript);
  });

  (session.transport as any).on("item_update", (item: any) => {
    if (
      !item ||
      item.type !== "message" ||
      (item.role !== "user" && item.role !== "assistant")
    ) {
      return;
    }
    const itemId =
      typeof item.itemId === "string"
        ? item.itemId
        : (typeof item.item_id === "string"
            ? item.item_id
            : (typeof item.id === "string" ? item.id : ""));
    if (!itemId) {
      return;
    }

    if (item.role === "assistant") {
      const text = extractAssistantUtterance(item);
      emitConversationItem({
        itemId,
        role: "assistant",
        text,
        status: item.status,
      });
      return;
    }

    const hasAudioInputPart = Array.isArray(item.content)
      && item.content.some((part: any) => part?.type === "input_audio");
    if (hasAudioInputPart) {
      // Audio user turns are handled by conversation.item.input_audio_transcription.completed.
      return;
    }

    const text = extractUserUtterance(item);
    emitConversationItem({
      itemId,
      role: "user",
      text,
      status: item.status,
    });
    observeUserTranscript(itemId, text);
  });

  await session.connect({ apiKey: token.value });
  options.onToolActivity?.(
    profileAssessment.quality === "high"
      ? "Connected. Opening the conversation with your profile context."
      : `Connected. Opening with a quick context calibration (${profileAssessment.notes.join(", ")}).`,
  );

  session.sendMessage(
    {
      type: "message",
      role: "user",
      content: [
        {
          type: "input_text",
          text: buildWarmKickoffInstruction(
            options.profileContext,
            profileAssessment.quality,
          ),
        },
      ],
    },
  );

  return {
    session,
    close: async () => {
      userWordCountByItemId.clear();
      latestConversationByItemKey.clear();
      await session.close();
    },
  };
}
