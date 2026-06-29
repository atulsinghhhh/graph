import Link from 'next/link';

interface Source {
  type: string;
  id: string;
  label: string;
  url?: string;
}

const TYPE_COLOR: Record<string, string> = {
  Incident: 'bg-red-50 text-red-700 border-red-200',
  Deployment: 'bg-blue-50 text-blue-700 border-blue-200',
  PullRequest: 'bg-purple-50 text-purple-700 border-purple-200',
  Engineer: 'bg-amber-50 text-amber-700 border-amber-200',
  Bug: 'bg-orange-50 text-orange-700 border-orange-200',
  Alert: 'bg-pink-50 text-pink-700 border-pink-200',
  Service: 'bg-teal-50 text-teal-700 border-teal-200',
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
  const color = TYPE_COLOR[source.type] ?? 'bg-zinc-50 text-zinc-700 border-zinc-200';
  return (
    <div className={`inline-flex items-center gap-1.5 border rounded-lg px-2.5 py-1 text-xs ${color}`}>
      <span className="font-medium">{source.type}</span>
      <span className="opacity-60">·</span>
      <SourceLink source={source} />
    </div>
  );
}
