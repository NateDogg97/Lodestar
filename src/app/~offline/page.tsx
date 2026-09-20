export default function OfflinePage() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 className="text-2xl font-semibold">You&apos;re offline</h1>
      <p className="max-w-sm text-sm text-neutral-500 dark:text-neutral-400">
        This page hasn&apos;t been saved for offline use yet. Reconnect and
        try again.
      </p>
    </main>
  );
}
