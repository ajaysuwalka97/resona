import { useEffect, useState } from "react";

import type { MatchResult } from "../types/match";
import {
  confidenceBandFromOverall,
  formatConfidence,
} from "../hooks/useResonaSession";
import { ConfidenceRing } from "./ConfidenceRing";

type MatchRevealProps = {
  matchHistory: MatchResult[];
  matchGuidance: string;
};

type MatchCardProps = {
  match: MatchResult;
  index: number;
};

function MatchRevealCard({ match, index }: MatchCardProps) {
  const candidate = match.candidate;
  const [visibleBeatCount, setVisibleBeatCount] = useState(0);

  const beats = candidate
    ? [
        { label: "Trigger", text: match.why_spine.trigger },
        { label: "Complementarity", text: match.why_spine.complementarity },
        { label: "Trust bridge", text: match.why_spine.trust_bridge },
        { label: "Frame", text: match.why_spine.frame },
      ]
    : [];

  useEffect(() => {
    setVisibleBeatCount(0);
    if (beats.length === 0) {
      return;
    }
    const timers = beats.map((_, beatIndex) =>
      window.setTimeout(() => {
        setVisibleBeatCount(beatIndex + 1);
      }, 350 + beatIndex * 480),
    );
    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [candidate?.id]);

  if (!candidate) {
    return null;
  }

  const overall = match.confidence?.overall ?? 0;
  const band = confidenceBandFromOverall(overall);

  return (
    <article
      className="match-card reveal-card"
      style={{ animationDelay: `${index * 120}ms` }}
    >
      <div className="match-card-head">
        <p className="section-kicker">Match {index + 1}</p>
        <ConfidenceRing score={overall} band={band} />
      </div>
      <h3 className="match-name">This is {candidate.name}.</h3>
      <p>
        {match.selection?.topBrings[0]?.claim ??
          "No grounded complementarity card selected."}
      </p>
      <p className="microcopy">{formatConfidence(match)}</p>
      {match.confidence?.reason ? (
        <p className="microcopy">{match.confidence.reason}</p>
      ) : null}
      <div className="chip-row">
        <span className="chip">tier {candidate.qualityTier}</span>
        <span className="chip">trust {candidate.trustEdge.band}</span>
      </div>
      <ul className="why-spine-list">
        {beats.slice(0, visibleBeatCount).map((beat, beatIndex) => (
          <li
            key={beat.label}
            className="why-spine-beat"
            style={{ animationDelay: `${beatIndex * 60}ms` }}
          >
            <span className="why-spine-label">{beat.label}</span>
            <span>{beat.text}</span>
          </li>
        ))}
      </ul>
    </article>
  );
}

export function MatchReveal({ matchHistory, matchGuidance }: MatchRevealProps) {
  return (
    <section className="match-reveal glass-panel">
      <div className="section-head">
        <h2>Your match</h2>
        <p className="subtle">Name first, then why this person clears the bar.</p>
      </div>

      {matchGuidance ? <p className="match-guidance">{matchGuidance}</p> : null}
      {matchHistory.length === 0 ? (
        <p className="subtle">
          Resona will surface someone here as soon as confidence clears the bar.
        </p>
      ) : (
        <div className="match-grid">
          {matchHistory.map((match, index) => (
            <MatchRevealCard
              key={match.candidate?.id ?? `match-${index}`}
              match={match}
              index={index}
            />
          ))}
        </div>
      )}
    </section>
  );
}
