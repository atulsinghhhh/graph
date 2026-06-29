'use client';

import { useEffect, useRef, useState } from 'react';
import MessageBubble from '@/components/chat/MessageBubble';
import api from '@/lib/api';

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

const SUGGESTIONS = [
  'Show all incidents',
  'What caused the Checkout API failure?',
  'Which bugs are linked to incidents?',
  'Who was assigned to recent incidents?',
];

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const sessionId = useRef(crypto.randomUUID());
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

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
      <div className="border-b border-zinc-200 bg-white px-6 py-4 shrink-0">
        <h1 className="text-base font-semibold text-zinc-900">AI Incident Investigation</h1>
        <p className="text-xs text-zinc-400">Ask anything about your incidents, deployments, or engineers.</p>
      </div>

      {/* Message list */}
      <div className="flex-1 overflow-y-auto px-6 py-6">
        {isEmpty ? (
          <div className="h-full flex flex-col items-center justify-center gap-6">
            <div className="text-center">
              <p className="text-zinc-500 text-sm mb-1">No conversation yet.</p>
              <p className="text-zinc-400 text-xs">Try one of the suggested questions below.</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-lg">
              {SUGGESTIONS.map(s => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="text-left rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-800 hover:border-zinc-400 hover:bg-zinc-50 transition-colors"
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
      <div className="border-t border-zinc-200 bg-white px-6 py-4 shrink-0">
        <div className="max-w-2xl mx-auto flex items-end gap-3">
          <textarea
            ref={inputRef}
            rows={1}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Ask about an incident, deployment, or engineer…"
            className="flex-1 resize-none rounded-xl border border-zinc-300 px-4 py-3 text-sm text-zinc-900 placeholder:text-zinc-400 outline-none focus:border-zinc-900 focus:ring-1 focus:ring-zinc-900 leading-relaxed bg-white"
            style={{ maxHeight: 120, overflowY: 'auto' }}
          />
          <button
            onClick={() => send(input)}
            disabled={!input.trim() || loading}
            className="rounded-xl bg-zinc-900 px-4 py-3 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-40 transition-colors shrink-0"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
