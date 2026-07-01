'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ArrowUp } from 'lucide-react';
import MessageBubble from '@/components/chat/MessageBubble';
import api from '@/lib/api';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';

interface Source {
  type: string;
  id: string;
  label: string;
  url?: string;
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
  sources?: Source[];
  cypherQuery?: string;
}

const SOLO_SUGGESTIONS = [
  'Why did my last deployment fail?',
  'What did I change in the past week?',
  'Which of my services had the most errors?',
  'How do I fix the current open incident?',
];

const ORG_SUGGESTIONS = [
  'Show all incidents',
  'What caused the Checkout API failure?',
  'Which bugs are linked to incidents?',
  'Who was assigned to recent incidents?',
];

function ChatPageInner() {
  const searchParams = useSearchParams();
  const [messages, setMessages] = useState<Message[]>([]);
  // Pre-fill from links like IncidentGraph's "Ask AI about this" (?q=...).
  const [input, setInput] = useState(() => searchParams.get('q') ?? '');
  const [loading, setLoading] = useState(false);
  const sessionId = useRef(crypto.randomUUID());
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [isSolo, setIsSolo] = useState(false);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  useEffect(() => {
    api.get('/api/organizations/me')
      .then(r => setIsSolo(!!r.data.isSolo))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (searchParams.get('q')) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function send(question: string) {
    if (!question.trim() || loading) return;
    const q = question.trim();
    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: q }]);
    setLoading(true);

    try {
      const { data } = await api.post('/api/chat', {
        question: q,
        sessionId: sessionId.current,
      });
      setMessages(prev => [
        ...prev,
        { role: 'assistant', content: data.answer, sources: data.sources, cypherQuery: data.cypherQuery },
      ]);
    } catch (err: any) {
      setMessages(prev => [
        ...prev,
        { role: 'assistant', content: 'Something went wrong. Please try again.' },
      ]);
    } finally {
      setLoading(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send(input);
    }
  }

  const isEmpty = messages.length === 0;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="border-b border-border bg-card px-6 py-4 shrink-0">
        <h1 className="text-base font-semibold text-foreground">AI Incident Investigation</h1>
        <p className="text-xs text-muted-foreground">Ask anything about your incidents, deployments, or engineers.</p>
      </div>

      {/* Message list */}
      <div className="flex-1 overflow-y-auto px-6 py-6">
        {isEmpty ? (
          <div className="h-full flex flex-col items-center justify-center gap-6">
            <div className="text-center">
              <p className="text-muted-foreground text-sm mb-1">No conversation yet.</p>
              <p className="text-muted-foreground/70 text-xs">Try one of the suggested questions below.</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-lg">
              {(isSolo ? SOLO_SUGGESTIONS : ORG_SUGGESTIONS).map(s => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="text-left rounded-xl border border-border bg-card px-4 py-3 text-sm text-foreground hover:border-primary/50 hover:bg-accent/50 transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4 max-w-2xl mx-auto w-full">
            {messages.map((m, i) => (
              <MessageBubble key={i} role={m.role} content={m.content} sources={m.sources} cypherQuery={m.cypherQuery} />
            ))}
            {loading && <MessageBubble role="assistant" content="" loading />}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {/* Input bar */}
      <div className="border-t border-border bg-card px-6 py-4 shrink-0">
        <div className="max-w-2xl mx-auto flex items-end gap-3">
          <Textarea
            ref={inputRef}
            rows={1}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Ask about an incident, deployment, or engineer…"
            className="flex-1 resize-none rounded-xl leading-relaxed"
            style={{ maxHeight: 120, overflowY: 'auto' }}
          />
          <Button
            onClick={() => send(input)}
            disabled={!input.trim() || loading}
            size="icon"
            className="rounded-xl shrink-0 size-11"
          >
            <ArrowUp />
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function ChatPage() {
  return (
    <Suspense fallback={null}>
      <ChatPageInner />
    </Suspense>
  );
}
