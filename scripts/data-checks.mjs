// Data sources to re-check by hand (etl/data_checks.json): what's due, and marking checks done.
//
//   node scripts/data-checks.mjs              every check, due ones first
//   node scripts/data-checks.mjs --hook       only what's due, worded for Claude Code (SessionStart hook)
//   node scripts/data-checks.mjs done acs bea mark checked today
//
// The hook must never get in the way of a session: any error prints a one-line note and exits 0.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const FILE = join(dirname(fileURLToPath(import.meta.url)), "..", "etl", "data_checks.json");
const DAY = 86_400_000;

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function addDays(date, days) {
  return new Date(Date.parse(date) + days * DAY).toISOString().slice(0, 10);
}

/** The date a check falls due: its cadence from the last check, or a known release date if sooner. */
function dueDate(check) {
  const dates = [check.last_checked ? addDays(check.last_checked, check.every_days) : "0000-00-00"];
  if (check.next) dates.push(check.next);
  return dates.sort()[0];
}

function load() {
  return JSON.parse(readFileSync(FILE, "utf8"));
}

function list() {
  const now = today();
  const rows = load().checks.map((c) => ({ ...c, due: dueDate(c) })).sort((a, b) => a.due.localeCompare(b.due));
  for (const c of rows) {
    const state = c.due <= now ? "DUE " : "ok  ";
    const last = c.last_checked ?? "never";
    console.log(`${state} ${c.id.padEnd(14)} last ${last.padEnd(10)}  next ${c.due === "0000-00-00" ? "now" : c.due}  ${c.name}`);
  }
}

function hook() {
  const now = today();
  const due = load().checks.filter((c) => dueDate(c) <= now);
  if (!due.length) return;
  const lines = due.map((c) => {
    const when = c.last_checked ? `last checked ${c.last_checked}` : "never checked";
    return `- ${c.id}: ${c.name} (${when}). Where: ${c.where}. How: ${c.how}`;
  });
  console.log(
    [
      `Lodestar data checks due (${due.length}), from etl/data_checks.json:`,
      ...lines,
      "",
      "In your first reply this session, before anything else, tell the user in one short line per check " +
        "which data checks are due and offer to run them (or a few). Don't run them unasked. After checking one, " +
        "run `node scripts/data-checks.mjs done <id>` and record any decision in Working Master Plan.md.",
    ].join("\n"),
  );
}

function done(ids) {
  const data = load();
  const known = new Set(data.checks.map((c) => c.id));
  const unknown = ids.filter((id) => !known.has(id));
  if (!ids.length || unknown.length) {
    console.error(unknown.length ? `unknown check: ${unknown.join(", ")}` : "give the ids to mark done");
    console.error(`checks: ${[...known].join(", ")}`);
    process.exit(1);
  }
  const now = today();
  for (const c of data.checks) {
    if (!ids.includes(c.id)) continue;
    c.last_checked = now;
    if (c.next && c.next <= now) delete c.next; // a release date that has passed has done its job
    console.log(`${c.id}: checked ${now}, next ${dueDate(c)}`);
  }
  writeFileSync(FILE, JSON.stringify(data, null, 2) + "\n");
}

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === "--hook") {
  try {
    hook();
  } catch (err) {
    console.log(`(data checks unavailable: ${err.message})`);
  }
} else if (cmd === "done") {
  done(rest);
} else {
  list();
}
