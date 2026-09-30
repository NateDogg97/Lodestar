"use client";

import type { ReactNode } from "react";

import { formatDay, lawSource, type LawData } from "@/lib/laws";

/**
 * Where every number comes from — the Settings screen's "About the data" and
 * the Laws & taxes tab's Sources list. County data is built by the ETL
 * (`etl/sources/`); law sources are read from laws.json, so they stay current
 * with each monthly refresh.
 */
const COUNTY_SOURCES: { name: string; url: string; vintage: string; covers: string }[] = [
  {
    name: "Census American Community Survey (5-year)",
    url: "https://www.census.gov/programs-surveys/acs",
    vintage: "2019–2023",
    covers: "Population, income, home values, rent, property tax",
  },
  {
    name: "BEA Regional Price Parities",
    url: "https://www.bea.gov/data/prices-inflation/regional-price-parities-state-and-metro-area",
    vintage: "2024",
    covers: "Cost of living (100 = US average). Published for metros and states; a county outside a metro takes its statewide value",
  },
  {
    name: "Stanford Education Data Archive (SEDA)",
    url: "https://edopportunity.org",
    vintage: "version 6.0",
    covers: "School achievement: test scores, grades 3–8, in grade levels vs. the US average",
  },
  {
    name: "NOAA U.S. Climate Normals",
    url: "https://www.ncei.noaa.gov/products/land-based-station/us-climate-normals",
    vintage: "1991–2020",
    covers: "Temperatures, rain and snow, from the stations nearest where people live",
  },
  {
    name: "FEMA National Risk Index",
    url: "https://hazards.fema.gov/nri/",
    vintage: "Dec 2025",
    covers: "Natural hazards: national percentile of expected yearly losses, as a share of what’s there",
  },
  {
    name: "BLS Local Area Unemployment Statistics",
    url: "https://www.bls.gov/lau/",
    vintage: "2025 average",
    covers: "Unemployment rate",
  },
  {
    name: "OurAirports",
    url: "https://ourairports.com/data/",
    vintage: "current",
    covers: "Distance to the nearest large airport",
  },
  {
    name: "Natural Earth coastline (1:10m)",
    url: "https://www.naturalearthdata.com/",
    vintage: "current",
    covers: "Distance to the coast, including tidal bays and estuaries",
  },
  {
    name: "OMB metro areas + Census populations",
    url: "https://www.census.gov/programs-surveys/metro-micro.html",
    vintage: "2023 delineation",
    covers: "Distance to the center of the nearest metro of 500,000+",
  },
  {
    name: "Census cartographic boundaries",
    url: "https://www.census.gov/geographies/mapping-files/time-series/geo/cartographic-boundary.html",
    vintage: "2024",
    covers: "County and state shapes",
  },
  {
    name: "OpenFreeMap / OpenStreetMap",
    url: "https://openfreemap.org",
    vintage: "live",
    covers: "Background map",
  },
];

function SourceItem({ name, url, children }: { name: string; url: string; children: ReactNode }) {
  return (
    <li className="py-3">
      <a href={url} target="_blank" rel="noopener noreferrer" className="text-label font-medium underline decoration-neutral-300 underline-offset-2 hover:decoration-current dark:decoration-neutral-600">
        {name}
      </a>
      <p className="mt-0.5 text-caption text-neutral-500 dark:text-neutral-400">{children}</p>
    </li>
  );
}

export function CountySourcesList() {
  return (
    <ul className="divide-y divide-neutral-200 dark:divide-neutral-800">
      {COUNTY_SOURCES.map((s) => (
        <SourceItem key={s.name} name={s.name} url={s.url}>
          {s.covers} · {s.vintage}
        </SourceItem>
      ))}
    </ul>
  );
}

function LawSourceItem({ label, name, url, children }: { label: string; name: string; url: string; children: ReactNode }) {
  return (
    <li className="flex items-baseline justify-between gap-4 py-3">
      <span className="text-label font-medium">{label}</span>
      <span className="text-right text-caption text-neutral-500 dark:text-neutral-400">
        <a href={url} target="_blank" rel="noopener noreferrer" className="text-label text-neutral-800 underline decoration-neutral-300 underline-offset-2 hover:decoration-current dark:text-neutral-200 dark:decoration-neutral-600">
          {name}
        </a>
        <br />
        {children}
      </span>
    </li>
  );
}

/**
 * One row per law: the source most states' values come from, its date, and
 * the last check. A state whose value came from elsewhere names its own
 * source in that value's "i".
 */
export function LawSourcesList({ laws }: { laws: LawData }) {
  return (
    <>
      <ul className="divide-y divide-neutral-200 dark:divide-neutral-800">
        {Object.entries(laws.countySources).map(([key, s]) => (
          <LawSourceItem key={key} label={s.name} name={s.sourceName} url={s.sourceUrl}>
            as of {formatDay(s.sourceDate)}
          </LawSourceItem>
        ))}
        {laws.laws.map((def) => {
          const s = lawSource(laws, def.key);
          if (!s) return null;
          return (
            <LawSourceItem key={def.key} label={def.name} name={s.sourceName} url={s.sourceUrl}>
              as of {formatDay(s.sourceDate)} · checked {formatDay(s.checked)}
            </LawSourceItem>
          );
        })}
      </ul>
      <p className="mt-3 text-caption text-neutral-500 dark:text-neutral-400">{laws.disclaimer}</p>
    </>
  );
}
