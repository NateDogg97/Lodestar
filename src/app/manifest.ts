import type { MetadataRoute } from "next";

// Lodestar brand kit (brand/nextjs): neutral-950 ground; the icons keep the
// mark inside the maskable safe zone, so one file serves both purposes.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Lodestar",
    short_name: "Lodestar",
    description:
      "Compare and shortlist the places our family might move to next.",
    start_url: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0a0a0a",
    theme_color: "#0a0a0a",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
