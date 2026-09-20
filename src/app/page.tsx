export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 p-8 text-center">
      <div className="space-y-2">
        <h1 className="text-4xl font-semibold tracking-tight">
          New Home Finder
        </h1>
        <p className="max-w-md text-neutral-500 dark:text-neutral-400">
          Compare and shortlist the places our family might move to next.
        </p>
      </div>
      <p className="text-xs text-neutral-400 dark:text-neutral-500">
        Install this app from your browser menu to use it from your home screen.
      </p>
    </main>
  );
}
