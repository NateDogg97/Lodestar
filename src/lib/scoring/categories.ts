/**
 * Policy filters (LAWS.md §3): laws whose values are categories, not
 * numbers. They are never weighted — a county either has an acceptable
 * value or is ruled out, like a limit. Each county takes its state's value
 * from the law table (see `applyStateLaws` in src/lib/laws).
 *
 * `options` are in display order; `value` matches law_values.csv.
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
  /** How the filter is drawn: checkboxes (pick any) or require yes / no / don't care. */
  control: "multi" | "boolean";
  options: readonly CategoryOption[];
}

export const CATEGORIES = [
  {
    key: "marijuana_status",
    label: "Marijuana",
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
    control: "boolean",
    options: [
      { value: "true", label: "Yes — no permit needed", short: "Permitless only" },
      { value: "false", label: "No — permit required", short: "Permit required only" },
    ],
  },
] as const satisfies readonly CategoryDef[];

export type CategoryKey = (typeof CATEGORIES)[number]["key"];

export const CATEGORY_KEYS: readonly CategoryKey[] = CATEGORIES.map((c) => c.key);

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
