export default function SettingsLoading() {
  return (
    <main className="min-h-screen bg-[#020617] px-6 py-12 md:px-10">
      <div className="mx-auto max-w-[800px]">
        <div className="h-9 w-48 animate-pulse rounded-xl bg-white/5" />
        <div className="mt-3 h-4 w-56 animate-pulse rounded-full bg-white/[0.04]" />

        <div className="mt-10 flex flex-col gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-16 animate-pulse rounded-2xl bg-white/[0.04]" />
          ))}
        </div>
      </div>
    </main>
  );
}
