import { CountyFinder } from "@/components/finder/county-finder";

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 lg:px-8">
      <header className="mb-8 space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">New Home Finder</h1>
        <p className="max-w-2xl text-sm text-neutral-500 dark:text-neutral-400">
          Every US county except Alaska, ranked by what you care about. Data: Census ACS
          2019–2023, BEA price parities 2024, Stanford SEDA schools, NOAA 1991–2020 climate
          normals.
        </p>
      </header>
      <CountyFinder />
    </main>
  );
}
