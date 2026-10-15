import { phaseLabel } from "../state.ts";
import type { Turn } from "../types.ts";

export function Waiting({ turn }: { turn?: Turn }) {
  const animate = turn?.phase === "thinking" || turn?.phase === "responding";

  return (
    <div className="run-status" role="status" aria-live="polite" aria-atomic="true">
      {turn && (
        <>
          <span className={`waiting-text ${animate ? "is-animated" : ""}`}>
            <span aria-hidden="true">✳ </span>
            {phaseLabel(turn.phase)}
          </span>
          {turn.notice && <span className="run-notice">{turn.notice}</span>}
        </>
      )}
    </div>
  );
}
