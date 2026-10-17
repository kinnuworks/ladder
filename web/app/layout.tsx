import type { Metadata, Viewport } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Ladder", template: "%s · Ladder" },
  description:
    "One approval funds an errand account on Base that can pay only the steps you agreed to, each once and up to its cap. Whatever is left goes back to you.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fbfbf8" },
    { media: "(prefers-color-scheme: dark)", color: "#111110" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="site">
          <div className="wrap wide">
            <Link href="/" className="brand">
              Ladder
            </Link>
            <nav>
              <Link href="/verify">Verify an errand</Link>
              <Link href="/judges">For judges</Link>
            </nav>
          </div>
        </header>
        {children}
        <footer className="site">
          <div className="wrap wide">
            Ladder runs on Base mainnet. Every figure on these pages is read from the chain when the page loads; nothing is
            stored by this site.
          </div>
        </footer>
      </body>
    </html>
  );
}
