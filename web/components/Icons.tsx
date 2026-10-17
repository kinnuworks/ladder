// Small inline icons drawn on a 24px grid with a 1.75 stroke and round caps.
type P = { size?: number };
const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
});

export const IconDatabaseOff = ({ size = 19 }: P) => (
  <svg {...base(size)}>
    <ellipse cx="12" cy="5" rx="8" ry="3" />
    <path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5" />
    <path d="M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" />
    <path d="M3 3l18 18" />
  </svg>
);
export const IconUndo = ({ size = 19 }: P) => (
  <svg {...base(size)}>
    <path d="M9 14L4 9l5-5" />
    <path d="M4 9h10.5a5.5 5.5 0 010 11H11" />
  </svg>
);
export const IconMapPin = ({ size = 19 }: P) => (
  <svg {...base(size)}>
    <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0116 0z" />
    <circle cx="12" cy="10" r="3" />
  </svg>
);
export const IconCode = ({ size = 19 }: P) => (
  <svg {...base(size)}>
    <path d="M16 18l6-6-6-6" />
    <path d="M8 6l-6 6 6 6" />
  </svg>
);
export const IconCheckCircle = ({ size = 19 }: P) => (
  <svg {...base(size)}>
    <circle cx="12" cy="12" r="10" />
    <path d="M8 12.5l2.5 2.5L16 9.5" />
  </svg>
);
export const IconLock = ({ size = 19 }: P) => (
  <svg {...base(size)}>
    <rect x="4" y="11" width="16" height="10" rx="2" />
    <path d="M8 11V7a4 4 0 018 0v4" />
  </svg>
);
export const IconLadder = ({ size = 14 }: P) => (
  <svg {...base(size)}>
    <path d="M8 3v18M16 3v18M8 8h8M8 13h8M8 18h8" />
  </svg>
);
export const IconShield = ({ size = 14 }: P) => (
  <svg {...base(size)}>
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
  </svg>
);
export const IconList = ({ size = 14 }: P) => (
  <svg {...base(size)}>
    <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
  </svg>
);
export const IconArrowRight = ({ size = 17 }: P) => (
  <svg {...base(size)}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
);
