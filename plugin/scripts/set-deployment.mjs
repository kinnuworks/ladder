// Point the plugin at a deployment: node scripts/set-deployment.mjs <factory> <implementation> <publicUrl>
import { readFile, writeFile } from "node:fs/promises";

const [factory, implementation, publicUrl] = process.argv.slice(2);
const addr = /^0x[0-9a-fA-F]{40}$/;
if (!addr.test(factory ?? "") || !addr.test(implementation ?? "") || !/^https:\/\/[^/]+$/.test(publicUrl ?? "")) {
  console.error("usage: node scripts/set-deployment.mjs <factory> <implementation> <https://host>");
  process.exit(1);
}
const path = new URL("../src/config.ts", import.meta.url);
let src = await readFile(path, "utf8");
src = src
  .replace(/export const PUBLIC_URL = ".*";/, `export const PUBLIC_URL = "${publicUrl}";`)
  .replace(/export const FACTORY: Address = ".*";/, `export const FACTORY: Address = "${factory}";`)
  .replace(/export const IMPLEMENTATION: Address = ".*";/, `export const IMPLEMENTATION: Address = "${implementation}";`)
  .replace(/export const DEPLOYED = (true|false);/, "export const DEPLOYED = true;");
await writeFile(path, src);
console.log(src);
