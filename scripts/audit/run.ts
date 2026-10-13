/**
 * One search run through the app's own code over the real data — what the checks and
 * the report read. Shared by `results.audit.ts` (the runner) and `checks.ts`.
 */
import { applyStateLaws, taxSchedules, type LawData } from "@/lib/laws";
import {
  prepareDataset,
  rankCounties,
  scoreCounties,
  subsetDataset,
  withTaxes,
  type CountyDataset,
  type CountyScore,
  type MetricKey,
} from "@/lib/scoring";
import {
  areaCriteria,
  areaTaxSearch,
  countiesOf,
  countyParts,
  explainArea,
  resultBadges,
  scoreNational,
  topAreas,
  type AreaCriterion,
  type AreaLimit,
  type AreaPart,
  type CountyResult,
  type NationalAreas,
  type NationalScores,
  type NationalSearch,
  type ResultBadges,
  withAreaTaxes,
} from "@/lib/tracts";
import { excludedStates, toAreaSearch, toScoringInput, type Preferences } from "@/components/finder/preferences";

export interface RunResult {
  prefs: Preferences;
  /** The counties in play (opt-in states cut), with their law values applied. */
  counties: CountyDataset;
  laws: LawData;
  countyScores: CountyScore[];
  byFips: Map<string, CountyScore>;
  /** County results when nothing is area-level (the app's county mode). */
  rankedCounties: CountyScore[];
  countyCriteria: [MetricKey, number][];
  /** Area mode (any area-level priority or must-have). */
  areaMode: boolean;
  areas: NationalAreas;
  criteria: AreaCriterion[];
  limits: AreaLimit[];
  search: NationalSearch;
  ns: NationalScores | null;
  top: number[];
  byCounty: CountyResult[];
  badges: Map<number, ResultBadges>;
  /** Helpers. */
  stateOf: (i: number) => string;
  countyName: (fips: string) => string;
  parts: (i: number) => AreaPart[];
  value: (i: number, column: string) => number;
}

export function run(prefs: Preferences, all: CountyDataset, laws: LawData, national: NationalAreas, cap = 100): RunResult {
  const excluded = excludedStates(prefs);
  const scoped = withTaxes(
    applyStateLaws(subsetDataset(all, (i) => !excluded.includes(all.state[i])), laws),
    taxSchedules(laws),
    prefs.household,
  );
  const prepared = prepareDataset(scoped);
  const countyScores = scoreCounties(prepared, toScoringInput(prefs));
  const byFips = new Map(countyScores.map((s) => [s.fips, s]));
  const rankedCounties = rankCounties(countyScores, { includeUnknown: prefs.includeUnknown });
  const own = areaCriteria(toAreaSearch(prefs));
  const areaMode = own.criteria.length > 0 || own.limits.length > 0;
  // As the app does (county-finder): each area's own taxes, scored by area, not as its
  // county's shared part.
  const areas = withAreaTaxes(national, scoped, taxSchedules(laws), prefs.household);
  const tax = areaTaxSearch(toScoringInput(prefs));
  const areaCounty = new Map(scoreCounties(prepared, tax.county).map((s) => [s.fips, s]));
  const criteria = [...own.criteria, ...tax.criteria].sort((a, b) => b.weight - a.weight);
  const limits = [...own.limits, ...tax.limits];
  const search: NationalSearch = { criteria, limits, counties: countyParts([...areaCounty.values()]) };
  const ns = areaMode ? scoreNational(areas, search) : null;
  const top = ns ? topAreas(areas, ns, cap, prefs.includeUnknown) : [];
  const byCounty = ns ? countiesOf(areas, top, ns) : [];
  const badges = ns ? resultBadges(areas, top, search) : new Map<number, ResultBadges>();
  const countyName = (fips: string) => {
    const i = scoped.indexByFips.get(fips);
    return i === undefined ? fips : `${scoped.countyName[i]}, ${scoped.state[i]}`;
  };
  const stateOf = (i: number) => scoped.state[scoped.indexByFips.get(areas.county[i]) ?? -1] ?? areas.county[i].slice(0, 2);
  const partsCache = new Map<number, AreaPart[]>();
  const parts = (i: number) => {
    let p = partsCache.get(i);
    if (!p) partsCache.set(i, (p = explainArea(areas, i, search, areaCounty.get(areas.county[i]))));
    return p;
  };
  return {
    prefs, counties: scoped, laws, countyScores, byFips, rankedCounties,
    // In area mode Taxes is an area criterion (`tax.criteria`), not a county one.
    countyCriteria: Object.entries(areaMode ? tax.county.weights : prefs.weights).filter(([, w]) => (w ?? 0) > 0) as [MetricKey, number][],
    areaMode, areas, criteria, limits, search, ns, top, byCounty, badges, stateOf, countyName, parts,
    value: (i, column) => areas.values.get(column)?.[i] ?? NaN,
  };
}
