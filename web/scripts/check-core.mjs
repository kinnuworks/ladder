// web/lib/core.ts must stay byte-identical to plugin/src/core.ts: both sides have to
// compute the same errand address and signatures.
import { readFile } from "node:fs/promises";

const web = await readFile(new URL("../lib/core.ts", import.meta.url));
const plugin = await readFile(new URL("../../plugin/src/core.ts", import.meta.url));

if (!web.equals(plugin)) {
  console.error("web/lib/core.ts differs from plugin/src/core.ts. Copy plugin/src/core.ts over web/lib/core.ts.");
  process.exit(1);
}
console.log("core.ts matches plugin/src/core.ts");
