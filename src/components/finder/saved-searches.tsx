"use client";

import { useState } from "react";

import { Icon } from "@/components/ui/icons";
import { ShareButton } from "@/components/ui/share-button";

import type { Preferences } from "./preferences";
import {
  deleteSaved,
  loadRecent,
  loadSaved,
  saveSearch,
  searchKey,
  storedPrefs,
  type StoredSearch,
} from "./searches-store";
import { summarizeSearch } from "./search-url";

/**
 * The Filters modal's Saved view, behind its Saved button (plan Phase 7b): save the current search by
 * name, and reopen saved or recent ones. Mounted only while the tab is open,
 * so the lists are read fresh each time it opens.
 */
export function SavedSearches({
  prefs,
  onOpen,
  getShareUrl,
}: {
  prefs: Preferences;
  onOpen: (prefs: Preferences) => void;
  /** This search's link, for Share. */
  getShareUrl: () => string;
}) {
  const [saved, setSaved] = useState(loadSaved);
  const [recent] = useState(loadRecent);
  const [name, setName] = useState("");
  const [justSaved, setJustSaved] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const current = searchKey(prefs);
  const summary = summarizeSearch(prefs);
  const alreadySaved = saved.find((s) => s.query === current);

  const save = () => {
    saveSearch(name || summary, prefs);
    setSaved(loadSaved());
    setName("");
    setJustSaved(true);
  };

  const open = (s: StoredSearch) => {
    const p = storedPrefs(s);
    if (p) onOpen(p);
  };

  return (
    <div className="space-y-section px-gutter py-5 md:px-6">
      <section>
        <div className="mb-1 flex items-center justify-between gap-3">
          <h3 className="text-title font-semibold">Save this search</h3>
          <ShareButton getUrl={getShareUrl} />
        </div>
        <p className="mb-3 text-caption text-neutral-500 dark:text-neutral-400">
          {summary}
          {alreadySaved && <> · already saved as &ldquo;{alreadySaved.name}&rdquo;</>}
        </p>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <label htmlFor="search-name" className="sr-only">
            Name
          </label>
          <input
            id="search-name"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setJustSaved(false);
            }}
            maxLength={60}
            placeholder={summary}
            className="h-10 min-w-0 flex-1 rounded-lg border border-neutral-300 bg-transparent px-3 text-body placeholder:text-neutral-400 md:text-label dark:border-neutral-700"
          />
          <button
            type="submit"
            className={`flex h-10 shrink-0 items-center gap-1.5 rounded-full px-4 text-label font-semibold ${
              justSaved
                ? "bg-emerald-600 text-white"
                : "bg-neutral-900 text-white hover:bg-neutral-700 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
            }`}
          >
            {justSaved && <Icon name="check" className="h-4 w-4" />}
            {justSaved ? "Saved" : "Save"}
          </button>
        </form>
      </section>

      <section>
        <h3 className="mb-2 text-title font-semibold">Saved</h3>
        {saved.length === 0 ? (
          <p className="text-label text-neutral-500 dark:text-neutral-400">
            Nothing saved yet. Name a search above to keep it here.
          </p>
        ) : (
          <ul className="divide-y divide-neutral-200 dark:divide-neutral-800">
            {saved.map((s) => {
              const p = storedPrefs(s);
              const sum = p ? summarizeSearch(p) : "Can’t be opened";
              const title = s.name || sum;
              return (
                <li key={s.id} className="flex items-center gap-2 py-1">
                  <SearchRow
                    title={title}
                    // The summary only when it adds something to the name.
                    detail={`${title === sum ? "" : `${sum} · `}saved ${formatWhen(s.at)}`}
                    current={s.query === current}
                    disabled={!p}
                    onClick={() => open(s)}
                  />
                  {confirmDelete === s.id ? (
                    <button
                      type="button"
                      onClick={() => {
                        deleteSaved(s.id);
                        setSaved(loadSaved());
                        setConfirmDelete(null);
                      }}
                      onBlur={() => setConfirmDelete(null)}
                      autoFocus
                      className="shrink-0 rounded-full bg-rose-700 px-3 py-1.5 text-label font-medium text-white hover:bg-rose-800"
                    >
                      Delete
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(s.id)}
                      aria-label={`Delete “${s.name}”`}
                      title="Delete"
                      className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-neutral-500 hover:bg-neutral-100 hover:text-rose-700 dark:hover:bg-neutral-900 dark:hover:text-rose-400"
                    >
                      <Icon name="delete" className="h-5 w-5" />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section>
        <h3 className="mb-2 text-title font-semibold">Recent</h3>
        {recent.length === 0 ? (
          <p className="text-label text-neutral-500 dark:text-neutral-400">
            Your searches show up here after you close Filters, and when a shared link replaces yours.
          </p>
        ) : (
          <ul className="divide-y divide-neutral-200 dark:divide-neutral-800">
            {recent.map((s) => {
              const p = storedPrefs(s);
              return (
                <li key={s.id} className="py-1">
                  <SearchRow
                    title={p ? summarizeSearch(p) : "Can’t be opened"}
                    detail={formatWhen(s.at)}
                    current={s.query === current}
                    disabled={!p}
                    onClick={() => open(s)}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <p className="text-caption text-neutral-500 dark:text-neutral-400">
        Saved and recent searches stay in this browser on this device. To send one to someone, use Share.
      </p>
    </div>
  );
}

function SearchRow({
  title,
  detail,
  current,
  disabled,
  onClick,
}: {
  title: string;
  detail: string;
  current: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || current}
      className="-mx-2 flex min-w-0 flex-1 items-center justify-between gap-3 rounded-lg px-2 py-2 text-left enabled:hover:bg-neutral-100 disabled:cursor-default dark:enabled:hover:bg-neutral-900"
    >
      <span className="min-w-0">
        <span className="block truncate text-body">{title}</span>
        <span className="block truncate text-caption text-neutral-500 dark:text-neutral-400">{detail}</span>
      </span>
      {current && (
        <span className="shrink-0 rounded-full bg-emerald-50 px-2 py-0.5 text-caption font-medium text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
          Current
        </span>
      )}
    </button>
  );
}

/** "just now", "5 min ago", "3 hr ago", "yesterday", or a date. */
function formatWhen(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const min = Math.round((Date.now() - t) / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} hr ago`;
  if (hr < 48) return "yesterday";
  return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
