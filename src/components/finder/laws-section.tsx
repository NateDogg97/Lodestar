"use client";

import { formatDay, formatLaw, isGap, isStale, type LawData, type LawDef, type LawFact, type LawGap } from "@/lib/laws";
import { formatValue, type CountyDataset } from "@/lib/scoring";

interface Props {
  laws: LawData;
  data: CountyDataset;
  index: number;
}

/**
 * "Laws & taxes" for the selected county (LAWS.md §10). Every value shows its
 * source (linked), the source's own date, and when we last checked it — the
 * app never shows a legal or tax fact without them. Stale values are marked;
 * a deliberately blank value says why.
 */
export function LawsSection({ laws, data, index }: Props) {
  const state = data.state[index];
  const facts = laws.states[state] ?? {};
  const propertyTax = data.values.property_tax_effective_rate[index];
  const propertySource = laws.countySources.property_tax_effective_rate;

  return (
    <details className="group mt-3 rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950" open>
      <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2 text-sm font-semibold">
        <span>
          Laws &amp; taxes <span className="font-normal text-neutral-500">· {state} statewide</span>
        </span>
        <span aria-hidden className="text-neutral-400 transition-transform group-open:rotate-90">›</span>
      </summary>
      <ul className="divide-y divide-neutral-200 border-t border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
        {propertySource && (
          <Row
            name="Property tax rate (this county)"
            value={formatValue("property_tax_effective_rate", Number.isNaN(propertyTax) ? null : propertyTax)}
            source={{ name: propertySource.sourceName, url: propertySource.sourceUrl }}
            detail={propertySource.method}
          />
        )}
        {laws.laws.map((def) => {
          const f = facts[def.key];
          if (!f) return null;
          return isGap(f) ? <GapRow key={def.key} def={def} gap={f} /> : <FactRow key={def.key} def={def} fact={f} />;
        })}
      </ul>
      <p className="border-t border-neutral-200 px-3 py-2 text-[11px] leading-snug text-neutral-500 dark:border-neutral-800">
        {laws.disclaimer}
      </p>
    </details>
  );
}

function FactRow({ def, fact }: { def: LawDef; fact: LawFact }) {
  const stale = isStale(def, fact);
  const lowConfidence = fact.confidence === "low" || fact.confidence === "unverified";
  return (
    <Row
      name={def.name}
      value={formatLaw(def, fact)}
      muted={stale}
      badges={
        <>
          {stale && <Badge tone="amber">Not re-checked since {formatDay(fact.checked)}</Badge>}
          {lowConfidence && <Badge tone="amber">Low confidence</Badge>}
          {fact.status === "enjoined" && <Badge tone="rose">Blocked by a court</Badge>}
          {fact.status === "scheduled" && <Badge tone="neutral">Scheduled</Badge>}
        </>
      }
      source={{ name: fact.sourceName, url: fact.sourceUrl, asOf: fact.sourceDate, checked: fact.checked }}
      detail={fact.notes}
      quote={fact.quote}
    />
  );
}

function GapRow({ def, gap }: { def: LawDef; gap: LawGap }) {
  return (
    <Row
      name={def.name}
      value="Not shown"
      muted
      badges={<Badge tone="neutral">Checked {formatDay(gap.checked)}</Badge>}
      detail={gap.notes}
    />
  );
}

function Row({
  name,
  value,
  muted = false,
  badges,
  source,
  detail,
  quote,
}: {
  name: string;
  value: string;
  muted?: boolean;
  badges?: React.ReactNode;
  source?: { name: string; url: string; asOf?: string; checked?: string };
  detail?: string;
  quote?: string;
}) {
  return (
    <li className="px-3 py-2 text-sm">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-neutral-700 dark:text-neutral-300">{name}</span>
        <span className={`shrink-0 text-right font-medium tabular-nums ${muted ? "text-neutral-400" : ""}`}>{value}</span>
      </div>
      {badges && <div className="mt-1 flex flex-wrap gap-1">{badges}</div>}
      {source && (
        <p className="mt-0.5 text-[11px] text-neutral-500">
          Source:{" "}
          <a href={source.url} target="_blank" rel="noopener noreferrer" className="underline decoration-neutral-300 underline-offset-2 hover:text-neutral-800 dark:hover:text-neutral-200">
            {source.name}
          </a>
          {source.asOf && <>, as of {formatDay(source.asOf)}</>}
          {source.checked && <> · checked {formatDay(source.checked)}</>}
        </p>
      )}
      {(detail || quote) && (
        <details className="mt-0.5 text-[11px] text-neutral-500">
          <summary className="cursor-pointer select-none hover:text-neutral-700 dark:hover:text-neutral-300">Details</summary>
          {detail && <p className="mt-1 whitespace-pre-line">{linkify(detail)}</p>}
          {quote && (
            <p className="mt-1 border-l-2 border-neutral-200 pl-2 italic dark:border-neutral-700">
              Source says: “{quote}”
            </p>
          )}
        </details>
      )}
    </li>
  );
}

function Badge({ tone, children }: { tone: "amber" | "rose" | "neutral"; children: React.ReactNode }) {
  const cls = {
    amber: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
    rose: "bg-rose-100 text-rose-900 dark:bg-rose-950 dark:text-rose-200",
    neutral: "bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300",
  }[tone];
  return <span className={`rounded px-1.5 py-0.5 text-[11px] ${cls}`}>{children}</span>;
}

/** Turn bare URLs in a note (e.g. a pinned Wikipedia revision) into links. */
function linkify(text: string): React.ReactNode[] {
  return text.split(/(https:\/\/[^\s)]*[^\s).,])/g).map((part, i) =>
    part.startsWith("https://") ? (
      <a key={i} href={part} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
        link
      </a>
    ) : (
      part
    ),
  );
}
