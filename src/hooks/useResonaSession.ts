import { useEffect, useMemo, useRef, useState } from "react";

import { createIntroDraft } from "../realtime/introDraft";
import { startResonaSession, type StartedResonaSession } from "../realtime/session";
import {
  DEFAULT_STYLE_MEMORY,
  inferStyleMemoryPatch,
  isLikelyMatchRejection,
  mergeStyleMemory,
  type StyleMemory,
} from "../realtime/conversationHeuristics";
import { getTier2Counts, type MatchMode } from "../tools/findMatch";
import type { MatchResult } from "../types/match";

export type LinkedInSnapshot = {
  name: string;
  company: string;
  summary: string;
  raise_context: string;
  source: "cache" | "apify";
  fetched_at: string;
};

export type ConversationTurn = {
  itemId: string;
  role: "user" | "assistant";
  text: string;
  status?: string;
};

export type ConfidenceBand = "high" | "medium" | "tentative";

export function confidenceBandFromOverall(overall: number): ConfidenceBand {
  const percent = Math.round(overall * 100);
  if (percent >= 80) {
    return "high";
  }
  if (percent >= 62) {
    return "medium";
  }
  return "tentative";
}

function generateSessionTelemetryId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `session-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function isLinkedInSnapshot(value: unknown): value is LinkedInSnapshot {
  if (!value || typeof value !== "object") {
    return false;
  }
  const asRecord = value as Record<string, unknown>;
  return (
    typeof asRecord.name === "string" &&
    typeof asRecord.company === "string" &&
    typeof asRecord.summary === "string" &&
    typeof asRecord.raise_context === "string" &&
    (asRecord.source === "cache" || asRecord.source === "apify") &&
    typeof asRecord.fetched_at === "string"
  );
}

const apiBaseUrl =
  import.meta.env.VITE_API_BASE_URL?.toString() ?? "http://localhost:8787";
const apiAuthKey = import.meta.env.VITE_RESONA_API_KEY?.toString().trim() ?? "";
const connectorName = import.meta.env.VITE_CONNECTOR_NAME?.toString().trim() || "Ajay";

const configuredMatchMode =
  import.meta.env.VITE_MATCH_MODE === "dummy" ? "dummy" : "real";

function authHeaders(base: Record<string, string> = {}): Record<string, string> {
  return apiAuthKey
    ? {
        ...base,
        "x-resona-api-key": apiAuthKey,
      }
    : base;
}

export function formatConfidence(match: MatchResult): string {
  if (!match.confidence) {
    return "confidence: unavailable";
  }
  const percent = Math.round(match.confidence.overall * 100);
  const band = confidenceBandFromOverall(match.confidence.overall);
  return `confidence: ${band} (${percent}%)`;
}

function isLikelyIncompleteAssistantTurn(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) {
    return false;
  }
  if (/[.!?。！？…]$/.test(trimmed)) {
    return false;
  }
  if (trimmed.endsWith(":")) {
    return false;
  }
  return true;
}

function assessSnapshotQuality(snapshot: LinkedInSnapshot): {
  quality: "high" | "partial";
  notes: string[];
} {
  const notes: string[] = [];
  if (!snapshot.name.trim() || snapshot.name.toLowerCase() === "unknown") {
    notes.push("founder name is uncertain");
  }
  if (!snapshot.company.trim() || snapshot.company.toLowerCase() === "no headline") {
    notes.push("company context is thin");
  }
  if (snapshot.summary.trim().length < 40) {
    notes.push("summary detail is limited");
  }

  return {
    quality: notes.length === 0 ? "high" : "partial",
    notes,
  };
}

export type ResonaSessionState = "idle" | "connecting" | "connected";
export type CopyStatus = "idle" | "copied" | "failed";

export function useResonaSession() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const sessionRef = useRef<StartedResonaSession | null>(null);
  const matchHistoryRef = useRef<MatchResult[]>([]);
  const acceptTranscriptDeltaRef = useRef(false);
  const turnLogRef = useRef<HTMLDivElement | null>(null);
  const sessionTelemetryIdRef = useRef("");
  const styleMemoryRef = useRef<StyleMemory>(DEFAULT_STYLE_MEMORY);
  const conversationTurnsRef = useRef<ConversationTurn[]>([]);

  const [sessionState, setSessionState] = useState<ResonaSessionState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [toolActivity, setToolActivity] = useState<string>(
    "Resona is ready when you are.",
  );
  const [transcript, setTranscript] = useState<string>("");
  const [linkedinUrl, setLinkedinUrl] = useState<string>("");
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileSnapshot, setProfileSnapshot] = useState<LinkedInSnapshot | null>(
    null,
  );
  const [profileContextQuality, setProfileContextQuality] = useState<
    "high" | "partial" | null
  >(null);
  const [profileBeatMessage, setProfileBeatMessage] = useState<string>(
    "Paste a LinkedIn URL or try the sample founder to begin.",
  );
  const [realtimePreflight, setRealtimePreflight] = useState<string>(
    "Not checked in app yet.",
  );
  const [conversationTurns, setConversationTurns] = useState<ConversationTurn[]>(
    [],
  );
  const [styleMemory, setStyleMemory] = useState<StyleMemory>(DEFAULT_STYLE_MEMORY);
  const [matchHistory, setMatchHistory] = useState<MatchResult[]>([]);
  const [matchGuidance, setMatchGuidance] = useState<string>("");
  const [selectedIntroCandidateId, setSelectedIntroCandidateId] =
    useState<string>("");
  const [introDraft, setIntroDraft] = useState<string>("");
  const [copyStatus, setCopyStatus] = useState<CopyStatus>("idle");

  const tier2Counts = useMemo(() => getTier2Counts(), []);
  const matchMode = configuredMatchMode as MatchMode;
  const hasStreamingAssistantTurn = conversationTurns.some(
    (turn) => turn.role === "assistant" && turn.status === "in_progress",
  );
  const transcriptForCopy = useMemo(() => {
    const filteredTurns = conversationTurns.filter((turn) => turn.status !== "in_progress");
    const collapsedTurns = filteredTurns.reduce<ConversationTurn[]>((accumulator, turn) => {
      const normalized = turn.text.trim();
      if (!normalized) {
        return accumulator;
      }
      const previous = accumulator[accumulator.length - 1];
      if (
        previous &&
        previous.role === "assistant" &&
        turn.role === "assistant" &&
        isLikelyIncompleteAssistantTurn(previous.text)
      ) {
        accumulator[accumulator.length - 1] = {
          ...previous,
          text: `${previous.text.trim()} ${normalized}`,
          status: turn.status ?? previous.status,
        };
        return accumulator;
      }
      accumulator.push({
        ...turn,
        text: normalized,
      });
      return accumulator;
    }, []);
    const lines = collapsedTurns.map(
      (turn) => `${turn.role === "assistant" ? "Resona" : "You"}: ${turn.text}`,
    );
    if (lines.length === 0 && transcript.trim()) {
      lines.push(`Resona: ${transcript.trim()}`);
    }
    return lines.join("\n\n");
  }, [conversationTurns, transcript]);
  const isLinkedinUrlValid =
    /^https?:\/\/(www\.)?linkedin\.com\/.+/i.test(linkedinUrl);

  function emitTelemetry(event: string, payload: Record<string, unknown> = {}) {
    void fetch(`${apiBaseUrl}/api/telemetry/events`, {
      method: "POST",
      headers: authHeaders({
        "Content-Type": "application/json",
      }),
      body: JSON.stringify({
        event,
        session_id: sessionTelemetryIdRef.current || null,
        payload,
      }),
    }).catch(() => {
      // Telemetry is best-effort; never block interaction on telemetry failure.
    });
  }

  async function runRealtimePreflightCheck() {
    setRealtimePreflight("Checking server preflight...");
    try {
      const response = await fetch(`${apiBaseUrl}/api/preflight/realtime`, {
        headers: authHeaders(),
      });
      const payload = await response.json();
      if (response.ok && payload?.ok) {
        setRealtimePreflight(
          `Realtime access OK (model: ${payload.status?.model ?? "unknown"}).`,
        );
      } else {
        setRealtimePreflight(payload?.error ?? "Realtime preflight failed.");
      }
    } catch (checkError) {
      setRealtimePreflight(
        checkError instanceof Error
          ? checkError.message
          : "Realtime preflight request failed.",
      );
    }
  }

  async function loadLinkedInContextFromUrl(targetLinkedinUrl: string) {
    const normalizedLinkedinUrl = targetLinkedinUrl.trim();
    const isValid =
      /^https?:\/\/(www\.)?linkedin\.com\/.+/i.test(normalizedLinkedinUrl);
    if (!isValid) {
      setError("Enter a valid LinkedIn URL before loading profile context.");
      return;
    }

    setLinkedinUrl(normalizedLinkedinUrl);
    setProfileLoading(true);
    setError(null);
    setProfileSnapshot(null);
    setProfileContextQuality(null);
    setProfileBeatMessage("Resona is pulling profile context...");
    try {
      const response = await fetch(`${apiBaseUrl}/api/linkedin/fetch`, {
        method: "POST",
        headers: authHeaders({
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({
          linkedinUrl: normalizedLinkedinUrl,
        }),
      });

      const payload = await response.json();
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error ?? "Failed to load LinkedIn context.");
      }

      if (!isLinkedInSnapshot(payload.snapshot)) {
        throw new Error("Backend returned an invalid profile snapshot.");
      }
      const snapshot = payload.snapshot;
      const quality = assessSnapshotQuality(snapshot);
      setProfileSnapshot(snapshot);
      setProfileContextQuality(quality.quality);
      setProfileBeatMessage(
        quality.quality === "high"
          ? "Profile loaded. Resona will open with the right context."
          : "Profile loaded. I'll calibrate the rest as we talk — no need to repeat your resume.",
      );
    } catch (fetchError) {
      const resolvedErrorMessage = (() => {
        if (
          fetchError instanceof TypeError &&
          fetchError.message.toLowerCase().includes("fetch")
        ) {
          return `Could not reach backend at ${apiBaseUrl}. Start the server and retry.`;
        }
        return fetchError instanceof Error
          ? fetchError.message
          : "LinkedIn profile fetch failed.";
      })();
      setError(resolvedErrorMessage);
      setProfileBeatMessage(
        "Could not load reliable profile context. Try another URL or retry once your profile API is ready.",
      );
    } finally {
      setProfileLoading(false);
    }
  }

  async function loadLinkedInContext() {
    await loadLinkedInContextFromUrl(linkedinUrl);
  }

  async function connectSession() {
    if (sessionState !== "idle") {
      return;
    }
    if (!audioRef.current) {
      setError("Missing audio element for realtime playback.");
      return;
    }
    if (!profileSnapshot) {
      setError("Load profile context before starting the Resona session.");
      return;
    }

    setError(null);
    setSessionState("connecting");
    setToolActivity("Connecting Resona...");
    setTranscript("");
    acceptTranscriptDeltaRef.current = true;
    setMatchHistory([]);
    matchHistoryRef.current = [];
    setMatchGuidance("");
    setSelectedIntroCandidateId("");
    setIntroDraft("");
    setCopyStatus("idle");
    setConversationTurns([]);
    sessionTelemetryIdRef.current = generateSessionTelemetryId();

    try {
      const started = await startResonaSession({
        apiBaseUrl,
        apiAuthKey: apiAuthKey || undefined,
        audioElement: audioRef.current,
        matchMode,
        profileContext: profileSnapshot,
        styleMemory: styleMemoryRef.current,
        onTranscriptDelta: (delta) => {
          if (!acceptTranscriptDeltaRef.current) {
            return;
          }
          setTranscript((prev) => `${prev}${delta}`);
        },
        onToolActivity: setToolActivity,
        onConversationItem: (item) => {
          setConversationTurns((previous) => {
            const nextTurn: ConversationTurn = {
              itemId: item.itemId,
              role: item.role,
              text: item.text,
              status: item.status,
            };
            const existingIndex = previous.findIndex(
              (turn) => turn.itemId === item.itemId,
            );
            if (existingIndex === -1) {
              return [...previous, nextTurn];
            }
            const current = previous[existingIndex];
            if (
              current.text === nextTurn.text &&
              current.status === nextTurn.status
            ) {
              return previous;
            }
            const updated = [...previous];
            updated[existingIndex] = nextTurn;
            return updated;
          });
          if (item.role === "assistant" && item.status === "completed") {
            acceptTranscriptDeltaRef.current = false;
            setTranscript("");
          }
          if (item.role === "assistant" && item.status === "in_progress") {
            acceptTranscriptDeltaRef.current = true;
          }
          if (item.role === "user" && item.status === "completed") {
            acceptTranscriptDeltaRef.current = true;
            const stylePatch = inferStyleMemoryPatch(item.text);
            if (Object.keys(stylePatch).length > 0) {
              const previous = styleMemoryRef.current;
              const next = mergeStyleMemory(previous, stylePatch);
              const changed =
                next.concise !== previous.concise ||
                next.direct !== previous.direct ||
                next.avoidProfileRecap !== previous.avoidProfileRecap;
              if (changed) {
                styleMemoryRef.current = next;
                setStyleMemory(next);
                emitTelemetry("style_memory_updated", {
                  stylePatch,
                  styleMemory: next,
                });
              }
            }
            if (isLikelyMatchRejection(item.text)) {
              emitTelemetry("match_rejected_by_user", {
                text_length: item.text.trim().length,
              });
            }
          }
        },
        onMatch: (result) => {
          if (result.source === "cap" || result.hard_cap_reached) {
            setMatchGuidance(
              result.no_match_reason ??
                "Two-match cap reached. Pick a priority intro candidate.",
            );
            setToolActivity(
              result.no_match_reason ??
                "Two strong options are ready. Let's move to intro drafting.",
            );
            emitTelemetry("match_cap_reached", {
              reason: result.no_match_reason ?? null,
            });
            return;
          }
          if (result.source === "no-match" || !result.candidate) {
            const hasExistingMatch = matchHistoryRef.current.some(
              (match) => !!match.candidate,
            );
            setMatchGuidance(
              hasExistingMatch
                ? (result.no_match_reason ??
                    "Only one high-confidence match is available right now. Choose it for intro draft or add a new constraint for another pass.")
                : (result.no_match_reason ??
                    "No high-confidence match yet. Ask one more clarifying question."),
            );
            setToolActivity(
              hasExistingMatch
                ? (result.no_match_reason ??
                    "One strong match is ready. I can draft that intro now or rematch with a sharper constraint.")
                : (result.no_match_reason ??
                    "Need one more nudge to lock the right match."),
            );
            emitTelemetry("no_match_returned", {
              hasExistingMatch,
              reason: result.no_match_reason ?? null,
              replacementAttempt: !!result.replacement_of_candidate_id,
            });
            return;
          }

          setMatchGuidance("");
          const confidencePercent = Math.round(
            (result.confidence?.overall ?? 0) * 100,
          );
          const confidenceBand = confidenceBandFromOverall(
            result.confidence?.overall ?? 0,
          );
          setToolActivity(
            `Found a ${confidenceBand}-confidence match (${confidencePercent}%). I can draft now, or rematch with an added constraint.`,
          );
          emitTelemetry("match_surfaced", {
            candidate_id: result.candidate.id,
            confidencePercent,
            confidenceBand,
            replacement_of_candidate_id: result.replacement_of_candidate_id ?? null,
          });
          setMatchHistory((prev) => {
            if (result.replacement_of_candidate_id) {
              const replaceIndex = prev.findIndex(
                (match) => match.candidate?.id === result.replacement_of_candidate_id,
              );
              if (replaceIndex >= 0) {
                const updated = [...prev];
                updated[replaceIndex] = result;
                matchHistoryRef.current = updated;
                return updated;
              }
              matchHistoryRef.current = prev;
              return prev;
            }
            if (prev.some((match) => match.candidate?.id === result.candidate?.id)) {
              matchHistoryRef.current = prev;
              return prev;
            }
            if (prev.length >= 2) {
              matchHistoryRef.current = prev;
              return prev;
            }
            const next = [...prev, result];
            matchHistoryRef.current = next;
            return next;
          });
        },
        onError: setError,
      });

      sessionRef.current = started;
      setSessionState("connected");
      emitTelemetry("session_started", {
        profileSource: profileSnapshot.source,
        styleMemory: styleMemoryRef.current,
      });
    } catch (connectError) {
      setError(
        connectError instanceof Error
          ? connectError.message
          : "Failed to connect realtime session.",
      );
      acceptTranscriptDeltaRef.current = false;
      setSessionState("idle");
      emitTelemetry("session_start_failed", {
        error:
          connectError instanceof Error
            ? connectError.message
            : "unknown",
      });
    }
  }

  async function disconnectSession() {
    try {
      const activeSession = sessionRef.current;
      sessionRef.current = null;
      if (activeSession) {
        await activeSession.close();
      }
    } catch (closeError) {
      setError(
        closeError instanceof Error
          ? closeError.message
          : "Failed to close realtime session cleanly.",
      );
    } finally {
      setSessionState("idle");
      setConversationTurns((previous) =>
        previous.map((turn) =>
          turn.status === "in_progress"
            ? {
                ...turn,
                status: "interrupted",
              }
            : turn,
        ),
      );
      acceptTranscriptDeltaRef.current = false;
      emitTelemetry("session_ended", {
        turnCount: conversationTurnsRef.current.length,
        matchCount: matchHistoryRef.current.length,
      });
    }
  }

  async function copyConversationTranscript() {
    setCopyStatus("idle");
    if (!transcriptForCopy) {
      return;
    }
    try {
      await navigator.clipboard.writeText(transcriptForCopy);
      setCopyStatus("copied");
    } catch {
      setCopyStatus("failed");
    }
  }

  function draftIntro() {
    if (!profileSnapshot) {
      setError("Load profile context before drafting an intro.");
      return;
    }
    const selected = matchHistory.find(
      (match) => match.candidate?.id === selectedIntroCandidateId,
    ) ?? (matchHistory.length === 1 ? matchHistory[0] : undefined);
    if (!selected) {
      setError("Select a match before drafting the intro.");
      return;
    }
    setIntroDraft(createIntroDraft(selected, profileSnapshot, connectorName));
    emitTelemetry("intro_drafted", {
      candidate_id: selected.candidate?.id ?? null,
    });
  }

  function clearError() {
    setError(null);
  }

  useEffect(() => {
    const selectedStillExists = selectedIntroCandidateId &&
      matchHistory.some(
        (match) => match.candidate?.id === selectedIntroCandidateId,
      );
    if (selectedStillExists) {
      return;
    }
    const firstCandidateId = matchHistory.find((match) => match.candidate)?.candidate?.id
      ?? "";
    setSelectedIntroCandidateId(firstCandidateId);
  }, [matchHistory, selectedIntroCandidateId]);

  useEffect(() => {
    conversationTurnsRef.current = conversationTurns;
  }, [conversationTurns]);

  useEffect(() => {
    styleMemoryRef.current = styleMemory;
  }, [styleMemory]);

  useEffect(() => {
    if (!turnLogRef.current) {
      return;
    }
    turnLogRef.current.scrollTop = turnLogRef.current.scrollHeight;
  }, [conversationTurns, transcript]);

  useEffect(() => {
    if (copyStatus === "idle") {
      return;
    }
    const timer = window.setTimeout(() => {
      setCopyStatus("idle");
    }, 2200);
    return () => window.clearTimeout(timer);
  }, [copyStatus]);

  useEffect(() => {
    return () => {
      const activeSession = sessionRef.current;
      sessionRef.current = null;
      if (activeSession) {
        void activeSession.close();
      }
    };
  }, []);

  return {
    audioRef,
    turnLogRef,
    sessionState,
    error,
    toolActivity,
    transcript,
    linkedinUrl,
    profileLoading,
    profileSnapshot,
    profileContextQuality,
    profileBeatMessage,
    realtimePreflight,
    conversationTurns,
    styleMemory,
    matchHistory,
    matchGuidance,
    selectedIntroCandidateId,
    introDraft,
    copyStatus,
    tier2Counts,
    matchMode,
    hasStreamingAssistantTurn,
    transcriptForCopy,
    isLinkedinUrlValid,
    setLinkedinUrl,
    setSelectedIntroCandidateId,
    setIntroDraft,
    runRealtimePreflightCheck,
    loadLinkedInContextFromUrl,
    loadLinkedInContext,
    connectSession,
    disconnectSession,
    copyConversationTranscript,
    draftIntro,
    clearError,
  };
}

export type ResonaSessionModel = ReturnType<typeof useResonaSession>;
