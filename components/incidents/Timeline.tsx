interface TimelineEvent {
  type: 'Deployment' | 'PullRequest' | 'Alert' | 'Incident' | 'Bug';
  label: string;
  timestamp: string;
  url?: string;
  badge?: string;
  confidence?: number;
}

const TYPE_STYLE: Record<string, { dot: string; badge: string }> = {
  Deployment: { dot: 'bg-blue-500', badge: 'bg-blue-500/10 text-blue-400 border-blue-500/20' },
  PullRequest: { dot: 'bg-purple-500', badge: 'bg-purple-500/10 text-purple-400 border-purple-500/20' },
  Alert: { dot: 'bg-pink-500', badge: 'bg-pink-500/10 text-pink-400 border-pink-500/20' },
  Incident: { dot: 'bg-red-500', badge: 'bg-red-500/10 text-red-400 border-red-500/20' },
  Bug: { dot: 'bg-orange-500', badge: 'bg-orange-500/10 text-orange-400 border-orange-500/20' },
};

export default function Timeline({ events }: { events: TimelineEvent[] }) {
  if (events.length === 0) return <p className="text-sm text-muted-foreground">No timeline data.</p>;

  return (
    <ol className="relative border-l border-border flex flex-col gap-0">
      {events.map((ev, i) => {
        const style = TYPE_STYLE[ev.type] ?? { dot: 'bg-muted-foreground', badge: 'bg-muted text-muted-foreground border-border' };
        return (
          <li key={i} className="ml-5 pb-6 last:pb-0">
            <span className={`absolute -left-2 flex h-4 w-4 items-center justify-center rounded-full ${style.dot} ring-4 ring-card`} />
            <div className="flex items-start gap-3 flex-wrap">
              <span className={`inline-flex items-center border rounded-full px-2.5 py-0.5 text-xs font-medium ${style.badge}`}>
                {ev.type}
              </span>
              <div className="flex flex-col gap-0.5">
                {ev.url ? (
                  <a href={ev.url} target="_blank" rel="noopener noreferrer"
                    className="text-sm text-foreground font-medium hover:underline">
                    {ev.label}
                  </a>
                ) : (
                  <span className="text-sm text-foreground font-medium">{ev.label}</span>
                )}
                <span className="text-xs text-muted-foreground">{new Date(ev.timestamp).toLocaleString()}</span>
                {ev.confidence !== undefined && (
                  <span className="text-xs text-muted-foreground">Confidence: {Math.round(ev.confidence * 100)}%</span>
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
