"use client";

import { useState, type ReactNode } from "react";

import { InfoTip } from "@/components/ui/info-tip";
import { Modal } from "@/components/ui/modal";
import { formatDay, formatLaw, isGap, isStale, type LawData, type LawDef, type LawFact, type LawGap } from "@/lib/laws";
import { formatValue, type CountyDataset } from "@/lib/scoring";

import { LawSourcesList } from "./data-sources";

interface Props {
  laws: LawData;
  data: CountyDataset;
  index: number;
}

/**
 * The place view's "Laws & taxes" tab (LAWS.md §10). Every value's source
 * (linked), the source's own date, and when we last checked it sit in the
 * "i" beside it, with its notes; "Sources" lists every law's source. Stale
 * values are marked; a deliberately blank value says why.
 */
export function LawsSection({ laws, data, index }: Props) {
  const state = data.state[index];
  const facts = laws.states[state] ?? {};
  const propertyTax = data.values.property_tax_effective_rate[index];
  const propertySource = laws.countySources.property_tax_effective_rate;
  const [sourcesOpen, setSourcesOpen] = useState(false);

  return (
    <section aria-label="Laws and taxes">
      <div className="flex items-start justify-between gap-3">
        <p className="text-label text-neutral-500 dark:text-neutral-400">
          State laws apply to every county in {state}; property tax is this county&rsquo;s own.
        </p>
        <button
          type="button"
          onClick={() => setSourcesOpen(true)}
          aria-haspopup="dialog"
          className="shrink-0 rounded-full border border-neutral-300 px-3 py-1 text-label font-medium hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-900"
        >
          Sources
        </button>
      </div>
      <Modal open={sourcesOpen} onClose={() => setSourcesOpen(false)} title="Law & tax sources" size="medium">
        <div className="px-gutter py-4 md:px-6">
          <p className="text-label text-neutral-600 dark:text-neutral-400">
            The source most states&rsquo; values come from. A state whose value came from elsewhere names its own
            source in the “i” beside that value.
          </p>
          <LawSourcesList laws={laws} />
        </div>
      </Modal>
      <ul className="-mx-2 mt-3 divide-y divide-neutral-200 dark:divide-neutral-800">
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
      <p className="mt-3 border-t border-neutral-200 pt-3 text-caption text-neutral-500 dark:border-neutral-800 dark:text-neutral-400">
        {laws.disclaimer}
      </p>
    </section>
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
  badges?: ReactNode;
  source?: { name: string; url: string; asOf?: string; checked?: string };
  detail?: string;
  quote?: string;
}) {
  return (
    <li className="px-2 py-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-label text-neutral-700 dark:text-neutral-300">{name}</span>
        <span className="flex shrink-0 items-center gap-1">
          <span className={`text-right text-label font-semibold tabular-nums ${muted ? "text-neutral-400" : ""}`}>{value}</span>
          {(source || detail || quote) && (
            <InfoTip label={name}>
              {source && (
                <p>
                  Source:{" "}
                  <a href={source.url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
                    {source.name}
                  </a>
                  {source.asOf && <>, as of {formatDay(source.asOf)}</>}
                  {source.checked && <>. Checked {formatDay(source.checked)}</>}.
                </p>
              )}
              {detail && <p className={`whitespace-pre-line ${source ? "mt-2" : ""}`}>{linkify(detail)}</p>}
              {quote && (
                <p className="mt-2 border-l-2 border-neutral-300 pl-2 italic dark:border-neutral-600">
                  Source says: &ldquo;{quote}&rdquo;
                </p>
              )}
            </InfoTip>
          )}
        </span>
      </div>
      {badges && <div className="mt-1.5 flex flex-wrap gap-1">{badges}</div>}
    </li>
  );
}

function Badge({ tone, children }: { tone: "amber" | "rose" | "neutral"; children: ReactNode }) {
  const cls = {
    amber: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
    rose: "bg-rose-100 text-rose-900 dark:bg-rose-950 dark:text-rose-200",
    neutral: "bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300",
  }[tone];
  return <span className={`rounded px-1.5 py-0.5 text-caption ${cls}`}>{children}</span>;
}

/** Turn bare URLs in a note (e.g. a pinned Wikipedia revision) into links. */
function linkify(text: string): ReactNode[] {
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
