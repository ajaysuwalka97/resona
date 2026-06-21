import type { CSSProperties } from "react";

import type { ConfidenceBand } from "../hooks/useResonaSession";

type ConfidenceRingProps = {
  score: number;
  band: ConfidenceBand;
};

export function ConfidenceRing({ score, band }: ConfidenceRingProps) {
  const percent = Math.max(0, Math.min(100, Math.round(score * 100)));
  const style = {
    "--confidence": `${percent}%`,
  } as CSSProperties;

  return (
    <div className={`confidence-ring confidence-${band}`} style={style}>
      <span>{percent}%</span>
    </div>
  );
}
