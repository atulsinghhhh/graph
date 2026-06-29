interface TimelineEvent {
  type: 'Deployment' | 'PullRequest' | 'Alert' | 'Incident' | 'Bug';
  label: string;
  timestamp: string;
  url?: string;
  badge?: string;
  confidence?: number;
}

const TYPE_STYLE: Record<string, { dot: string; badge: string }> = {
  Deployment: { dot: 'bg-blue-500', badge: 'bg-blue-50 text-blue-700 border-blue-200' },
  PullRequest: { dot: 'bg-purple-500', badge: 'bg-purple-50 text-purple-700 border-purple-200' },
  Alert: { dot: 'bg-pink-500', badge: 'bg-pink-50 text-pink-700 border-pink-200' },
  Incident: { dot: 'bg-red-500', badge: 'bg-red-50 text-red-700 border-red-200' },
  Bug: { dot: 'bg-orange-500', badge: 'bg-orange-50 text-orange-700 border-orange-200' },
};

export default function Timeline({ events }: { events: TimelineEvent[] }) {
  if (events.length === 0) return <p className="text-sm text-zinc-400">No timeline data.</p>;

  return (
    <ol className="relative border-l border-zinc-200 flex flex-col gap-0">
      {events.map((ev, i) => {
        const style = TYPE_STYLE[ev.type] ?? { dot: 'bg-zinc-400', badge: 'bg-zinc-50 text-zinc-700 border-zinc-200' };
        return (
          <li key={i} className="ml-5 pb-6 last:pb-0">
            <span className={`absolute -left-2 flex h-4 w-4 items-center justify-center rounded-full ${style.dot} ring-4 ring-white`} />
            <div className="flex items-start gap-3 flex-wrap">
              <span className={`inline-flex items-center border rounded-full px-2.5 py-0.5 text-xs font-medium ${style.badge}`}>
                {ev.type}
              </span>
              <div className="flex flex-col gap-0.5">
                {ev.url ? (
                  <a href={ev.url} target="_blank" rel="noopener noreferrer"
                    className="text-sm text-zinc-900 font-medium hover:underline">
                    {ev.label}
                  </a>
                ) : (
                  <span className="text-sm text-zinc-900 font-medium">{ev.label}</span>
                )}
                <span className="text-xs text-zinc-400">{new Date(ev.timestamp).toLocaleString()}</span>
                {ev.confidence !== undefined && (
                  <span className="text-xs text-zinc-400">Confidence: {Math.round(ev.confidence * 100)}%</span>
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
