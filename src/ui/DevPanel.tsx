import type { MatchMode } from "../tools/findMatch";
import type { StyleMemory } from "../realtime/conversationHeuristics";

type DevPanelProps = {
  open: boolean;
  onToggle: () => void;
  matchMode: MatchMode;
  stage?: string;
  tier2Counts: {
    total: number;
    enriched: number;
    tagOnly: number;
    tier2Eligible: number;
    rawSeedRows: number;
    rejectedForSchema: number;
  };
  realtimePreflight: string;
  onRunPreflight: () => void;
  transcriptForCopy: string;
  styleMemory: StyleMemory;
};

export function DevPanel({
  open,
  onToggle,
  matchMode,
  tier2Counts,
  realtimePreflight,
  onRunPreflight,
  transcriptForCopy,
  styleMemory,
  stage,
}: DevPanelProps) {
  return (
    <section className={`dev-panel glass-panel ${open ? "open" : "closed"}`}>
      <div className="dev-head">
        <h2>Developer panel</h2>
        <button type="button" className="ghost-btn" onClick={onToggle}>
          {open ? "Hide" : "Show"}
        </button>
      </div>
      {open ? (
        <div className="dev-grid">
          <p>
            Mode: <strong>{matchMode}</strong>
          </p>
          {stage ? (
            <p>
              Stage: <strong>{stage}</strong>
            </p>
          ) : null}
          <p>
            Tier-2 gate:{" "}
            <strong>
              {tier2Counts.tier2Eligible}/{tier2Counts.total}
            </strong>
          </p>
          <p>Realtime preflight: {realtimePreflight}</p>
          <button type="button" className="ghost-btn" onClick={onRunPreflight}>
            Re-run preflight
          </button>
          <p className="microcopy">
            Style memory: concise={String(styleMemory.concise)} direct=
            {String(styleMemory.direct)} avoidProfileRecap=
            {String(styleMemory.avoidProfileRecap)}
          </p>
          <details>
            <summary>Transcript raw</summary>
            <pre>{transcriptForCopy || "No transcript captured yet."}</pre>
          </details>
        </div>
      ) : null}
    </section>
  );
}
