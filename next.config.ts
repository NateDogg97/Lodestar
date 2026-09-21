import type { NextConfig } from "next";

// The service worker is built separately by `serwist build` (see serwist.config.mjs
// and the package.json scripts) so it works with Turbopack.
const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Pin the project root; a lockfile in the parent folder otherwise confuses Next.
  outputFileTracingRoot: __dirname,
  turbopack: { root: __dirname },
  // The Python ETL under etl/ is a local tool. It is never part of the app
  // build: keep it out of server bundles/file tracing on Vercel/Cloudflare.
  // (Turbopack has no watch-ignore option in this version; it only compiles
  // what is imported, and etl/ is also excluded in tsconfig.json.)
  outputFileTracingExcludes: { "*": ["./etl/**"] },
  async headers() {
    return [
      {
        // Never cache the service worker so users always pick up new versions.
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
        ],
      },
    ];
  },
};

export default nextConfig;
