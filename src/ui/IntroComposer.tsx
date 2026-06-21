import { useEffect, useRef, useState } from "react";

import type { MatchResult } from "../types/match";

type IntroComposerProps = {
  matchHistory: MatchResult[];
  selectedIntroCandidateId: string;
  onSelectCandidate: (candidateId: string) => void;
  onDraftIntro: () => void;
  introDraft: string;
  onIntroDraftChange: (draft: string) => void;
};

type TonePreset = "warmer" | "shorter" | "direct";

function applyTonePreset(draft: string, preset: TonePreset): string {
  const lines = draft.split("\n").filter((line) => line.trim());
  if (lines.length === 0) {
    return draft;
  }
  if (preset === "shorter") {
    return lines.slice(0, 2).join("\n");
  }
  if (preset === "direct") {
    return lines
      .map((line) =>
        line
          .replace(/\bif helpful,\s*/i, "")
          .replace(/\bcould you introduce\b/i, "please intro")
          .replace(/\breally appreciate it\.?\s*/i, ""),
      )
      .join("\n");
  }
  return lines
    .map((line, index) =>
      index === 0 && !/appreciate|thank/i.test(line)
        ? `${line.trim()} Really appreciate the intro.`
        : line,
    )
    .join("\n");
}

export function IntroComposer({
  matchHistory,
  selectedIntroCandidateId,
  onSelectCandidate,
  onDraftIntro,
  introDraft,
  onIntroDraftChange,
}: IntroComposerProps) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const [editing, setEditing] = useState(false);
  const copyStateTimerRef = useRef<number | null>(null);

  function queueCopyStateReset() {
    if (copyStateTimerRef.current !== null) {
      window.clearTimeout(copyStateTimerRef.current);
    }
    copyStateTimerRef.current = window.setTimeout(() => {
      setCopyState("idle");
      copyStateTimerRef.current = null;
    }, 1800);
  }

  async function copyIntroDraft() {
    if (!introDraft.trim()) {
      return;
    }
    try {
      await navigator.clipboard.writeText(introDraft);
      setCopyState("copied");
      queueCopyStateReset();
    } catch {
      setCopyState("failed");
      queueCopyStateReset();
    }
  }

  function applyPreset(preset: TonePreset) {
    if (!introDraft.trim()) {
      return;
    }
    onIntroDraftChange(applyTonePreset(introDraft, preset));
    setEditing(true);
  }

  useEffect(() => {
    return () => {
      if (copyStateTimerRef.current !== null) {
        window.clearTimeout(copyStateTimerRef.current);
      }
    };
  }, []);

  return (
    <section className="intro-composer glass-panel">
      <div className="section-head">
        <h2>Send-ready intro</h2>
        <p className="subtle">Copy this note or tweak the tone before you send.</p>
      </div>

      {matchHistory.length < 1 ? (
        <p className="subtle">
          Resona will draft a 3-line intro as soon as one strong match is surfaced.
        </p>
      ) : (
        <>
          <p>
            {matchHistory.length >= 2
              ? "Two strong matches surfaced. Choose the priority and draft the intro note."
              : "One strong match is ready. Draft now, or ask for one more with a new constraint."}
          </p>
          <div className="intro-actions">
            {matchHistory.length >= 2 ? (
              <select
                aria-label="Choose priority intro candidate"
                value={selectedIntroCandidateId}
                onChange={(event) => onSelectCandidate(event.target.value)}
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
            ) : null}
            <button type="button" className="primary-btn" onClick={onDraftIntro}>
              Draft intro
            </button>
          </div>
        </>
      )}

      {introDraft ? (
        <article className="intro-artifact">
          {editing ? (
            <textarea
              className="intro-editor"
              value={introDraft}
              onChange={(event) => onIntroDraftChange(event.target.value)}
              rows={5}
              aria-label="Edit intro draft"
            />
          ) : (
            <pre>{introDraft}</pre>
          )}
          <div className="intro-actions">
            <button
              type="button"
              className="ghost-btn"
              onClick={() => setEditing((prev) => !prev)}
            >
              {editing ? "Preview" : "Edit tone"}
            </button>
            <button type="button" className="ghost-btn" onClick={() => applyPreset("warmer")}>
              Warmer
            </button>
            <button type="button" className="ghost-btn" onClick={() => applyPreset("shorter")}>
              Shorter
            </button>
            <button type="button" className="ghost-btn" onClick={() => applyPreset("direct")}>
              More direct
            </button>
            <button
              type="button"
              className="ghost-btn"
              onClick={() => {
                void copyIntroDraft();
              }}
            >
              Copy intro
            </button>
            {copyState === "copied" ? (
              <span className="microcopy">Copied.</span>
            ) : copyState === "failed" ? (
              <span className="microcopy">Clipboard unavailable.</span>
            ) : null}
          </div>
        </article>
      ) : null}
    </section>
  );
}
