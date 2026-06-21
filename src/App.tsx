import { useEffect, useMemo, useRef, useState } from "react";

import { startResonaSession, type StartedResonaSession } from "./realtime/session";
import { getTier2Counts, type MatchMode } from "./tools/findMatch";
import type { MatchResult } from "./types/match";

type LinkedInSnapshot = {
  name: string;
  company: string;
  summary: string;
  raise_context: string;
  source: "cache" | "apify";
  fetched_at: string;
};

type ConversationTurn = {
  itemId: string;
  role: "user" | "assistant";
  text: string;
  status?: string;
};

const apiBaseUrl =
  import.meta.env.VITE_API_BASE_URL?.toString() ?? "http://localhost:8787";

const configuredMatchMode =
  import.meta.env.VITE_MATCH_MODE === "dummy" ? "dummy" : "real";

function createIntroDraft(match: MatchResult, profileSnapshot: LinkedInSnapshot) {
  const candidate = match.candidate;
  if (!candidate) {
    return "";
  }
  const ask =
    match.selection?.topBrings[0]?.claim ??
    "unlocking the immediate outcome they described this month";
  return [
    `Ajay, could you introduce ${profileSnapshot.name} (${profileSnapshot.company}) to ${candidate.name}?`,
    `${profileSnapshot.name} is looking for help with ${ask}. ${match.why_spine.frame}`,
    `${candidate.name}, if helpful, can we do a short call this week to align on the highest-leverage next step?`,
  ].join("\n");
}

function formatConfidence(match: MatchResult): string {
  if (!match.confidence) {
    return "confidence: unavailable";
  }
  return `confidence: ${Math.round(match.confidence.overall * 100)}%`;
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

export function App() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const sessionRef = useRef<StartedResonaSession | null>(null);
  const matchHistoryRef = useRef<MatchResult[]>([]);
  const acceptTranscriptDeltaRef = useRef(false);
  const turnLogRef = useRef<HTMLDivElement | null>(null);

  const [sessionState, setSessionState] = useState<
    "idle" | "connecting" | "connected"
  >("idle");
  const [error, setError] = useState<string | null>(null);
  const [toolActivity, setToolActivity] = useState<string>(
    "Resona is ready when you are.",
  );
  const [transcript, setTranscript] = useState<string>("");
  const [linkedinUrl, setLinkedinUrl] = useState<string>(
    "https://www.linkedin.com/in/umang-trucommerce",
  );
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileSnapshot, setProfileSnapshot] = useState<LinkedInSnapshot | null>(
    null,
  );
  const [profileBeatMessage, setProfileBeatMessage] = useState<string>(
    "Load profile context so Resona can open with the right context.",
  );
  const [realtimePreflight, setRealtimePreflight] = useState<string>(
    "Not checked in app yet.",
  );
  const [conversationTurns, setConversationTurns] = useState<ConversationTurn[]>(
    [],
  );
  const [matchHistory, setMatchHistory] = useState<MatchResult[]>([]);
  const [matchGuidance, setMatchGuidance] = useState<string>("");
  const [selectedIntroCandidateId, setSelectedIntroCandidateId] =
    useState<string>("");
  const [introDraft, setIntroDraft] = useState<string>("");
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">(
    "idle",
  );

  const tier2Counts = useMemo(() => getTier2Counts(), []);
  const matchMode = configuredMatchMode as MatchMode;
  const hasStreamingAssistantTurn = conversationTurns.some(
    (turn) => turn.role === "assistant" && turn.status === "in_progress",
  );
  const transcriptForCopy = useMemo(() => {
    const lines = conversationTurns
      .map((turn) => {
        const normalized = turn.text.trim();
        if (!normalized) {
          return null;
        }
        return `${turn.role === "assistant" ? "Resona" : "You"}: ${normalized}`;
      })
      .filter((line): line is string => !!line);
    if (lines.length === 0 && transcript.trim()) {
      lines.push(`Resona: ${transcript.trim()}`);
    }
    return lines.join("\n\n");
  }, [conversationTurns, transcript]);
  const isLinkedinUrlValid =
    /^https?:\/\/(www\.)?linkedin\.com\/.+/i.test(linkedinUrl);

  async function runRealtimePreflightCheck() {
    setRealtimePreflight("Checking server preflight...");
    try {
      const response = await fetch(`${apiBaseUrl}/api/preflight/realtime`);
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

  async function loadLinkedInContext() {
    if (!isLinkedinUrlValid) {
      setError("Enter a valid LinkedIn URL before loading profile context.");
      return;
    }

    setProfileLoading(true);
    setError(null);
    setProfileSnapshot(null);
    setProfileBeatMessage("Resona is pulling profile context...");
    try {
      const response = await fetch(`${apiBaseUrl}/api/linkedin/fetch`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          linkedinUrl,
        }),
      });

      const payload = await response.json();
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error ?? "Failed to load LinkedIn context.");
      }

      const snapshot = payload.snapshot as LinkedInSnapshot;
      const quality = assessSnapshotQuality(snapshot);
      setProfileSnapshot(snapshot);
      setProfileBeatMessage(
        quality.quality === "high"
          ? `Profile loaded from ${snapshot.source}. Resona is ready to open warmly.`
          : `Profile loaded from ${snapshot.source}, but context is partial (${quality.notes.join(", ")}). Resona will start with a quick calibration nudge.`,
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
      setError(
        resolvedErrorMessage,
      );
      setProfileBeatMessage(
        "Could not load reliable profile context. Try another URL or retry once your profile API is ready.",
      );
    } finally {
      setProfileLoading(false);
    }
  }

  async function connectSession() {
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

    try {
      const started = await startResonaSession({
        apiBaseUrl,
        audioElement: audioRef.current,
        matchMode,
        profileContext: profileSnapshot,
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
            return;
          }

          setMatchGuidance("");
          setToolActivity(
            `Found a strong match with ${Math.round(
              (result.confidence?.overall ?? 0) * 100,
            )}% confidence. I can draft now, or rematch with an added constraint.`,
          );
          setMatchHistory((prev) => {
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
    } catch (connectError) {
      setError(
        connectError instanceof Error
          ? connectError.message
          : "Failed to connect realtime session.",
      );
      acceptTranscriptDeltaRef.current = false;
      setSessionState("idle");
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
    );
    if (!selected) {
      setError("Select a match before drafting the intro.");
      return;
    }
    setIntroDraft(createIntroDraft(selected, profileSnapshot));
  }

  useEffect(() => {
    if (selectedIntroCandidateId) {
      return;
    }
    const firstCandidateId = matchHistory.find((match) => match.candidate)?.candidate
      ?.id;
    if (firstCandidateId) {
      setSelectedIntroCandidateId(firstCandidateId);
    }
  }, [matchHistory, selectedIntroCandidateId]);

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

  return (
    <main className="app-shell">
      <header className="hero">
        <p className="eyebrow">Resona Hackathon Build</p>
        <h1>Voice connector demo: one or two matches, one intro artifact.</h1>
        <p className="subtle">
          Mode: <strong>{matchMode}</strong> | Tier-2 gate:{" "}
          <strong>
            {tier2Counts.tier2Eligible}/{tier2Counts.total}
          </strong>{" "}
          eligible (non-tag-only candidates).
        </p>
      </header>

      <section className="panel-grid">
        <article className="panel">
          <h2>1) Pre-flight</h2>
          <p>{realtimePreflight}</p>
          <button type="button" onClick={runRealtimePreflightCheck}>
            Check realtime readiness
          </button>
        </article>

        <article className="panel">
          <h2>2) LinkedIn context load</h2>
          <p>{profileBeatMessage}</p>
          <label className="input-label" htmlFor="linkedin-url">
            Founder LinkedIn URL
          </label>
          <input
            id="linkedin-url"
            type="url"
            value={linkedinUrl}
            onChange={(event) => setLinkedinUrl(event.target.value)}
            placeholder="https://www.linkedin.com/in/..."
          />
          <button
            type="button"
            onClick={loadLinkedInContext}
            disabled={profileLoading || !isLinkedinUrlValid}
          >
            {profileLoading ? "Loading profile..." : "Load profile context"}
          </button>
          {profileSnapshot ? (
            <div className="snapshot">
              <p>
                <strong>{profileSnapshot.name}</strong> — {profileSnapshot.company}
              </p>
              <p>{profileSnapshot.summary}</p>
              <p>{profileSnapshot.raise_context}</p>
              <p className="subtle">
                Source: {profileSnapshot.source} • fetched {new Date(profileSnapshot.fetched_at).toLocaleString()}
              </p>
            </div>
          ) : null}
        </article>
      </section>

      <section className="panel-grid">
        <article className="panel">
          <h2>3) Realtime voice wall</h2>
          <p>State: {sessionState}</p>
          <p>{toolActivity}</p>
          <div className="row">
            <button
              type="button"
              onClick={connectSession}
              disabled={sessionState !== "idle" || !profileSnapshot}
            >
              Start Resona session
            </button>
            <button
              type="button"
              onClick={disconnectSession}
              disabled={sessionState === "idle"}
            >
              End session
            </button>
          </div>
          <audio ref={audioRef} autoPlay />
        </article>

        <article className="panel">
          <div className="panel-title-row">
            <h2>4) Live conversation log</h2>
            <button
              type="button"
              onClick={copyConversationTranscript}
              disabled={!transcriptForCopy}
            >
              Copy transcript
            </button>
          </div>
          {copyStatus === "copied" ? (
            <p className="subtle">Transcript copied to clipboard.</p>
          ) : copyStatus === "failed" ? (
            <p className="subtle">Could not access clipboard. Please try again.</p>
          ) : null}
          <div
            className="turn-log"
            ref={turnLogRef}
            role="log"
            aria-label="Conversation log"
          >
            {sessionState === "idle" ? (
              <p className="turn-row turn-assistant turn-live-row">
                <strong>Resona (live):</strong>{" "}
                <span className="mono transcript subtle">
                  Start a session to see live conversation.
                </span>
              </p>
            ) : !hasStreamingAssistantTurn ? (
              <p className="turn-row turn-assistant turn-live-row">
                <strong>Resona (live):</strong>{" "}
                <span className={`mono transcript ${transcript ? "" : "subtle"}`}>
                  {transcript || "Waiting for speech..."}
                </span>
              </p>
            ) : null}
            {conversationTurns.length === 0 ? (
              sessionState === "idle" ? null : (
                <p className="subtle turn-empty-state">Waiting for user/assistant turns...</p>
              )
            ) : (
              conversationTurns.map((turn) => {
                const isStreamingAssistantTurn =
                  turn.role === "assistant" && turn.status === "in_progress";
                return (
                  <p
                    key={turn.itemId}
                    className={`turn-row ${turn.role === "assistant" ? "turn-assistant" : "turn-user"}`}
                  >
                    <strong>{turn.role === "assistant" ? "Resona" : "You"}:</strong>{" "}
                    <span className={isStreamingAssistantTurn ? "mono transcript" : undefined}>
                      {turn.text}
                    </span>
                  </p>
                );
              })
            )}
          </div>
        </article>
      </section>

      <section className="panel">
        <h2>5) Match reveal</h2>
        {matchGuidance ? <p className="match-guidance">{matchGuidance}</p> : null}
        {matchHistory.length === 0 ? (
          <p>No matches surfaced yet.</p>
        ) : (
          <div className="card-grid">
            {matchHistory.map((match, index) => {
              if (!match.candidate) {
                return null;
              }

              return (
                <article
                  className="match-card reveal-card"
                  key={match.candidate.id}
                >
                  <p className="eyebrow">Match {index + 1}</p>
                  <h3>{match.candidate.name}</h3>
                  <p>
                    {match.selection?.topBrings[0]?.claim
                      ?? "No grounded complementarity card selected."}
                  </p>
                  <p className="subtle">{formatConfidence(match)}</p>
                  <div className="chip-row">
                    <span className="chip">
                      tier {match.candidate.qualityTier}
                    </span>
                    <span className="chip">
                      trust {match.candidate.trustEdge.band}
                    </span>
                  </div>
                  <ul>
                    <li>{match.why_spine.trigger}</li>
                    <li>{match.why_spine.complementarity}</li>
                    <li>{match.why_spine.trust_bridge}</li>
                    <li>{match.why_spine.frame}</li>
                  </ul>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section className="panel">
        <h2>6) Intro continuation</h2>
        {matchHistory.length < 1 ? (
          <p>Resona will draft an intro as soon as one strong match is surfaced.</p>
        ) : (
          <>
            <p>
              {matchHistory.length >= 2
                ? "Two strong matches complete. Choose priority intro and draft the 3-line note."
                : "One strong match is ready. Draft now, or ask for one more with an added constraint."}
            </p>
            <div className="row">
              <select
                aria-label="Choose priority intro candidate"
                value={selectedIntroCandidateId}
                onChange={(event) => setSelectedIntroCandidateId(event.target.value)}
              >
                {matchHistory.map((match) => {
                  if (!match.candidate) {
                    return null;
                  }
                  return (
                    <option key={match.candidate.id} value={match.candidate.id}>
                      {match.candidate.name}
                    </option>
                  );
                })}
              </select>
              <button type="button" onClick={draftIntro}>
                Draft intro
              </button>
            </div>
          </>
        )}
        {introDraft ? <pre className="mono intro-draft">{introDraft}</pre> : null}
      </section>

      {error ? (
        <section className="panel error-panel">
          <h2>Error</h2>
          <p>{error}</p>
        </section>
      ) : null}
    </main>
  );
}
