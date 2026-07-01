import Link from 'next/link';
import { cn } from '@/lib/utils';

interface Source {
  type: string;
  id: string;
  label: string;
  url?: string;
}

const TYPE_COLOR: Record<string, string> = {
  Incident: 'bg-red-500/10 text-red-400 border-red-500/20',
  Deployment: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  PullRequest: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
  Engineer: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  Bug: 'bg-orange-500/10 text-orange-400 border-orange-500/20',
  Alert: 'bg-pink-500/10 text-pink-400 border-pink-500/20',
  Service: 'bg-teal-500/10 text-teal-400 border-teal-500/20',
};

function SourceLink({ source }: { source: Source }) {
  // Incident → link to detail page
  if (source.type === 'Incident') {
    return (
      <Link href={`/incidents/${source.id}`} className="underline underline-offset-2">
        {source.label}
      </Link>
    );
  }
  // External URL (GitHub PR, Jira bug, etc.)
  if (source.url) {
    return (
      <a href={source.url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
        {source.label}
      </a>
    );
  }
  return <span>{source.label}</span>;
}

export default function SourceCard({ source }: { source: Source }) {
  const color = TYPE_COLOR[source.type] ?? 'bg-muted text-muted-foreground border-border';
  return (
    <div className={cn('inline-flex items-center gap-1.5 border rounded-md px-2.5 py-1 text-xs', color)}>
      <span className="font-medium">{source.type}</span>
      <span className="opacity-60">·</span>
      <SourceLink source={source} />
    </div>
  );
}
