"use client";

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";

import { PLACE_KIND_LABEL, searchPlaces, type NationalAreas, type Place } from "@/lib/tracts";

import { Icon } from "@/components/ui/icons";
import { Modal } from "@/components/ui/modal";

import { addRecentPlace, clearRecentPlaces, loadRecentPlaces, type RecentPlace } from "./recent-places";

/**
 * Look a place up by name (plan §9 Phase 12): a county, city, neighborhood or ZIP
 * code. Counties are searchable at once; the rest once the national areas file is in
 * (it starts loading when this opens). Picking one shows it scored on the current search.
 * With nothing typed, the places looked up recently on this device are listed.
 */

const LIMIT = 8;

/** A row in the list: a match, or a recent place (null until the index has it). */
type Row = RecentPlace & { place: Place | null };

export function PlaceSearchModal({
  open,
  onClose,
  index,
  areas,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  index: Place[];
  /** Cities, neighborhoods and ZIP codes come from the areas file. */
  areas: "loading" | "ready" | "error";
  onPick: (place: Place) => void;
}) {
  return (
    <Modal open={open} onClose={onClose} title="Find a place" size="medium">
      <SearchBody index={index} areas={areas} onPick={onPick} />
    </Modal>
  );
}

function SearchBody({ index, areas, onPick }: { index: Place[]; areas: "loading" | "ready" | "error"; onPick: (place: Place) => void }) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const typed = query.trim().length >= 2;
  const found = useMemo(() => searchPlaces(index, query, LIMIT), [index, query]);
  // Nothing typed: recent places, each matched to the index by its key. A city, neighborhood
  // or ZIP code waits for the areas file (shown, not yet pickable); one that's gone is dropped.
  const [recent, setRecent] = useState<RecentPlace[]>(loadRecentPlaces);
  const byKey = useMemo(() => new Map(index.map((p) => [p.key, p])), [index]);
  const results = useMemo<Row[]>(() => {
    if (typed) return found.map((p) => ({ ...p, place: p }));
    return recent
      .map((r) => ({ ...r, place: byKey.get(r.key) ?? null }))
      .filter((r) => r.place || (r.kind !== "county" && areas === "loading"));
  }, [typed, found, recent, byKey, areas]);
  const pick = (row: Row) => {
    if (!row.place) return;
    addRecentPlace(row.place);
    onPick(row.place);
  };

  // After the dialog opens (it focuses its Close button first).
  useEffect(() => {
    const id = requestAnimationFrame(() => input.current?.focus());
    return () => cancelAnimationFrame(id);
  }, []);

  const at = Math.min(active, Math.max(0, results.length - 1));
  const optionId = (i: number) => `${listId}-${i}`;

  return (
    <div className="flex min-h-0 flex-1 flex-col md:h-[26rem] md:flex-none">
      <div className="shrink-0 px-gutter pt-3 md:px-6 md:pt-4">
        <label className="relative block">
          <span className="sr-only">County, city, neighborhood or ZIP code</span>
          <Icon name="search" className="pointer-events-none absolute top-1/2 left-3 h-5 w-5 -translate-y-1/2 text-neutral-400" />
          <input
            ref={input}
            type="search"
            role="combobox"
            aria-expanded={results.length > 0}
            aria-controls={listId}
            aria-activedescendant={results.length ? optionId(at) : undefined}
            aria-autocomplete="list"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="search"
            placeholder="City, neighborhood, county or ZIP"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                if (results.length) setActive((at + (e.key === "ArrowDown" ? 1 : results.length - 1)) % results.length);
              } else if (e.key === "Enter" && results[at]) {
                e.preventDefault();
                pick(results[at]);
              }
            }}
            // 16px text: iOS zooms the page on focus into anything smaller.
            className="w-full rounded-xl border border-neutral-300 bg-white py-2.5 pr-3 pl-10 text-body outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/30 dark:border-neutral-700 dark:bg-neutral-900"
          />
        </label>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-gutter py-2 md:px-6">
        {!typed && results.length > 0 && (
          <div className="flex items-center justify-between px-3 pt-1 pb-1.5">
            <h3 className="text-caption font-semibold text-neutral-500 dark:text-neutral-400">Recent</h3>
            <button
              type="button"
              onClick={() => {
                clearRecentPlaces();
                setRecent([]);
                input.current?.focus();
              }}
              className="text-caption font-medium text-emerald-700 hover:underline dark:text-emerald-400"
            >
              Clear
            </button>
          </div>
        )}
        <ul id={listId} role="listbox" aria-label={typed ? "Places" : "Recent places"}>
          {results.map((p, i) => (
            <li
              key={p.key}
              id={optionId(i)}
              role="option"
              aria-selected={i === at}
              aria-disabled={!p.place}
              onClick={() => pick(p)}
              onPointerMove={() => i !== at && setActive(i)}
              className={`flex items-center gap-3 rounded-lg px-3 py-2.5 ${p.place ? "cursor-pointer" : "opacity-50"} ${
                i === at ? "bg-neutral-100 dark:bg-neutral-800" : ""
              }`}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-body font-medium">{p.name}</span>
                <span className="block truncate text-caption text-neutral-500 dark:text-neutral-400">
                  {p.near ? `Areas near it · ${p.where}` : p.where}
                </span>
              </span>
              <span className="shrink-0 rounded-full border border-neutral-300 px-2 py-px text-caption text-neutral-600 dark:border-neutral-700 dark:text-neutral-400">
                {PLACE_KIND_LABEL[p.kind]}
              </span>
            </li>
          ))}
        </ul>

        <div aria-live="polite" className="px-3 py-2 text-label text-neutral-500 dark:text-neutral-400">
          {!typed ? (
            results.length > 0 ? (
              results.some((r) => !r.place) && <p>Loading cities, neighborhoods and ZIP codes…</p>
            ) : (
              <p>Type a county, city, neighborhood or ZIP code to see how it does on your current search.</p>
            )
          ) : areas === "loading" ? (
            <p>Loading cities, neighborhoods and ZIP codes…{results.length === 0 && " Counties are ready now."}</p>
          ) : areas === "error" ? (
            <p>Cities, neighborhoods and ZIP codes couldn’t be loaded, so only counties are listed. Check your connection and try again.</p>
          ) : results.length === 0 ? (
            <p>
              Nothing found for “{query.trim()}”. Check the spelling, or try the city or county it’s in. Small ZIP codes are
              listed under a larger neighbor.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

const PAGE = 100;

/**
 * A looked-up city, neighborhood or ZIP code in the results panel: its areas on the
 * current search, best first (the list itself is passed in), then the ones a must-have
 * rules out.
 */
export function PlaceLookup({
  place,
  areas,
  matches,
  ruledOut,
  usRank,
  byArea,
  onBack,
  onOpenArea,
  list,
}: {
  place: Place;
  areas: NationalAreas;
  /** Its areas that pass the search, best first. */
  matches: number[];
  /** Its areas a must-have rules out (or that have no data for one, when those are hidden). */
  ruledOut: number[];
  /** Where its best area stands among every matching US area; null when nothing is weighted. */
  usRank: { rank: number; of: number } | null;
  /** The search has a priority that varies area by area. */
  byArea: boolean;
  onBack: () => void;
  onOpenArea: (i: number) => void;
  /** The ranked list for the first `count` matches. */
  list: (count: number) => ReactNode;
}) {
  const [visible, setVisible] = useState(PAGE);
  const total = matches.length + ruledOut.length;
  return (
    <div className="px-3 py-3">
      <button type="button" onClick={onBack} className="px-1 text-label font-medium text-emerald-700 hover:underline dark:text-emerald-400">
        ← All results
      </button>
      <div className="mt-2 mb-3 px-1">
        <h3 className="text-heading font-semibold">{place.near ? `Near ${place.name}` : place.name}</h3>
        <p className="text-label text-neutral-600 dark:text-neutral-400">
          {PLACE_KIND_LABEL[place.kind]} · {place.where} · {total.toLocaleString()} {total === 1 ? "area" : "areas"}
          {place.population > 0 && <> · {place.population.toLocaleString()} people</>}
        </p>
        <p className="mt-1.5 text-caption text-neutral-500">
          {matches.length === 0
            ? "None of its areas passes your must-haves."
            : usRank
              ? `On your current search, best match first. Its best area is #${usRank.rank.toLocaleString()} of ${usRank.of.toLocaleString()} matching US areas.`
              : "Nothing is weighted, so these are its areas that pass your must-haves, most people first."}
          {matches.length > 1 && usRank && !byArea && " Your priorities are all county-wide, so areas in the same county score the same."}
          {place.near && " No area sits inside the town itself, so these are the ones beside it."}
        </p>
      </div>

      {matches.length > 0 && list(visible)}
      {visible < matches.length && (
        <button
          type="button"
          onClick={() => setVisible((v) => v + PAGE)}
          className="mt-3 w-full rounded-lg border border-neutral-300 py-2 text-label font-medium hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-900"
        >
          Show {Math.min(PAGE, matches.length - visible)} more
        </button>
      )}

      {ruledOut.length > 0 && (
        <section className="mt-5">
          <h4 className="px-1 text-label font-semibold text-neutral-600 dark:text-neutral-400">
            Don’t pass your must-haves ({ruledOut.length.toLocaleString()})
          </h4>
          <ul className="mt-1 divide-y divide-neutral-200 dark:divide-neutral-800">
            {ruledOut.slice(0, visible).map((i) => (
              <li key={areas.geoid[i]} className="px-1 py-2">
                <button
                  type="button"
                  onClick={() => onOpenArea(i)}
                  className="max-w-full truncate text-left text-label underline decoration-neutral-300 underline-offset-[3px] hover:decoration-neutral-600 dark:decoration-neutral-700"
                >
                  {areas.name[i]}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
