/**
 * State laws and taxes (LAWS.md), as published by `etl/laws/publish.py` in
 * `public/data/laws.json`. Pure: parsing, labels and staleness only — no UI.
 *
 * Every value carries who said it (`sourceName`, `sourceUrl`), the source's
 * own date (`sourceDate`) and when we last checked it against the source
 * (`checked`). The app must show all three wherever it shows a value.
 */

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
