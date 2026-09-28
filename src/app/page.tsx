import { CountyFinder } from "@/components/finder/county-finder";

export default function Home() {
  return (
    <main className="flex h-dvh flex-col">
      {/* Phones use the finder's own top bar instead, to leave the map room. */}
      <header className="hidden shrink-0 md:flex items-baseline justify-between gap-4 border-b border-neutral-200 px-4 py-2 dark:border-neutral-800">
        <h1 className="text-base font-semibold tracking-tight">New Home Finder</h1>
        <p
          className="hidden truncate text-[11px] text-neutral-500 sm:block dark:text-neutral-400"
          title="Census ACS 2019–2023 · BEA price parities 2024 · Stanford SEDA schools · NOAA 1991–2020 climate normals · FEMA National Risk Index Dec 2025 · BLS unemployment 2025 · OurAirports · Natural Earth coastline · Census 2024 county boundaries · state laws: see each county's Laws & taxes tab"
        >
          US counties · Census ACS 2019–2023 · BEA 2024 · SEDA · NOAA 1991–2020 · FEMA NRI 2025 · BLS 2025
        </p>
      </header>
      <CountyFinder />
    </main>
  );
}
