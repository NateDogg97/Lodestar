// @ts-check
import { serwist } from "@serwist/next/config";

export default serwist({
  swSrc: "src/app/sw.ts",
  swDest: "public/sw.js",
  // Tract data (Phase 8) is ~85 MB nationally: never precached. A county's
  // files are cached when it's first explored (runtime rule in src/app/sw.ts).
  globIgnores: ["public/data/tracts/**/*"],
});
