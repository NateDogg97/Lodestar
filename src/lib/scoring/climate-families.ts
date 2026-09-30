import { getCategory } from "./categories";

/**
 * Plain-language climate families over the Köppen codes (decided 2026-09-30).
 * 85% of counties fall in three Köppen types and the rest are spread thin
 * over 18, named in jargon — so the Must-haves filter offers these instead.
 * The filter still stores Köppen codes (`prefs.categories.koppen`); a family
 * is just a set of codes toggled together. Examples are counties' actual
 * types in counties.json, not textbook maps (they can differ near a boundary).
 *
 * Every Köppen option belongs to exactly one family (see the test), including
 * types no county has today, so a future data refresh can't orphan a code.
 */
export interface ClimateFamily {
  id: string;
  name: string;
  description: string;
  examples: string[];
  codes: string[];
}

export const CLIMATE_FAMILIES: readonly ClimateFamily[] = [
  {
    id: "humid-south",
    name: "Humid South",
    description: "Hot, humid summers; mild winters",
    examples: ["Atlanta", "Houston", "Nashville", "Orlando", "Washington, DC"],
    codes: ["Cfa", "Cwa"],
  },
  {
    id: "four-seasons",
    name: "Four seasons",
    description: "Warm-to-hot summers, cold snowy winters",
    examples: ["Chicago", "Minneapolis", "Boston", "Pittsburgh", "Kansas City"],
    codes: ["Dfa", "Dwa"],
  },
  {
    id: "northern-cold",
    name: "Northern cold",
    description: "Mild summers, long cold winters",
    examples: ["North Dakota", "Buffalo", "Portland, ME", "Missoula"],
    codes: ["Dfb", "Dwb"],
  },
  {
    id: "dry-sunny",
    name: "Dry & sunny",
    description: "Little rain, big swings between day and night",
    examples: ["Denver", "Albuquerque", "Boise", "Reno", "San Diego"],
    codes: ["BSk", "BSh"],
  },
  {
    id: "desert",
    name: "Desert",
    description: "Very hot and very dry",
    examples: ["Phoenix", "Las Vegas", "El Paso"],
    codes: ["BWh", "BWk"],
  },
  {
    id: "west-coast",
    name: "West Coast",
    description: "Dry summers, mild rainy winters",
    examples: ["Los Angeles", "Sacramento", "San Francisco", "Seattle", "Portland, OR"],
    codes: ["Csa", "Csb", "Csc"],
  },
  {
    id: "mountain-west",
    name: "Mountain West",
    description: "Snowy winters, dry summers",
    examples: ["Salt Lake City", "Spokane", "Flagstaff"],
    codes: ["Dsa", "Dsb"],
  },
  {
    id: "tropical",
    name: "Tropical",
    description: "Warm all year",
    examples: ["Miami", "Key West", "Honolulu"],
    codes: ["Af", "Am", "Aw"],
  },
  {
    id: "highlands-alaska",
    name: "Highlands & Alaska",
    description: "Cool summers, harsh winters",
    examples: ["Colorado high country", "Anchorage", "Fairbanks"],
    codes: ["Cfb", "Cfc", "Cwb", "Cwc", "Dfc", "Dfd", "Dsc", "Dsd", "Dwc", "Dwd", "ET", "EF"],
  },
];

const BY_CODE = new Map(CLIMATE_FAMILIES.flatMap((f) => f.codes.map((c) => [c, f] as const)));

/** The family a Köppen code belongs to, or null for an unknown code. */
export function climateFamily(code: string): ClimateFamily | null {
  return BY_CODE.get(code) ?? null;
}

/** "Humid South (humid subtropical, Cfa)" — the family first, the Köppen type after. */
export function climateLabel(code: string): string {
  const family = climateFamily(code);
  const koppen = getCategory("koppen").options.find((o) => o.value === code)?.label ?? code;
  if (!family) return koppen;
  return `${family.name} (${koppen.charAt(0).toLowerCase()}${koppen.slice(1).replace(/ \((\w+)\)$/, ", $1")})`;
}

/**
 * A climate filter in words, by family: "not Desert or Tropical". Only codes
 * some county has count (`present`): the filter never stores the others. A
 * family with some of its codes allowed is "not all of" it.
 */
export function describeClimateFilter(accept: readonly string[], present: ReadonlySet<string>): string {
  const allowed = new Set(accept);
  const families = CLIMATE_FAMILIES.filter((f) => f.codes.some((c) => present.has(c)));
  const out: string[] = [];
  const partly: string[] = [];
  for (const f of families) {
    const codes = f.codes.filter((c) => present.has(c));
    const n = codes.filter((c) => allowed.has(c)).length;
    if (n === 0) out.push(f.name);
    else if (n < codes.length) partly.push(f.name);
  }
  if (out.length === families.length) return "nothing allowed";
  if (out.length === 0 && partly.length === 0) return "any";
  const or = (names: string[]) =>
    names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`;
  // Short when most are excluded: name what's left instead.
  if (out.length > families.length / 2) {
    const kept = families.filter((f) => !out.includes(f.name)).map((f) => f.name);
    return `only ${or(kept)}`;
  }
  return out.length ? `not ${or(out)}` : `not all of ${or(partly)}`;
}
