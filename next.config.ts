import type { NextConfig } from "next";

// The service worker is built separately by `serwist build` (see serwist.config.mjs
// and the package.json scripts) so it works with Turbopack.
// The app is a fully static export (`out/`), served by a Cloudflare Worker with static
// assets (wrangler.jsonc). `headers()` is unsupported with export, so response headers
// live in public/_headers.
const nextConfig: NextConfig = {
  output: "export",
  reactStrictMode: true,
  // Pin the project root; a lockfile in the parent folder otherwise confuses Next.
  outputFileTracingRoot: __dirname,
  turbopack: { root: __dirname },
  // The Python ETL under etl/ is a local tool. It is never part of the app
  // build: keep it out of file tracing.
  // (Turbopack has no watch-ignore option in this version; it only compiles
  // what is imported, and etl/ is also excluded in tsconfig.json.)
  outputFileTracingExcludes: { "*": ["./etl/**"] },
};

export default nextConfig;
