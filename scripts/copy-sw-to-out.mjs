// `serwist build` writes public/sw.js after `next build` has already copied public/ into
// out/ (static export), so copy the fresh service worker into out/ here.
import { copyFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
for (const f of ["sw.js", "sw.js.map"]) {
  const src = join(root, "public", f);
  if (existsSync(src)) copyFileSync(src, join(root, "out", f));
}
console.log("service worker copied to out/");
