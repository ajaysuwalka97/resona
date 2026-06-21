import type {
  ConversationTurn,
  ResonaSessionState,
} from "../hooks/useResonaSession";

type LiveCaptionProps = {
  sessionState: ResonaSessionState;
  conversationTurns: ConversationTurn[];
  hasStreamingAssistantTurn: boolean;
  transcript: string;
};

export function LiveCaption({
  sessionState,
  conversationTurns,
  hasStreamingAssistantTurn,
  transcript,
}: LiveCaptionProps) {
  const completedTurns = conversationTurns.filter(
    (turn) => turn.status !== "in_progress" && turn.text.trim().length > 0,
  );
  const lastTurn = completedTurns[completedTurns.length - 1];

  const caption = (() => {
    if (sessionState === "idle") {
      return {
        text: "Start a voice session to begin the conversation.",
        role: "system",
      };
    }
    if (hasStreamingAssistantTurn) {
      return {
        text: transcript.trim() || "Resona is speaking...",
        role: "assistant",
      };
    }
    if (transcript.trim()) {
      return {
        text: transcript.trim(),
        role: "assistant",
      };
    }
    if (lastTurn) {
      return {
        text: lastTurn.text,
        role: lastTurn.role,
      };
    }
    return {
      text: "Listening for the first turn...",
      role: "system",
    };
  })();

  return (
    <section className="live-caption" aria-live="polite">
      <p className="caption-label">
        {caption.role === "assistant"
          ? "Resona"
          : caption.role === "user"
            ? "You"
            : "Live"}
      </p>
      <p className="caption-text">{caption.text}</p>
    </section>
  );
}
