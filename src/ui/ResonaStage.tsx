import { useEffect, useMemo, useRef, useState } from "react";

import type { ResonaSessionModel, ResonaSessionState } from "../hooks/useResonaSession";
import { DevPanel } from "./DevPanel";
import { ErrorRecovery } from "./ErrorRecovery";
import { IntakeView } from "./IntakeView";
import { IntroComposer } from "./IntroComposer";
import { LiveCaption } from "./LiveCaption";
import { MatchReveal } from "./MatchReveal";
import { MicPrimer } from "./MicPrimer";
import { StatusWhisper } from "./StatusWhisper";
import { TranscriptDrawer } from "./TranscriptDrawer";
import { VoiceCore } from "./VoiceCore";
import { WelcomeView } from "./WelcomeView";

const SAMPLE_FOUNDER_LINKEDIN = "https://www.linkedin.com/in/umang-trucommerce";
const IDLE_NUDGE_MS = 28_000;

type Stage = "welcome" | "intake" | "mic" | "live" | "reveal" | "intro";

function browserSupportsRealtimeVoice(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  const hasPeerConnection = typeof window.RTCPeerConnection !== "undefined";
  const hasMediaDevices =
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices &&
    typeof navigator.mediaDevices.getUserMedia === "function";
  return hasPeerConnection && hasMediaDevices;
}

function isLikelyMicPermissionError(error: string | null): boolean {
  if (!error) {
    return false;
  }
  return /notallowederror|permission|microphone/i.test(error);
}

function isRealtimeReady(status: string): boolean {
  return /realtime access ok/i.test(status);
}

function deriveStage({
  enteredFlow,
  profileLoaded,
  showMicPrimer,
  introDraft,
  matchCount,
  hasGuidance,
  sessionState,
}: {
  enteredFlow: boolean;
  profileLoaded: boolean;
  showMicPrimer: boolean;
  introDraft: string;
  matchCount: number;
  hasGuidance: boolean;
  sessionState: ResonaSessionState;
}): Stage {
  if (!enteredFlow) {
    return "welcome";
  }
  if (!profileLoaded) {
    return "intake";
  }
  if (showMicPrimer) {
    return "mic";
  }
  if (profileLoaded && sessionState === "idle") {
    return "intake";
  }
  if (introDraft.trim()) {
    return "intro";
  }
  if (matchCount > 0 || hasGuidance) {
    return "reveal";
  }
  return "live";
}

export function ResonaStage(session: ResonaSessionModel) {
  const [enteredFlow, setEnteredFlow] = useState(false);
  const [showMicPrimer, setShowMicPrimer] = useState(false);
  const [transcriptDrawerOpen, setTranscriptDrawerOpen] = useState(false);
  const [devPanelOpen, setDevPanelOpen] = useState(false);
  const [autoPreflightDone, setAutoPreflightDone] = useState(false);
  const [viewOverride, setViewOverride] = useState<Stage | null>(null);
  const [showIdleNudge, setShowIdleNudge] = useState(false);
  const preflightCheckRef = useRef(session.runRealtimePreflightCheck);
  const lastActivityAtRef = useRef(Date.now());

  const browserSupported = useMemo(() => browserSupportsRealtimeVoice(), []);
  const unsupportedMessage = browserSupported
    ? null
    : "WebRTC microphone support is not available in this browser. Please use Chrome or Edge.";

  const stage = deriveStage({
    enteredFlow,
    profileLoaded: Boolean(session.profileSnapshot),
    showMicPrimer,
    introDraft: session.introDraft,
    matchCount: session.matchHistory.length,
    hasGuidance: Boolean(session.matchGuidance),
    sessionState: session.sessionState,
  });
  const displayStage = viewOverride ?? stage;
  const realtimeReady = isRealtimeReady(session.realtimePreflight);
  const hasUserTurn = session.conversationTurns.some(
    (turn) => turn.role === "user" && turn.status === "completed",
  );
  const isThinking =
    /looking across|shaping|thinking|matcher|network/i.test(session.toolActivity) &&
    session.sessionState === "connected" &&
    !session.hasStreamingAssistantTurn;
  const micBlockedMessage = isLikelyMicPermissionError(session.error)
    ? session.error ?? undefined
    : undefined;
  const voiceCoreCollapsed = displayStage === "reveal" || displayStage === "intro";

  useEffect(() => {
    preflightCheckRef.current = session.runRealtimePreflightCheck;
  }, [session.runRealtimePreflightCheck]);

  useEffect(() => {
    if (!enteredFlow || autoPreflightDone || !browserSupported) {
      return;
    }
    setAutoPreflightDone(true);
    void preflightCheckRef.current();
  }, [autoPreflightDone, browserSupported, enteredFlow]);

  useEffect(() => {
    if (session.sessionState === "connected") {
      setShowMicPrimer(false);
    }
  }, [session.sessionState]);

  useEffect(() => {
    setViewOverride(null);
  }, [stage]);

  useEffect(() => {
    lastActivityAtRef.current = Date.now();
    setShowIdleNudge(false);
  }, [
    session.conversationTurns,
    session.transcript,
    session.toolActivity,
    session.matchHistory.length,
    session.introDraft,
  ]);

  useEffect(() => {
    if (session.sessionState !== "connected" || !hasUserTurn) {
      setShowIdleNudge(false);
      return;
    }
    const timer = window.setInterval(() => {
      if (Date.now() - lastActivityAtRef.current >= IDLE_NUDGE_MS) {
        setShowIdleNudge(true);
      }
    }, 4_000);
    return () => window.clearInterval(timer);
  }, [hasUserTurn, session.sessionState]);

  async function handleMicContinue() {
    session.clearError();
    await session.connectSession();
  }

  function handleStartIntent() {
    if (!browserSupported) {
      return;
    }
    setShowMicPrimer(true);
  }

  function handleRetryError() {
    if (unsupportedMessage) {
      return;
    }
    if (!session.profileSnapshot) {
      void session.loadLinkedInContext();
      return;
    }
    if (isLikelyMicPermissionError(session.error)) {
      setShowMicPrimer(true);
      return;
    }
    if (session.sessionState === "idle") {
      void session.connectSession();
    }
  }

  const visibleError = unsupportedMessage ?? session.error;
  const shouldShowErrorRecovery = Boolean(visibleError) && !(
    showMicPrimer && Boolean(micBlockedMessage)
  );

  function renderVoiceRoom(options?: { compact?: boolean }) {
    return (
      <section className={`voice-room glass-panel ${options?.compact ? "voice-room-compact" : ""}`}>
        <div className="section-head">
          <h2>Talk to Resona</h2>
          <p className="subtle">One question at a time. Say what you need unlocked.</p>
        </div>
        <VoiceCore
          sessionState={session.sessionState}
          isSpeaking={session.hasStreamingAssistantTurn}
          isThinking={isThinking}
          hasUserTurn={hasUserTurn}
          collapsed={voiceCoreCollapsed}
          showIdleNudge={showIdleNudge && !voiceCoreCollapsed}
        />
        {!voiceCoreCollapsed ? (
          <>
            <StatusWhisper message={session.toolActivity} />
            <LiveCaption
              sessionState={session.sessionState}
              conversationTurns={session.conversationTurns}
              hasStreamingAssistantTurn={session.hasStreamingAssistantTurn}
              transcript={session.transcript}
            />
          </>
        ) : null}
        <div className="room-actions">
          <button
            type="button"
            className="primary-btn"
            onClick={() => {
              if (session.sessionState === "idle") {
                handleStartIntent();
                return;
              }
              void session.disconnectSession();
            }}
          >
            {session.sessionState === "idle" ? "Start voice session" : "End session"}
          </button>
          {displayStage === "reveal" ? (
            <button
              type="button"
              className="ghost-btn"
              onClick={() => setViewOverride("live")}
            >
              Keep talking
            </button>
          ) : null}
          {displayStage === "live" && session.matchHistory.length > 0 ? (
            <button
              type="button"
              className="ghost-btn"
              onClick={() => setViewOverride("reveal")}
            >
              View match
            </button>
          ) : null}
          {displayStage === "reveal" && session.matchHistory.length > 0 && !session.introDraft ? (
            <button type="button" className="ghost-btn" onClick={session.draftIntro}>
              Draft intro
            </button>
          ) : null}
          {displayStage === "reveal" && session.introDraft ? (
            <button
              type="button"
              className="ghost-btn"
              onClick={() => setViewOverride("intro")}
            >
              View intro
            </button>
          ) : null}
        </div>
      </section>
    );
  }

  function renderStagePanel() {
    switch (displayStage) {
      case "welcome":
        return <WelcomeView onContinue={() => setEnteredFlow(true)} />;
      case "intake":
        return (
          <IntakeView
            linkedinUrl={session.linkedinUrl}
            onLinkedinUrlChange={session.setLinkedinUrl}
            onLoadProfile={() => {
              void session.loadLinkedInContext();
            }}
            onUseSampleFounder={() => {
              void session.loadLinkedInContextFromUrl(SAMPLE_FOUNDER_LINKEDIN);
            }}
            profileLoading={session.profileLoading}
            isLinkedinUrlValid={session.isLinkedinUrlValid}
            profileBeatMessage={session.profileBeatMessage}
            profileContextQuality={session.profileContextQuality}
            profileSnapshot={session.profileSnapshot}
            realtimePreflight={session.realtimePreflight}
            realtimeReady={realtimeReady}
            onStartSession={handleStartIntent}
            canStartSession={session.sessionState === "idle" && !!session.profileSnapshot}
            sessionState={session.sessionState}
          />
        );
      case "mic":
        return session.profileSnapshot ? (
          <MicPrimer
            onContinue={() => {
              void handleMicContinue();
            }}
            onBack={() => setShowMicPrimer(false)}
            connecting={session.sessionState === "connecting"}
            blockedMessage={micBlockedMessage}
          />
        ) : null;
      case "live":
        return (
          <div className="stage-panel stage-live">
            {renderVoiceRoom()}
            <TranscriptDrawer
              open={transcriptDrawerOpen}
              onToggle={() => setTranscriptDrawerOpen((prev) => !prev)}
              turnLogRef={session.turnLogRef}
              conversationTurns={session.conversationTurns}
              sessionState={session.sessionState}
              hasStreamingAssistantTurn={session.hasStreamingAssistantTurn}
              transcript={session.transcript}
              transcriptForCopy={session.transcriptForCopy}
              copyStatus={session.copyStatus}
              onCopyTranscript={() => {
                void session.copyConversationTranscript();
              }}
            />
          </div>
        );
      case "reveal":
        return (
          <div className="stage-panel stage-reveal">
            {renderVoiceRoom({ compact: true })}
            <MatchReveal
              matchHistory={session.matchHistory}
              matchGuidance={session.matchGuidance}
            />
          </div>
        );
      case "intro":
        return (
          <div className="stage-panel stage-intro">
            <IntroComposer
              matchHistory={session.matchHistory}
              selectedIntroCandidateId={session.selectedIntroCandidateId}
              onSelectCandidate={session.setSelectedIntroCandidateId}
              onDraftIntro={session.draftIntro}
              introDraft={session.introDraft}
              onIntroDraftChange={session.setIntroDraft}
            />
            {session.matchHistory.length > 0 ? (
              <button
                type="button"
                className="ghost-btn stage-back-link"
                onClick={() => setViewOverride("reveal")}
              >
                Back to match
              </button>
            ) : null}
          </div>
        );
      default:
        return null;
    }
  }

  return (
    <main className={`resona-shell stage-${displayStage}`}>
      <audio ref={session.audioRef} autoPlay />

      <header className="top-bar glass-panel">
        <div className="brand-row">
          <h1>Resona</h1>
          <p className="subtle">Warm intro matchmaker</p>
        </div>
        <div className="top-actions">
          <button
            type="button"
            className="ghost-btn"
            onClick={() => setTranscriptDrawerOpen((prev) => !prev)}
            disabled={!enteredFlow || displayStage === "welcome"}
          >
            {transcriptDrawerOpen ? "Hide transcript" : "Transcript"}
          </button>
          <button
            type="button"
            className="ghost-btn dev-toggle"
            onClick={() => setDevPanelOpen((prev) => !prev)}
          >
            Dev
          </button>
        </div>
      </header>

      {renderStagePanel()}

      {enteredFlow && displayStage !== "live" && transcriptDrawerOpen ? (
        <TranscriptDrawer
          open={transcriptDrawerOpen}
          onToggle={() => setTranscriptDrawerOpen((prev) => !prev)}
          turnLogRef={session.turnLogRef}
          conversationTurns={session.conversationTurns}
          sessionState={session.sessionState}
          hasStreamingAssistantTurn={session.hasStreamingAssistantTurn}
          transcript={session.transcript}
          transcriptForCopy={session.transcriptForCopy}
          copyStatus={session.copyStatus}
          onCopyTranscript={() => {
            void session.copyConversationTranscript();
          }}
        />
      ) : null}

      {shouldShowErrorRecovery && visibleError ? (
        <ErrorRecovery
          message={visibleError}
          onRetry={unsupportedMessage ? undefined : handleRetryError}
          onDismiss={unsupportedMessage ? undefined : session.clearError}
        />
      ) : null}

      <DevPanel
        open={devPanelOpen}
        onToggle={() => setDevPanelOpen((prev) => !prev)}
        matchMode={session.matchMode}
        tier2Counts={session.tier2Counts}
        realtimePreflight={session.realtimePreflight}
        onRunPreflight={() => {
          void session.runRealtimePreflightCheck();
        }}
        transcriptForCopy={session.transcriptForCopy}
        styleMemory={session.styleMemory}
        stage={displayStage}
      />
    </main>
  );
}
