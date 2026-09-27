/**
 * State laws and taxes (LAWS.md), as published by `etl/laws/publish.py` in
 * `public/data/laws.json`. Pure: parsing, labels and staleness only — no UI.
 *
 * Every value carries who said it (`sourceName`, `sourceUrl`), the source's
 * own date (`sourceDate`) and when we last checked it against the source
 * (`checked`). The app must show all three wherever it shows a value.
 */

import { CATEGORY_KEYS, STATE_METRIC_KEYS, type CountyDataset } from "@/lib/scoring";

export const LAWS_FORMAT = "laws-v1";

export type LawType = "numeric" | "ordinal" | "boolean" | "nominal";

export interface LawDef {
  key: string;
  name: string;
  category: string;
  usage: "filter" | "info" | "both";
  type: LawType;
  unit: string;
  allowed: string[];
  order: string[];
  cadence: string;
  rubric: string;
}

export interface LawFact {
  v: string;
  n?: number;
  status: string;
  confidence: string;
  checked: string;
  sourceName: string;
  sourceUrl: string;
  sourceDate: string;
  notes?: string;
  quote?: string;
}

/** No value for this state, deliberately — e.g. two sources disagreed. */
export interface LawGap {
  v: null;
  checked: string;
  notes: string;
}

export interface CountySource {
  name: string;
  sourceName: string;
  sourceUrl: string;
  sourceDate: string;
  method: string;
}

export interface LawData {
  generated: string;
  disclaimer: string;
  laws: LawDef[];
  countySources: Record<string, CountySource>;
  states: Record<string, Record<string, LawFact | LawGap>>;
}

export function parseLawPayload(payload: unknown): LawData {
  const p = payload as Partial<LawData> & { format?: unknown };
  if (!p || typeof p !== "object" || p.format !== LAWS_FORMAT) {
    throw new Error(`Law data is not in the "${LAWS_FORMAT}" format. Rebuild it with \`python -m etl.laws.publish\`.`);
  }
  if (!Array.isArray(p.laws) || typeof p.states !== "object" || p.states === null) {
    throw new Error("Law data is missing its laws or states");
  }
  return {
    generated: String(p.generated ?? ""),
    disclaimer: String(p.disclaimer ?? ""),
    laws: p.laws,
    countySources: p.countySources ?? {},
    states: p.states,
  };
}

export function isGap(f: LawFact | LawGap): f is LawGap {
  return f.v === null;
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

const LABELS: Record<string, Record<string, string>> = {
  income_tax_structure: { none: "No wage income tax", flat: "Flat rate", graduated: "Graduated brackets" },
  grocery_tax_exempt: { exempt: "Exempt", reduced: "Reduced rate", taxed: "Taxed at the full rate" },
  marijuana_status: {
    recreational: "Legal for adults",
    medical: "Medical only",
    cbd_only: "Low-THC / CBD only",
    illegal: "Illegal",
  },
  abortion_access: {
    banned: "Banned",
    restricted: "Limit at or before 12 weeks",
    limited: "Limit after 12 weeks, before viability",
    protected: "Legal to viability or later",
  },
  permitless_carry: { true: "Yes — no permit needed", false: "No — permit required" },
};

/** How a value reads to a person: "4.45%", "$16.00/hr", "15.47¢/kWh", "Medical only". */
export function formatLaw(def: LawDef, fact: LawFact): string {
  if (def.type === "numeric") {
    const n = fact.n ?? Number(fact.v);
    if (!Number.isFinite(n)) return fact.v;
    switch (def.unit) {
      case "percent":
        if (def.key === "income_tax_top_rate" && n === 0) return "None";
        return `${Number(n.toFixed(2))}%`;
      case "dollars per hour":
        return `$${n.toFixed(2)}/hr`;
      case "cents per kWh":
        return `${n.toFixed(1)}¢/kWh`;
      default:
        return String(n);
    }
  }
  return LABELS[def.key]?.[fact.v] ?? fact.v.replace(/_/g, " ");
}

// ---------------------------------------------------------------------------
// Dates and staleness
// ---------------------------------------------------------------------------

/**
 * How long a value may go unchecked before it's shown as stale. Mirrors
 * CADENCE_DAYS in etl/laws/verify_laws.py.
 */
const CADENCE_DAYS: Record<string, number> = {
  monthly: 45,
  quarterly: 120,
  session: 210,
  annual: 400,
};

const DAY_MS = 86_400_000;

function parseDay(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, (m ?? 1) - 1, d ?? 1);
}

/** "Apr 28, 2026" — dates are calendar days, so format in UTC. */
export function formatDay(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  return new Date(parseDay(iso)).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** True when the value hasn't been re-checked within its law's cadence. */
export function isStale(def: LawDef, fact: { checked: string }, now: Date = new Date()): boolean {
  const limit = CADENCE_DAYS[def.cadence] ?? 400;
  return (now.getTime() - parseDay(fact.checked)) / DAY_MS > limit;
}

// ---------------------------------------------------------------------------
// Joining laws onto counties
// ---------------------------------------------------------------------------

/**
 * The dataset with every state-level metric (`scope: "state"`) and policy
 * category filled from the law table: each county takes its state's value.
 * A blank or missing value stays unknown (NaN / null) — never guessed.
 * Without law data every one of them is unknown.
 */
export function applyStateLaws(data: CountyDataset, laws: LawData | null): CountyDataset {
  const factFor = (i: number, key: string): LawFact | null => {
    const f = laws?.states[data.state[i]]?.[key];
    return f && !isGap(f) ? f : null;
  };
  const values = { ...data.values };
  for (const key of STATE_METRIC_KEYS) {
    const arr = new Float64Array(data.n).fill(NaN);
    for (let i = 0; i < data.n; i++) {
      const f = factFor(i, key);
      const n = f?.n ?? (f ? Number(f.v) : NaN);
      if (Number.isFinite(n)) arr[i] = n;
    }
    values[key] = arr;
  }
  const categories = { ...data.categories };
  for (const key of CATEGORY_KEYS) {
    categories[key] = Array.from({ length: data.n }, (_, i) => factFor(i, key)?.v ?? null);
  }
  return { ...data, values, categories };
}

export interface LawSourceSummary {
  sourceName: string;
  sourceUrl: string;
  sourceDate: string;
  checked: string;
}

/**
 * Where a law's values come from, for a caption beside its filter: the
 * source most states cite, with its date and the latest check date.
 */
export function lawSource(laws: LawData, key: string): LawSourceSummary | null {
  const counts = new Map<string, { n: number; fact: LawFact }>();
  let checked = "";
  for (const facts of Object.values(laws.states)) {
    const f = facts[key];
    if (!f || isGap(f)) continue;
    const id = `${f.sourceName}|${f.sourceUrl}|${f.sourceDate}`;
    const c = counts.get(id);
    counts.set(id, { n: (c?.n ?? 0) + 1, fact: f });
    if (f.checked > checked) checked = f.checked;
  }
  let best: { n: number; fact: LawFact } | null = null;
  for (const c of counts.values()) if (!best || c.n > best.n) best = c;
  if (!best) return null;
  const { sourceName, sourceUrl, sourceDate } = best.fact;
  return { sourceName, sourceUrl, sourceDate, checked };
}
