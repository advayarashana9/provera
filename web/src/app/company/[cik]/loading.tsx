export default function Loading() {
  return (
    <div className="flex flex-col min-h-screen bg-zinc-50 font-sans text-zinc-900">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto max-w-7xl px-6 py-4 flex items-center justify-between">
          <div className="h-5 w-24 shimmer-bg rounded"></div>
        </div>
      </header>

      {/* Main Content Skeleton */}
      <main className="flex-1 mx-auto max-w-7xl w-full px-6 py-10 space-y-12">
        {/* Back link skeleton */}
        <div className="h-4 w-28 shimmer-bg rounded mb-2"></div>

        {/* Company Header Card Skeleton */}
        <div className="bg-white border border-zinc-200 rounded p-6 shadow-sm flex flex-col md:flex-row justify-between gap-6">
          <div className="space-y-3 flex-1">
            <div className="h-7 w-2/3 shimmer-bg rounded"></div>
            <div className="h-4 w-1/3 shimmer-bg opacity-70 rounded"></div>
          </div>
          <div className="w-full md:w-64 space-y-2 pt-4 md:pt-0 md:border-l md:border-zinc-100 md:pl-6">
            <div className="h-4 shimmer-bg rounded w-full"></div>
            <div className="h-4 shimmer-bg opacity-70 rounded w-5/6"></div>
          </div>
        </div>

        {/* Summary Dashboard Skeleton */}
        <div className="space-y-4">
          <div className="h-5 w-40 shimmer-bg rounded"></div>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="bg-white border border-zinc-200 rounded p-4 text-center space-y-2">
                <div className="h-8 w-12 shimmer-bg rounded mx-auto"></div>
                <div className="h-3 w-16 shimmer-bg opacity-70 rounded mx-auto"></div>
              </div>
            ))}
          </div>
        </div>

        {/* Findings List Skeleton */}
        <div className="space-y-4">
          <div className="h-5 w-36 shimmer-bg rounded"></div>
          <div className="bg-white border border-zinc-200 rounded p-6 shadow-sm space-y-4">
            <div className="h-4 w-3/4 shimmer-bg rounded"></div>
            <div className="h-4 w-1/2 shimmer-bg opacity-70 rounded"></div>
          </div>
        </div>

        {/* Recent Filings Skeleton */}
        <div className="space-y-4">
          <div className="h-5 w-44 shimmer-bg rounded"></div>
          <div className="border border-zinc-200 rounded bg-white overflow-hidden shadow-sm divide-y divide-zinc-200">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="px-6 py-4 flex justify-between items-center gap-4">
                <div className="h-4 w-12 shimmer-bg rounded"></div>
                <div className="h-4 w-24 shimmer-bg opacity-70 rounded"></div>
                <div className="h-4 w-40 shimmer-bg rounded flex-1"></div>
                <div className="h-4 w-20 shimmer-bg opacity-70 rounded"></div>
              </div>
            ))}
          </div>
        </div>
      </main>

      <footer className="border-t border-zinc-200 bg-white py-6">
        <div className="mx-auto max-w-7xl px-6 text-center text-xs text-zinc-400 font-normal">
          Source data: U.S. SEC EDGAR.
        </div>
      </footer>
    </div>
  );
}
