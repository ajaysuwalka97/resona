type MicPrimerProps = {
  onContinue: () => void;
  onBack: () => void;
  connecting: boolean;
  blockedMessage?: string;
};

export function MicPrimer({
  onContinue,
  onBack,
  connecting,
  blockedMessage,
}: MicPrimerProps) {
  const hasBlockedState = Boolean(blockedMessage);

  return (
    <section className="mic-primer glass-panel">
      <h2>{hasBlockedState ? "Microphone is blocked" : "Allow microphone access"}</h2>
      {hasBlockedState ? (
        <p className="lead-copy">{blockedMessage}</p>
      ) : (
        <p className="lead-copy">
          Resona is a voice-first flow. After you continue, your browser will ask for
          microphone permission so the conversation can begin.
        </p>
      )}

      <ul className="mic-steps">
        <li>Use the browser permission prompt to allow microphone access.</li>
        <li>If blocked earlier, click the lock icon in the address bar and enable mic.</li>
        <li>Then retry to enter the voice room.</li>
      </ul>

      <div className="mic-actions">
        <button type="button" className="primary-btn" onClick={onContinue} disabled={connecting}>
          {connecting ? "Connecting..." : hasBlockedState ? "Retry connection" : "Allow and continue"}
        </button>
        <button type="button" className="ghost-btn" onClick={onBack} disabled={connecting}>
          Back
        </button>
      </div>
    </section>
  );
}
