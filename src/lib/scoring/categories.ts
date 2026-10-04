/**
 * Category filters: values that are categories, not numbers. They are never
 * weighted — a county either has an acceptable value or is ruled out, like a
 * limit. Two kinds:
 * - `scope: "state"` — policies (LAWS.md §3): each county takes its state's
 *   value from the law table (`applyStateLaws` in src/lib/laws); `value`
 *   matches law_values.csv.
 * - `scope: "county"` — a column of counties.json (the Köppen climate type).
 *
 * `options` are in display order.
 */

export interface CategoryOption {
  value: string;
  label: string;
  /** Shorter label for a yes/no filter button. */
  short?: string;
}

export interface CategoryDef {
  key: string;
  label: string;
  scope: "state" | "county";
  /** How the filter is drawn: checkboxes (pick any) or require yes / no / don't care. */
  control: "multi" | "boolean";
  options: readonly CategoryOption[];
}

export const CATEGORIES = [
  {
    key: "marijuana_status",
    label: "Marijuana",
    scope: "state",
    control: "multi",
    options: [
      { value: "recreational", label: "Legal for adults" },
      { value: "medical", label: "Medical only" },
      { value: "cbd_only", label: "Low-THC / CBD only" },
      { value: "illegal", label: "Illegal" },
    ],
  },
  {
    key: "abortion_access",
    label: "Abortion access",
    scope: "state",
    control: "multi",
    options: [
      { value: "protected", label: "Legal to viability or later" },
      { value: "limited", label: "Limit after 12 weeks, before viability" },
      { value: "restricted", label: "Limit at or before 12 weeks" },
      { value: "banned", label: "Banned" },
    ],
  },
  {
    key: "permitless_carry",
    label: "Permitless carry",
    scope: "state",
    control: "boolean",
    options: [
      { value: "true", label: "Yes — no permit needed", short: "Permitless only" },
      { value: "false", label: "No — permit required", short: "Permit required only" },
    ],
  },
  {
    // The county's state (counties.json `state`): rule states out, or keep only some.
    // A must-have like the others — percentiles stay national, so a score means the
    // same whichever states are picked (2026-10-04).
    key: "state",
    label: "States",
    scope: "county",
    control: "multi",
    options: [
      { value: "AL", label: "Alabama" },
      { value: "AK", label: "Alaska" },
      { value: "AZ", label: "Arizona" },
      { value: "AR", label: "Arkansas" },
      { value: "CA", label: "California" },
      { value: "CO", label: "Colorado" },
      { value: "CT", label: "Connecticut" },
      { value: "DE", label: "Delaware" },
      { value: "DC", label: "District of Columbia" },
      { value: "FL", label: "Florida" },
      { value: "GA", label: "Georgia" },
      { value: "HI", label: "Hawaii" },
      { value: "ID", label: "Idaho" },
      { value: "IL", label: "Illinois" },
      { value: "IN", label: "Indiana" },
      { value: "IA", label: "Iowa" },
      { value: "KS", label: "Kansas" },
      { value: "KY", label: "Kentucky" },
      { value: "LA", label: "Louisiana" },
      { value: "ME", label: "Maine" },
      { value: "MD", label: "Maryland" },
      { value: "MA", label: "Massachusetts" },
      { value: "MI", label: "Michigan" },
      { value: "MN", label: "Minnesota" },
      { value: "MS", label: "Mississippi" },
      { value: "MO", label: "Missouri" },
      { value: "MT", label: "Montana" },
      { value: "NE", label: "Nebraska" },
      { value: "NV", label: "Nevada" },
      { value: "NH", label: "New Hampshire" },
      { value: "NJ", label: "New Jersey" },
      { value: "NM", label: "New Mexico" },
      { value: "NY", label: "New York" },
      { value: "NC", label: "North Carolina" },
      { value: "ND", label: "North Dakota" },
      { value: "OH", label: "Ohio" },
      { value: "OK", label: "Oklahoma" },
      { value: "OR", label: "Oregon" },
      { value: "PA", label: "Pennsylvania" },
      { value: "RI", label: "Rhode Island" },
      { value: "SC", label: "South Carolina" },
      { value: "SD", label: "South Dakota" },
      { value: "TN", label: "Tennessee" },
      { value: "TX", label: "Texas" },
      { value: "UT", label: "Utah" },
      { value: "VT", label: "Vermont" },
      { value: "VA", label: "Virginia" },
      { value: "WA", label: "Washington" },
      { value: "WV", label: "West Virginia" },
      { value: "WI", label: "Wisconsin" },
      { value: "WY", label: "Wyoming" },
    ],
  },
  {
    // Köppen–Geiger, computed by the ETL from the monthly normals (etl/climate.py,
    // Peel et al. 2007 rules). Names match KOPPEN_NAMES there.
    key: "koppen",
    label: "Climate type (Köppen)",
    scope: "county",
    control: "multi",
    options: [
      { value: "Af", label: "Tropical rainforest (Af)" },
      { value: "Am", label: "Tropical monsoon (Am)" },
      { value: "Aw", label: "Tropical savanna (Aw)" },
      { value: "BWh", label: "Hot desert (BWh)" },
      { value: "BWk", label: "Cold desert (BWk)" },
      { value: "BSh", label: "Hot semi-arid (BSh)" },
      { value: "BSk", label: "Cold semi-arid (BSk)" },
      { value: "Csa", label: "Hot-summer Mediterranean (Csa)" },
      { value: "Csb", label: "Warm-summer Mediterranean (Csb)" },
      { value: "Csc", label: "Cold-summer Mediterranean (Csc)" },
      { value: "Cwa", label: "Monsoon-influenced humid subtropical (Cwa)" },
      { value: "Cwb", label: "Subtropical highland (Cwb)" },
      { value: "Cwc", label: "Cold subtropical highland (Cwc)" },
      { value: "Cfa", label: "Humid subtropical (Cfa)" },
      { value: "Cfb", label: "Oceanic (Cfb)" },
      { value: "Cfc", label: "Subpolar oceanic (Cfc)" },
      { value: "Dsa", label: "Hot, dry-summer continental (Dsa)" },
      { value: "Dsb", label: "Warm, dry-summer continental (Dsb)" },
      { value: "Dsc", label: "Dry-summer subarctic (Dsc)" },
      { value: "Dsd", label: "Very cold dry-summer subarctic (Dsd)" },
      { value: "Dwa", label: "Hot, dry-winter continental (Dwa)" },
      { value: "Dwb", label: "Warm, dry-winter continental (Dwb)" },
      { value: "Dwc", label: "Dry-winter subarctic (Dwc)" },
      { value: "Dwd", label: "Very cold dry-winter subarctic (Dwd)" },
      { value: "Dfa", label: "Hot-summer humid continental (Dfa)" },
      { value: "Dfb", label: "Warm-summer humid continental (Dfb)" },
      { value: "Dfc", label: "Subarctic (Dfc)" },
      { value: "Dfd", label: "Extremely cold subarctic (Dfd)" },
      { value: "ET", label: "Tundra (ET)" },
      { value: "EF", label: "Ice cap (EF)" },
    ],
  },
] as const satisfies readonly CategoryDef[];

export type CategoryKey = (typeof CATEGORIES)[number]["key"];

export const CATEGORY_KEYS: readonly CategoryKey[] = CATEGORIES.map((c) => c.key);
/** Categories filled from the law table, by state. */
export const STATE_CATEGORY_KEYS: readonly CategoryKey[] = CATEGORIES.filter((c) => c.scope === "state").map((c) => c.key);
/** Categories read from a counties.json column. */
export const COUNTY_CATEGORY_KEYS: readonly CategoryKey[] = CATEGORIES.filter((c) => c.scope === "county").map((c) => c.key);

const BY_KEY = new Map<string, CategoryDef>(CATEGORIES.map((c) => [c.key, c]));

export function getCategory(key: CategoryKey): CategoryDef {
  const def = BY_KEY.get(key);
  if (!def) throw new Error(`Unknown category: ${key}`);
  return def;
}

export function isCategoryKey(key: string): key is CategoryKey {
  return BY_KEY.has(key);
}

/** The value's label, or the value itself if it isn't a known option. */
export function categoryLabel(key: CategoryKey, value: string): string {
  return getCategory(key).options.find((o) => o.value === value)?.label ?? value;
}
