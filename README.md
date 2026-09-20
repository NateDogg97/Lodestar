# New Home Finder

A progressive web app to help our family compare and shortlist the places we
might move to next. Installable to a phone or desktop home screen and works
offline for previously visited pages.

## Stack

- [Next.js 16](https://nextjs.org) (App Router, Turbopack), React 19, TypeScript
- Tailwind CSS 4
- [Serwist](https://serwist.pages.dev) for the service worker (precaching + runtime caching + offline fallback)

## Getting started

```bash
npm install
npm run dev      # Next dev server + service-worker watcher
npm run build    # Production build, then builds public/sw.js
npm run start    # Serve the production build
npm run lint
npm run typecheck
```

The service worker is disabled during `next dev` to avoid stale caches; use
`npm run build && npm run start` to test install/offline behaviour.

## PWA pieces

| File | Purpose |
| --- | --- |
| `src/app/manifest.ts` | Web app manifest (name, icons, colours, standalone display) |
| `src/app/layout.tsx` | `metadata` / `viewport` exports for theme colour + iOS install support |
| `src/app/sw.ts` | Service worker source (Serwist) |
| `serwist.config.mjs` | Serwist CLI config; `serwist build` runs after `next build` |
| `src/components/pwa-provider.tsx` | Registers `/sw.js` on the client |
| `src/app/~offline/page.tsx` | Fallback page shown for uncached navigations while offline |
| `public/icons/` | App icons (SVG sources + generated PNGs) |
| `next.config.ts` | `no-cache` headers for `/sw.js` |

`public/sw.js` is generated and git-ignored.

### Regenerating icons

The PNGs are rendered from `public/icons/icon.svg` and `icon-maskable.svg`.
On macOS:

```bash
cd public/icons
qlmanage -t -s 512 -o . icon.svg && mv icon.svg.png icon-512.png
qlmanage -t -s 192 -o . icon.svg && mv icon.svg.png icon-192.png
qlmanage -t -s 180 -o . icon.svg && mv icon.svg.png apple-touch-icon.png
qlmanage -t -s 512 -o . icon-maskable.svg && mv icon-maskable.svg.png icon-512-maskable.png
```
