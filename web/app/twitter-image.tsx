import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const runtime = "nodejs";
export const alt = "Ladder: get a real errand done with one approval.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function TwitterImage() {
  const dir = join(process.cwd(), "public", "brand");
  const [bg, icon] = await Promise.all([readFile(join(dir, "share-bg.png")), readFile(join(dir, "ladder-icon-512.png"))]);
  const data = (b: Buffer) => `data:image/png;base64,${b.toString("base64")}`;
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", position: "relative", fontFamily: "sans-serif" }}>
        <img src={data(bg)} width={1200} height={630} style={{ position: "absolute", inset: 0, objectFit: "cover" }} alt="" />
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", padding: "0 88px", gap: 28 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 22 }}>
            <img src={data(icon)} width={96} height={96} style={{ borderRadius: 22 }} alt="" />
            <div style={{ fontSize: 44, fontWeight: 700, color: "#1D1D1F", letterSpacing: -1 }}>Ladder</div>
          </div>
          <div style={{ fontSize: 76, fontWeight: 700, color: "#1D1D1F", letterSpacing: -3, lineHeight: 1.02, maxWidth: 900 }}>
            Get a real errand done with one approval.
          </div>
          <div style={{ fontSize: 30, color: "#515154", maxWidth: 860, lineHeight: 1.35 }}>
            An AI call, a follow-up, then a certified letter. Caps enforced on Base. What isn&apos;t spent comes back to you.
          </div>
        </div>
      </div>
    ),
    size,
  );
}
