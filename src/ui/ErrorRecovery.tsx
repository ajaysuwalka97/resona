type ErrorRecoveryProps = {
  message: string;
  onRetry?: () => void;
  onDismiss?: () => void;
};

function classifyError(message: string): "backend" | "unsupported" | "mic" | "generic" {
  const normalized = message.toLowerCase();
  if (normalized.includes("could not reach backend")) {
    return "backend";
  }
  if (
    normalized.includes("not supported") ||
    normalized.includes("webrtc") ||
    normalized.includes("getusermedia")
  ) {
    return "unsupported";
  }
  if (
    normalized.includes("notallowederror") ||
    normalized.includes("permission") ||
    normalized.includes("microphone")
  ) {
    return "mic";
  }
  return "generic";
}

export function ErrorRecovery({ message, onRetry, onDismiss }: ErrorRecoveryProps) {
  const kind = classifyError(message);
  const guidance = (() => {
    if (kind === "backend") {
      return "The demo backend might still be waking up. Retry in a few seconds.";
    }
    if (kind === "unsupported") {
      return "This demo needs WebRTC + microphone APIs. Chrome or Edge is recommended.";
    }
    if (kind === "mic") {
      return "Enable microphone access from your browser's site permissions and retry.";
    }
    return "You can retry safely. If this persists, refresh and run the flow again.";
  })();

  return (
    <section className="error-recovery glass-panel" role="alert">
      <p className="section-kicker">Recovery</p>
      <h2>
        {kind === "backend"
          ? "The demo is warming up"
          : kind === "unsupported"
            ? "Browser support needed"
            : kind === "mic"
              ? "Microphone access needed"
              : "Something interrupted the flow"}
      </h2>
      <p>{guidance}</p>
      <p className="microcopy">{message}</p>
      <div className="error-actions">
        {onRetry ? (
          <button type="button" className="primary-btn" onClick={onRetry}>
            Retry
          </button>
        ) : null}
        {onDismiss ? (
          <button type="button" className="ghost-btn" onClick={onDismiss}>
            Dismiss
          </button>
        ) : null}
      </div>
    </section>
  );
}
