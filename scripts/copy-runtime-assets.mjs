// Copies non-TS runtime assets that tsup does NOT bundle into dist/ so they sit
// next to dist/server.js (where __dirname resolves at runtime).
//
// characterDefaults.ts reads path.join(__dirname, "defaults") and "overlays" at
// server startup (warmCharacterCache). Without these, the built server crashes with
// ENOENT: no such file or directory, scandir '.../dist/defaults'.
//
// Runs automatically as the `postbuild` npm lifecycle step after `npm run build`.
import { cpSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const assets = [
  ["src/character/defaults", "dist/defaults"],
  ["src/character/overlays", "dist/overlays"],
];

for (const [from, to] of assets) {
  cpSync(join(root, from), join(root, to), { recursive: true });
  console.log(`[copy-runtime-assets] ${from} -> ${to}`);
}
