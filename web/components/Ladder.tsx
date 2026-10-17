// The errand drawn as a ladder: two rails and one rung per committed step, first step at the bottom.
export interface LadderRung {
  title: string;
  detail: string;
  cap: string;
  state?: "unused" | "released" | "paid";
}

const STATE_TEXT = { unused: "not used", released: "released to its step key", paid: "paid" } as const;

export function Ladder({ rungs, title }: { rungs: LadderRung[]; title: string }) {
  const gap = 78;
  const top = 30;
  const height = top + gap * rungs.length + 20;
  const left = 22;
  const right = 104;
  const textX = 132;
  const y = (i: number) => top + gap * (rungs.length - 1 - i) + gap / 2;
  return (
    <div className="ladder">
      <svg viewBox={`0 0 520 ${height}`} role="img" aria-label={title} xmlns="http://www.w3.org/2000/svg">
        <title>{title}</title>
        <line className="rail" x1={left} y1={6} x2={left} y2={height - 4} strokeWidth="3.5" strokeLinecap="round" />
        <line className="rail" x1={right} y1={6} x2={right} y2={height - 4} strokeWidth="3.5" strokeLinecap="round" />
        {rungs.map((r, i) => {
          const active = r.state === "paid" || r.state === "released";
          const yy = y(i);
          return (
            <g key={i}>
              <line className={`rung${active ? " is-active" : ""}`} x1={left} y1={yy} x2={right} y2={yy} strokeWidth={active ? 7 : 5} strokeLinecap="round" />
              <text className="label" x={textX} y={yy - 6}>
                {r.title}
              </text>
              <text className="meta" x={textX} y={yy + 16}>
                {r.detail}
                {r.state ? `, ${STATE_TEXT[r.state]}` : ""}
              </text>
              <text className="cap" x={510} y={yy - 6} textAnchor="end">
                {r.cap}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
