// Copies MapLibre's web-worker files into public/maplibre/ so the app can
// serve them. MapLibre finds its worker next to its own module
// (import.meta.url), but the Next.js bundler moves that module into a chunk
// folder without the worker, so the default URL 404s. county-map.tsx calls
// setWorkerUrl("/maplibre/maplibre-gl-worker.mjs") instead. Runs before every
// dev and build (package.json predev/prebuild), so the copies always match the
// installed maplibre-gl version. Output is git-ignored.
import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const dist = dirname(require.resolve("maplibre-gl/package.json")) + "/dist";
const out = join(import.meta.dirname, "..", "public", "maplibre");
mkdirSync(out, { recursive: true });
// The worker imports "./maplibre-gl-shared.mjs", so the two must sit together.
for (const file of ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"]) {
  copyFileSync(join(dist, file), join(out, file));
}
console.log(`maplibre worker copied to ${out}`);
