/** Ladder's app icon: three amber rungs between two rails on a rounded square. */
export function AppIcon({ size = 28, className = "app-icon" }: { size?: number; className?: string }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 64 64"
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect width="64" height="64" rx="14.4" fill="#1D1D1F" />
      <line x1="21" y1="11" x2="21" y2="53" stroke="#F2F0EB" strokeWidth="4" strokeLinecap="round" />
      <line x1="43" y1="11" x2="43" y2="53" stroke="#F2F0EB" strokeWidth="4" strokeLinecap="round" />
      <line x1="21" y1="20" x2="43" y2="20" stroke="#F7A028" strokeWidth="5" strokeLinecap="round" />
      <line x1="21" y1="32" x2="43" y2="32" stroke="#F7A028" strokeWidth="5" strokeLinecap="round" />
      <line x1="21" y1="44" x2="43" y2="44" stroke="#F7A028" strokeWidth="5" strokeLinecap="round" />
    </svg>
  );
}
