# Lodestar brand assets (Next.js App Router)

Copy `app/*` into your `app/` directory and `public/*` into `public/`. Next.js picks up `favicon.ico`, `icon.svg`, `apple-icon.png` and `opengraph-image.png` automatically.

- `app/favicon.ico`: 16/32/48, light mark on transparent
- `app/icon.svg`: switches to the dark palette under `prefers-color-scheme: dark`
- `app/apple-icon.png`: 180×180, neutral-950 ground
- `app/opengraph-image.png`: 1200×630
- `public/icon-192.png`, `public/icon-512.png`: PWA manifest icons

## Colors
- Ink: #171717 (light) / #ededed (dark)
- North point: emerald-600 #009966 (light) / emerald-400 #00d492 (dark)
- App icon and theme color: neutral-950 #0a0a0a (replaces slate-900 #0f172a)

```ts
// app/layout.tsx
export const viewport = { themeColor: '#0a0a0a' };
```

```json
// public/manifest.json (excerpt)
"background_color": "#0a0a0a", "theme_color": "#0a0a0a",
"icons": [
  { "src": "/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any maskable" },
  { "src": "/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any maskable" }
]
```

## Wordmark
The lockup SVGs set "Lodestar" as live text in Source Serif 4 Semibold. In the app, render the mark SVG next to the word set in Source Serif 4 via `next/font/google` (weight 600, letter-spacing -0.025em). For use outside the web, outline the text in a vector editor first.
