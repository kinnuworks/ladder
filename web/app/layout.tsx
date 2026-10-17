import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { AppIcon } from "@/components/AppIcon";
import { installUrl, readConfig } from "@/lib/config";
import "./foundation.css";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.PUBLIC_URL || "https://ladder-errands.vercel.app"),
  title: { default: "Ladder", template: "%s · Ladder" },
  description:
    "Your AI can finally make the call. Ladder is a PayBox plugin: your AI calls the business, follows up, and mails a certified letter if needed, within one budget you approve. Each step is capped on Base, and what isn't spent comes back to you.",
};

export const viewport: Viewport = { themeColor: "#FFFFFF" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const cfg = readConfig();
  return (
    <html lang="en" data-accent="amber" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: "document.documentElement.classList.add('js')" }} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400..800&family=JetBrains+Mono:wght@400;500&family=Instrument+Serif:ital@0;1&display=swap"
        />
      </head>
      <body>
        <nav className="nav" aria-label="Main">
          <div className="nav__bar">
            <Link href="/" className="nav__brand">
              <AppIcon />
              Ladder
            </Link>
            <div className="nav__links">
              <Link href="/#how">How it works</Link>
              <Link href="/#try">Try it</Link>
              <Link href="/judges">For judges</Link>
              {cfg.repoUrl && <a href={cfg.repoUrl}>GitHub</a>}
            </div>
            <a className="btn btn-candy btn-sm nav__cta" href={installUrl(cfg)}>
              Add to PayBox
            </a>
          </div>
        </nav>
        {children}
        <footer className="footer">
          <div className="container">
            <span className="brand">
              <AppIcon size={22} />
              Ladder
            </span>
            <span className="links">
              <Link href="/verify">Verify an errand</Link>
              <Link href="/judges">For judges</Link>
              <a href="/api/health">Status</a>
              {cfg.repoUrl && <a href={cfg.repoUrl}>GitHub</a>}
            </span>
            <span>Made by @heykinnu</span>
          </div>
        </footer>
      </body>
    </html>
  );
}
