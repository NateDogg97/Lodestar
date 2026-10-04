"use client";

import { useEffect, useId, useRef, useState } from "react";

import { Icon, type IconName } from "./icons";
import { place } from "./info-tip";

/** Copies text with the Clipboard API, falling back to a hidden textarea (plain-http LAN testing). */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const el = document.createElement("textarea");
    el.value = text;
    el.setAttribute("readonly", "");
    el.style.cssText = "position:fixed;top:0;left:0;opacity:0";
    document.body.append(el);
    el.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    el.remove();
    return ok;
  }
}

const SUBJECT = "A home search on Lodestar";

/**
 * "Share" (owner, 2026-10-04; replaced "Copy link"): a menu to send this search's link
 * by email or text, copy it, or — where the device has one — open its own share sheet.
 * The link is read when the menu opens, so it's always the current search. Uses the
 * Popover API like InfoTip: top layer, closes on Escape or a tap outside.
 */
export function ShareButton({ getUrl }: { getUrl: () => string }) {
  const id = useId();
  const button = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const [url, setUrl] = useState("");
  const [copied, setCopied] = useState<"idle" | "copied" | "failed">("idle");
  const [canShare, setCanShare] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  // The latest link getter, read when the menu opens.
  const latest = useRef(getUrl);
  useEffect(() => {
    latest.current = getUrl;
  });

  useEffect(() => {
    const el = pop.current;
    if (!el) return;
    const onBeforeToggle = (e: Event) => {
      if ((e as ToggleEvent).newState !== "open") return;
      el.style.visibility = "hidden";
      const next = latest.current();
      setUrl(next);
      setCopied("idle");
      setCanShare(typeof navigator.share === "function" && (navigator.canShare?.({ url: next }) ?? true));
    };
    const onToggle = (e: Event) => {
      if ((e as ToggleEvent).newState !== "open") return;
      place(button.current!, el);
      el.style.visibility = "";
    };
    el.addEventListener("beforetoggle", onBeforeToggle);
    el.addEventListener("toggle", onToggle);
    return () => {
      el.removeEventListener("beforetoggle", onBeforeToggle);
      el.removeEventListener("toggle", onToggle);
    };
  }, []);

  const close = () => pop.current?.hidePopover();
  const copy = async () => {
    const ok = await copyText(url);
    setCopied(ok ? "copied" : "failed");
    clearTimeout(timer.current);
    timer.current = setTimeout(close, 900);
  };
  const more = async () => {
    close();
    try {
      await navigator.share({ title: SUBJECT, url });
    } catch {
      // Dismissed, or not allowed: nothing to do.
    }
  };

  const item =
    "flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-label hover:bg-neutral-100 dark:hover:bg-neutral-800";
  const row = (icon: IconName, label: string) => (
    <>
      <Icon name={icon} className="h-5 w-5 text-neutral-500" />
      {label}
    </>
  );

  return (
    <>
      <button
        ref={button}
        type="button"
        popoverTarget={id}
        title="Share this search"
        className="flex shrink-0 items-center gap-1.5 rounded-full border border-neutral-300 px-3 py-1.5 text-label font-medium hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-900"
      >
        <Icon name="share" className="h-4 w-4" />
        Share
      </button>
      <div
        ref={pop}
        id={id}
        popover="auto"
        role="menu"
        aria-label="Share this search"
        className="fixed inset-auto m-0 w-56 rounded-lg border border-neutral-200 bg-white p-1 text-neutral-800 shadow-lg dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
      >
        <a
          role="menuitem"
          className={item}
          href={`mailto:?subject=${encodeURIComponent(SUBJECT)}&body=${encodeURIComponent(url)}`}
          onClick={close}
        >
          {row("mail", "Email")}
        </a>
        <a role="menuitem" className={item} href={`sms:?&body=${encodeURIComponent(url)}`} onClick={close}>
          {row("sms", "Text message")}
        </a>
        <button role="menuitem" type="button" className={item} onClick={copy}>
          {row(copied === "copied" ? "check" : "link", copied === "copied" ? "Copied" : copied === "failed" ? "Couldn’t copy" : "Copy link")}
          <span className="sr-only" aria-live="polite">
            {copied === "copied" ? "Link copied" : copied === "failed" ? "Couldn’t copy the link" : ""}
          </span>
        </button>
        {canShare && (
          <button role="menuitem" type="button" className={item} onClick={more}>
            {row("more", "More options…")}
          </button>
        )}
      </div>
    </>
  );
}
