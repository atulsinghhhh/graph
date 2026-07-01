'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader } from '@/components/ui/card';

export default function CreateOrgPage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setLoading(true);
    setError('');

    try {
      await api.post('/api/organizations', { name: name.trim() });
      router.push('/integrations');
      router.refresh();
    } catch (err: any) {
      if (err?.response?.status === 409) {
        router.push('/integrations');
        router.refresh();
        return;
      }
      setError(err?.response?.data?.error ?? 'Something went wrong. Please try again.');
      setLoading(false);
    }
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader className="pb-2">
        <span className="text-lg font-bold tracking-tight text-foreground">
          Create your workspace
        </span>
        <p className="text-sm text-muted-foreground">
          Give your organisation a name — you can invite teammates next.
        </p>
      </CardHeader>

      <CardContent className="pb-6">
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="org-name">Company or workspace name</Label>
            <Input
              id="org-name"
              type="text"
              required
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Acme Inc."
            />
          </div>

          {error ? <p className="text-sm text-destructive">{error}</p> : null}

          <Button type="submit" disabled={loading} className="w-full">
            {loading ? 'Creating…' : 'Create workspace'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
