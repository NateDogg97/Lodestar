/**
 * Plain-language takeaways for the area page's sections (owner, 2026-10-04: "visuals up
 * front, analysis on tap"), and the typical US area they compare with. Pure: no UI.
 */

/**
 * The typical US area: medians over all 84,119 areas (census tracts), computed
 * 2026-10-04 from the published area files. They move slowly; recompute when the
 * area data is rebuilt from a new Census release.
 */
export const US_TYPICAL = {
  violent_rate: 248,
  property_rate: 1324,
  median_age: 39.7,
  bachelors_share: 29.1,
  owner_share: 70.6,
  kids_share: 29.4,
  highrise_share: 2.1,
  single_family_share: 68.9,
  density_per_sq_mi: 2212,
  commute_minutes: 25.7,
  work_from_home_share: 10.6,
  zhvi_yoy: 1.6,
} as const;

/** FEMA risk percentile in words — the same cutoffs as the county page. */
export function hazardWord(p: number): string {
  return p < 20 ? "Very low" : p < 40 ? "Low" : p < 60 ? "Moderate" : p < 80 ? "High" : "Very high";
}

/** Nearby schools' national percentile. */
export function schoolsVerdict(p: number | null): string {
  if (p === null) return "No scored schools nearby";
  return p >= 75 ? "Strong schools" : p >= 60 ? "Above average" : p >= 40 ? "About average" : p >= 25 ? "Below average" : "Weak schools";
}

/** Violent crime against the typical US area. */
export function safetyVerdict(violent: number | null): string {
  if (violent === null) return "No crime data";
  const r = violent / US_TYPICAL.violent_rate;
  return r < 0.6
    ? "Much safer than a typical US area"
    : r < 0.9
      ? "Safer than a typical US area"
      : r <= 1.15
        ? "About as safe as a typical US area"
        : r <= 2
          ? "More crime than a typical US area"
          : "Much more crime than a typical US area";
}

/** "Young, mostly renters, mostly apartments" — only what stands out. */
export function peopleVerdict(v: {
  age: number | null;
  owners: number | null;
  highrise: number | null;
  singleFamily: number | null;
}): string {
  const bits = [
    v.age === null ? null : v.age < 35 ? "Young" : v.age > 45 ? "Older" : null,
    v.owners === null ? null : v.owners < 40 ? "mostly renters" : v.owners > 75 ? "mostly owners" : null,
    v.highrise !== null && v.highrise >= 40 ? "mostly apartments" : v.singleFamily !== null && v.singleFamily >= 75 ? "mostly houses" : null,
  ].filter((b): b is string => b !== null);
  if (bits.length === 0) return "A mix of ages, owners and renters";
  const s = bits.join(", ");
  return s[0].toUpperCase() + s.slice(1);
}

/** Downtown distance and commute. */
export function aroundVerdict(downtownMi: number | null, commuteMin: number | null): string {
  const d =
    downtownMi === null ? null : downtownMi <= 3 ? "Close to downtown" : downtownMi <= 12 ? `${Math.round(downtownMi)} mi to downtown` : "Far from a downtown";
  const c = commuteMin === null ? null : commuteMin <= 20 ? "short commute" : commuteMin >= 35 ? "long commute" : null;
  if (d && c) return `${d}, ${c}`;
  if (d) return d;
  return c ? c[0].toUpperCase() + c.slice(1) : "Distances below";
}

/** Home values over the last year, against the typical area. */
export function marketVerdict(yoy: number | null): string {
  if (yoy === null) return "No recent price data";
  const pct = `${Math.abs(yoy).toFixed(1)}%`;
  const typical = `typical ${US_TYPICAL.zhvi_yoy >= 0 ? "+" : "−"}${US_TYPICAL.zhvi_yoy}%`;
  return Math.abs(yoy) < 0.5 ? `Prices flat this year (${typical})` : `Prices ${yoy > 0 ? "up" : "down"} ${pct} in a year (${typical})`;
}

/** Overall risk, and the worst single hazard when it stands out. */
export function hazardsVerdict(overall: number | null, hazards: { label: string; p: number | null }[]): string {
  const worst = hazards.filter((h): h is { label: string; p: number } => h.p !== null).sort((a, b) => b.p - a.p)[0];
  if (overall === null) return worst ? `Highest: ${worst.label.toLowerCase()}` : "No hazard data";
  const word = hazardWord(overall);
  if (worst && worst.p >= 80 && overall < 60) return `${word} overall — but ${worst.label.toLowerCase()}`;
  return `${word} risk overall`;
}

/** A county's distance to the nearest 500k+ metro ("Minneapolis-St. Paul-Bloomington, MN-WI"). */
export function locationVerdict(metroMi: number | null, metro: string | null): string {
  if (metroMi === null) return "Distances below";
  const city = metro ? metro.split(/[-,]/)[0].trim() : "a big metro";
  if (metroMi <= 25) return `In or near the ${city} metro`;
  if (metroMi <= 75) return `${Math.round(metroMi)} mi to ${city}`;
  return `Far from big metros · ${Math.round(metroMi)} mi to ${city}`;
}
