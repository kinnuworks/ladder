// The errand drawn as a ladder: two rails, one rung per committed step, cheapest at the bottom.
export interface LadderRung {
  title: string;
  detail: string;
  cap: string;
  state?: "unused" | "released" | "paid";
}

const STATE_TEXT = { unused: "not used", released: "released", paid: "paid" } as const;

export function Ladder({ rungs, title }: { rungs: LadderRung[]; title: string }) {
  const gap = 84;
  const top = 36;
  const height = top + gap * rungs.length + 24;
  const left = 24;
  const right = 120;
  const textX = 150;
  // rungs[0] is the first step, drawn at the bottom.
  const y = (i: number) => top + gap * (rungs.length - 1 - i) + gap / 2;
  return (
    <svg viewBox={`0 0 560 ${height}`} role="img" aria-label={title} xmlns="http://www.w3.org/2000/svg">
      <title>{title}</title>
      <line x1={left} y1={8} x2={left} y2={height - 4} stroke="var(--ink)" strokeWidth="3" strokeLinecap="round" />
      <line x1={right} y1={8} x2={right} y2={height - 4} stroke="var(--ink)" strokeWidth="3" strokeLinecap="round" />
      {rungs.map((r, i) => {
        const active = r.state === "paid" || r.state === "released";
        const yy = y(i);
        return (
          <g key={i}>
            <line
              x1={left}
              y1={yy}
              x2={right}
              y2={yy}
              stroke={active ? "var(--accent)" : "var(--ink)"}
              strokeWidth={active ? 7 : 4}
              strokeLinecap="round"
            />
            <text x={textX} y={yy - 8} fill="var(--ink)" fontSize="18" fontWeight="650" fontFamily="var(--sans)">
              {r.title}
            </text>
            <text x={textX} y={yy + 16} fill="var(--muted)" fontSize="14" fontFamily="var(--sans)">
              {r.detail} · cap {r.cap}
              {r.state ? ` · ${STATE_TEXT[r.state]}` : ""}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
