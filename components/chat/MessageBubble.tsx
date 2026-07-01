'use client';

import { useState } from 'react';
import { ChevronUp, ChevronDown } from 'lucide-react';
import SourceCard from './SourceCard';
import { cn } from '@/lib/utils';

interface Source {
  type: string;
  id: string;
  label: string;
  url?: string;
}

interface Props {
  role: 'user' | 'assistant';
  content: string;
  sources?: Source[];
  cypherQuery?: string;
  loading?: boolean;
}

export default function MessageBubble({ role, content, sources, cypherQuery, loading }: Props) {
  const [showSources, setShowSources] = useState(false);
  const isUser = role === 'user';

  return (
    <div className={cn('flex', isUser ? 'justify-end' : 'justify-start')}>
      <div className={cn('max-w-[75%] flex flex-col gap-2', isUser ? 'items-end' : 'items-start')}>
        <div
          className={cn(
            'rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap',
            isUser
              ? 'bg-primary text-primary-foreground rounded-br-sm'
              : 'bg-card border border-border text-foreground rounded-bl-sm'
          )}
        >
          {loading ? (
            <span className="flex items-center gap-2 text-muted-foreground">
              <span className="inline-flex gap-0.5">
                <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground animate-bounce [animation-delay:0ms]" />
                <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground animate-bounce [animation-delay:150ms]" />
                <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground animate-bounce [animation-delay:300ms]" />
              </span>
              Investigating…
            </span>
          ) : (
            content
          )}
        </div>

        {!isUser && !loading && (sources?.length ?? 0) > 0 && (
          <div className="w-full">
            <button
              onClick={() => setShowSources(v => !v)}
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              {showSources ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
              {showSources ? 'Hide' : 'Show'} {sources!.length} source{sources!.length !== 1 ? 's' : ''}
            </button>
            {showSources && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {sources!.map((s, i) => <SourceCard key={i} source={s} />)}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
