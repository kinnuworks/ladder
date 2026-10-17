/** Ladder's app icon: an amber glass ladder on a dark rounded square. */
export function AppIcon({ size = 28, className = "app-icon" }: { size?: number; className?: string }) {
  const src = size > 64 ? "/brand/ladder-icon-512.png" : "/brand/ladder-icon-192.png";
  // eslint-disable-next-line @next/next/no-img-element
  return <img className={className} src={src} width={size} height={size} alt="" aria-hidden="true" style={{ borderRadius: "22.5%" }} />;
}
