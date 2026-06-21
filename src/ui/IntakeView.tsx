import type { LinkedInSnapshot, ResonaSessionState } from "../hooks/useResonaSession";

type IntakeViewProps = {
  linkedinUrl: string;
  onLinkedinUrlChange: (value: string) => void;
  onLoadProfile: () => void;
  onUseSampleFounder: () => void;
  profileLoading: boolean;
  isLinkedinUrlValid: boolean;
  profileBeatMessage: string;
  profileContextQuality: "high" | "partial" | null;
  profileSnapshot: LinkedInSnapshot | null;
  realtimePreflight: string;
  realtimeReady: boolean;
  onStartSession: () => void;
  canStartSession: boolean;
  sessionState: ResonaSessionState;
};

export function IntakeView({
  linkedinUrl,
  onLinkedinUrlChange,
  onLoadProfile,
  onUseSampleFounder,
  profileLoading,
  isLinkedinUrlValid,
  profileBeatMessage,
  profileContextQuality,
  profileSnapshot,
  realtimePreflight,
  realtimeReady,
  onStartSession,
  canStartSession,
  sessionState,
}: IntakeViewProps) {
  return (
    <section className="intake-view glass-panel">
      <div className="intake-header">
        <div>
          <h2>Who are we helping?</h2>
          <p className="subtle">Load a founder profile to personalize the conversation.</p>
        </div>
        <span
          className={`ready-dot ${realtimeReady ? "ready" : "warming"}`}
          title={realtimePreflight}
          aria-label={realtimeReady ? "Realtime ready" : "Realtime warming up"}
        />
      </div>

      <p className="intake-status">{profileBeatMessage}</p>

      <label className="input-label" htmlFor="linkedin-url">
        Founder LinkedIn URL
      </label>
      <input
        id="linkedin-url"
        type="url"
        value={linkedinUrl}
        onChange={(event) => onLinkedinUrlChange(event.target.value)}
        placeholder="https://www.linkedin.com/in/..."
      />

      <div className="intake-actions">
        <button
          type="button"
          className="primary-btn"
          onClick={onLoadProfile}
          disabled={profileLoading || !isLinkedinUrlValid}
        >
          {profileLoading ? "Loading profile..." : "Load profile"}
        </button>
        <button
          type="button"
          className="ghost-btn"
          onClick={onUseSampleFounder}
          disabled={profileLoading}
        >
          Try with a sample founder
        </button>
      </div>

      {profileSnapshot ? (
        <article className="identity-card">
          <p className="section-kicker">Identity snapshot</p>
          <h3>
            {profileSnapshot.name} <span>{profileSnapshot.company}</span>
          </h3>
          <p>{profileSnapshot.summary}</p>
          {profileContextQuality === "partial" ? (
            <p className="calibration-note">
              I&apos;ll calibrate the rest as we talk — no need to repeat your profile.
            </p>
          ) : null}
          <p className="microcopy">
            Source: {profileSnapshot.source} · fetched{" "}
            {new Date(profileSnapshot.fetched_at).toLocaleString()}
          </p>
        </article>
      ) : null}

      {profileSnapshot ? (
        <div className="session-gate">
          <button
            type="button"
            className="primary-btn"
            onClick={onStartSession}
            disabled={!canStartSession}
          >
            {sessionState === "connecting" ? "Connecting..." : "Continue to voice room"}
          </button>
        </div>
      ) : null}
    </section>
  );
}
