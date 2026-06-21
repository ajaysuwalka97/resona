import type { RefObject } from "react";

import type {
  ConversationTurn,
  CopyStatus,
  ResonaSessionState,
} from "../hooks/useResonaSession";

type TranscriptDrawerProps = {
  open: boolean;
  onToggle: () => void;
  turnLogRef: RefObject<HTMLDivElement | null>;
  conversationTurns: ConversationTurn[];
  sessionState: ResonaSessionState;
  hasStreamingAssistantTurn: boolean;
  transcript: string;
  transcriptForCopy: string;
  copyStatus: CopyStatus;
  onCopyTranscript: () => void;
};

export function TranscriptDrawer({
  open,
  onToggle,
  turnLogRef,
  conversationTurns,
  sessionState,
  hasStreamingAssistantTurn,
  transcript,
  transcriptForCopy,
  copyStatus,
  onCopyTranscript,
}: TranscriptDrawerProps) {
  return (
    <section className={`transcript-drawer ${open ? "open" : "closed"}`}>
      <div className="drawer-head">
        <button type="button" className="ghost-btn" onClick={onToggle}>
          {open ? "Hide transcript" : "Show transcript"}
        </button>
        <button
          type="button"
          className="ghost-btn"
          onClick={onCopyTranscript}
          disabled={!transcriptForCopy}
        >
          Copy transcript
        </button>
      </div>
      {copyStatus === "copied" ? (
        <p className="microcopy">Transcript copied.</p>
      ) : copyStatus === "failed" ? (
        <p className="microcopy">Could not access clipboard. Try again.</p>
      ) : null}

      {open ? (
        <div
          className="turn-log"
          ref={turnLogRef}
          role="log"
          aria-label="Conversation log"
        >
          {sessionState === "idle" ? (
            <p className="turn-row turn-assistant turn-live-row">
              <strong>Resona (live):</strong>{" "}
              <span className="subtle">Start a session to see live conversation.</span>
            </p>
          ) : !hasStreamingAssistantTurn ? (
            <p className="turn-row turn-assistant turn-live-row">
              <strong>Resona (live):</strong>{" "}
              <span className={transcript ? "" : "subtle"}>
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
                  <span className={isStreamingAssistantTurn ? "transcript" : undefined}>
                    {turn.text}
                  </span>
                </p>
              );
            })
          )}
        </div>
      ) : null}
    </section>
  );
}
