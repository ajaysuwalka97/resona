import type { ResonaSessionState } from "../hooks/useResonaSession";

type VoiceCoreProps = {
  sessionState: ResonaSessionState;
  isSpeaking: boolean;
  isThinking: boolean;
  hasUserTurn: boolean;
  collapsed?: boolean;
  showIdleNudge?: boolean;
};

export function VoiceCore({
  sessionState,
  isSpeaking,
  isThinking,
  hasUserTurn,
  collapsed = false,
  showIdleNudge = false,
}: VoiceCoreProps) {
  const mode = (() => {
    if (sessionState === "idle") {
      return "idle";
    }
    if (isSpeaking) {
      return "speaking";
    }
    if (isThinking) {
      return "thinking";
    }
    return "listening";
  })();

  if (collapsed) {
    return (
      <div className="voice-core-wrap collapsed" aria-hidden="true">
        <div className={`voice-core mode-${mode} voice-core-mini`}>
          <div className="voice-core-center">
            <span>Resona</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <section className="voice-core-wrap">
      <div className={`voice-core mode-${mode}`} aria-label={`Voice core ${mode}`}>
        <div className="voice-core-ring outer" />
        <div className="voice-core-ring inner" />
        <div className="voice-core-center">
          <span>Resona</span>
        </div>
      </div>
      {showIdleNudge ? (
        <p className="idle-nudge" aria-live="polite">
          Still there? Say what changed, or ask Resona to draft the intro.
        </p>
      ) : !hasUserTurn && sessionState !== "idle" ? (
        <p className="first-turn-hint">
          Just talk. Try: &quot;I&apos;m raising a seed round and need help with...&quot;
        </p>
      ) : null}
    </section>
  );
}
