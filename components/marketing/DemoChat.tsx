'use client';

import { useEffect, useState } from 'react';

const USER_1 = 'Why did checkout fail last night?';

const AI_1 = `Deployment v1.4.2 at 23:14 triggered the incident (confidence 91%).

PR #421 "Update Stripe validation logic" was authored by Alice Chen and merged at 22:58. Alice owns checkout-service (82% of commits).

Datadog alert "checkout.error_rate >5%" fired at 23:17, 3 minutes after the deployment. Jira incident INC-891 was created and assigned to Alice.

Rollback PR #430 by Bob Kim resolved the incident at 01:22.`;

const USER_2 = 'Who else could fix this if Alice is unavailable?';

const AI_2 = `Bob Kim has reviewed 60% of Alice's PRs on checkout-service and is the next most familiar engineer with this codebase.`;

const TYPE_DELAY_MS = 30;
const AFTER_AI_1_PAUSE_MS = 1200;
const BEFORE_USER_2_PAUSE_MS = 600;
const LOOP_PAUSE_MS = 3000;

type Step = 'idle' | 'user1' | 'typing1' | 'done1' | 'user2' | 'typing2' | 'done2';

function sleep(ms: number) {
  return new Promise<void>(resolve => setTimeout(resolve, ms));
}

export default function DemoChat() {
  const [step, setStep] = useState<Step>('idle');
  const [typed1, setTyped1] = useState('');
  const [typed2, setTyped2] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function typeInto(text: string, setter: (v: string) => void) {
      for (let i = 1; i <= text.length; i++) {
        if (cancelled) return;
        setter(text.slice(0, i));
        await sleep(TYPE_DELAY_MS);
      }
    }

    async function run() {
      while (!cancelled) {
        setStep('user1');
        setTyped1('');
        setTyped2('');
        await sleep(500);
        if (cancelled) return;

        setStep('typing1');
        await typeInto(AI_1, setTyped1);
        if (cancelled) return;

        setStep('done1');
        await sleep(AFTER_AI_1_PAUSE_MS);
        if (cancelled) return;

        setStep('user2');
        await sleep(BEFORE_USER_2_PAUSE_MS);
        if (cancelled) return;

        setStep('typing2');
        await typeInto(AI_2, setTyped2);
        if (cancelled) return;

        setStep('done2');
        await sleep(LOOP_PAUSE_MS);
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, []);

  const showUser1 = step !== 'idle';
  const showAi1 = step !== 'idle' && step !== 'user1';
  const isTyping1 = step === 'typing1';
  const showPills = step === 'done1' || step === 'user2' || step === 'typing2' || step === 'done2';
  const showUser2 = step === 'user2' || step === 'typing2' || step === 'done2';
  const showAi2 = step === 'typing2' || step === 'done2';
  const isTyping2 = step === 'typing2';

  return (
    <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
      <div className="border-b border-border px-5 py-3.5">
        <p className="text-sm font-semibold text-foreground">AI Incident Investigation</p>
        <p className="text-xs text-muted-foreground">Ask anything about your incidents, deployments, or engineers.</p>
      </div>

      <div className="p-6 flex flex-col gap-4 min-h-[380px] justify-start">
        {showUser1 && (
          <div className="flex justify-end">
            <div className="max-w-[80%] rounded-2xl rounded-br-sm bg-primary text-primary-foreground px-4 py-2.5 text-sm">
              {USER_1}
            </div>
          </div>
        )}

        {showAi1 && (
          <div className="flex justify-start">
            <div className="max-w-[85%] rounded-2xl rounded-bl-sm bg-muted px-4 py-3 text-sm text-foreground whitespace-pre-line leading-relaxed">
              {typed1}
              {isTyping1 && <span className="inline-block w-[2px] h-4 -mb-0.5 bg-foreground/60 animate-pulse ml-0.5" />}
            </div>
          </div>
        )}

        {showPills && (
          <div className="flex flex-wrap gap-2 pl-1">
            <SourcePill type="Deployment" label="v1.4.2" />
            <SourcePill type="PR" label="#421 by Alice" />
            <SourcePill type="Incident" label="INC-891" />
          </div>
        )}

        {showUser2 && (
          <div className="flex justify-end">
            <div className="max-w-[80%] rounded-2xl rounded-br-sm bg-primary text-primary-foreground px-4 py-2.5 text-sm">
              {USER_2}
            </div>
          </div>
        )}

        {showAi2 && (
          <div className="flex justify-start">
            <div className="max-w-[85%] rounded-2xl rounded-bl-sm bg-muted px-4 py-3 text-sm text-foreground whitespace-pre-line leading-relaxed">
              {typed2}
              {isTyping2 && <span className="inline-block w-[2px] h-4 -mb-0.5 bg-foreground/60 animate-pulse ml-0.5" />}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function SourcePill({ type, label }: { type: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-2.5 py-1 text-xs text-muted-foreground">
      <span className="font-medium text-foreground">{type}</span>
      {label}
    </span>
  );
}
