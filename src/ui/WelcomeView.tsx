type WelcomeViewProps = {
  onContinue: () => void;
};

export function WelcomeView({ onContinue }: WelcomeViewProps) {
  return (
    <section className="welcome-view glass-panel">
      <h1>A warm-intro matchmaker you can talk to.</h1>
      <p className="lead-copy">
        Tell Resona what you are trying to unlock right now, and it will surface one
        trusted person from Ajay&apos;s network with a ready intro note.
      </p>

      <ol className="how-it-works">
        <li>
          <span>1</span>
          <p>Share your live situation and blocker in your own words.</p>
        </li>
        <li>
          <span>2</span>
          <p>Resona scans the trusted network for non-obvious complementarity.</p>
        </li>
        <li>
          <span>3</span>
          <p>Get a match reveal and a send-ready 3-line intro draft.</p>
        </li>
      </ol>

      <div className="welcome-actions">
        <button type="button" className="primary-btn" onClick={onContinue}>
          Start the demo
        </button>
        <p className="microcopy">Voice-first flow. You will be asked for microphone access.</p>
      </div>
    </section>
  );
}
