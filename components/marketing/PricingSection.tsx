'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

const ANNUAL_DISCOUNT = 0.2;

interface Tier {
  name: string;
  monthlyPrice: number | null;
  priceSuffix: string;
  subtitle: string;
  features: string[];
  cta: { label: string; href: string };
  variant?: 'accent' | 'muted';
  badge?: string;
}

const TIERS: Tier[] = [
  {
    name: 'Free',
    monthlyPrice: 0,
    priceSuffix: '/ month',
    subtitle: 'For solo developers getting started',
    features: [
      '1 user only',
      'GitHub + Jira + Datadog',
      '50 AI queries per month',
      'Incident timeline view',
      'Breaking graph visualization',
      '30-day history',
      'Community support',
    ],
    cta: { label: 'Start free', href: '/login' },
  },
  {
    name: 'Pro',
    monthlyPrice: 29,
    priceSuffix: '/ user / month',
    subtitle: 'For individual engineers who need more power',
    features: [
      '1 user',
      'All integrations (+ Slack, PagerDuty, Linear)',
      'Unlimited AI queries',
      'Full incident timeline + breaking graph',
      '90-day history',
      'Priority email support',
      'API access (read-only)',
    ],
    cta: { label: 'Start free trial', href: '/login' },
  },
  {
    name: 'Max',
    monthlyPrice: 79,
    priceSuffix: '/ user / month',
    subtitle: 'For engineering teams',
    badge: 'Most popular',
    variant: 'accent',
    features: [
      'Up to 25 users',
      'Everything in Pro',
      'Team ownership graph',
      'Cross-team incident correlation',
      'Org-wide deployment history (180 days)',
      'Slack alert integration',
      'SSO (Google, GitHub)',
      'Dedicated Slack support channel',
    ],
    cta: { label: 'Start free trial', href: '/login' },
  },
  {
    name: 'Enterprise',
    monthlyPrice: null,
    priceSuffix: '',
    subtitle: 'For large engineering orgs',
    variant: 'muted',
    features: [
      'Unlimited users',
      'Everything in Max',
      'Custom data retention (up to 2 years)',
      'On-premise deployment option',
      'Custom integrations (JIRA, ServiceNow, etc.)',
      'SLA guarantees (99.9% uptime)',
      'Dedicated customer success manager',
      'Security review and SOC 2 report',
      'Custom contracts and invoicing',
    ],
    cta: { label: 'Talk to us', href: 'mailto:enterprise@graph.dev' },
  },
];

export default function PricingSection() {
  const [annual, setAnnual] = useState(false);

  return (
    <div>
      <div className="flex items-center justify-center mb-10">
        <div className="inline-flex items-center rounded-full border border-border bg-card p-1 text-sm">
          <button
            onClick={() => setAnnual(false)}
            className={cn(
              'px-4 py-1.5 rounded-full transition-colors',
              !annual ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            Monthly
          </button>
          <button
            onClick={() => setAnnual(true)}
            className={cn(
              'px-4 py-1.5 rounded-full transition-colors',
              annual ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            Annual <span className="opacity-80">(save 20%)</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {TIERS.map(tier => {
          const discounted =
            tier.monthlyPrice !== null ? Math.round(tier.monthlyPrice * (1 - ANNUAL_DISCOUNT)) : null;

          return (
            <div
              key={tier.name}
              className={cn(
                'relative rounded-xl p-6 flex flex-col bg-card',
                tier.variant === 'accent' ? 'border-2 border-primary' : 'border border-border',
                tier.variant === 'muted' && 'bg-accent/20'
              )}
            >
              {tier.badge && (
                <Badge className="absolute -top-3 left-1/2 -translate-x-1/2">{tier.badge}</Badge>
              )}

              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{tier.name}</p>

              <div className="mt-3 min-h-[36px] flex items-end gap-2">
                {tier.monthlyPrice === null ? (
                  <p className="text-[28px] font-medium text-foreground leading-none">Custom</p>
                ) : annual && tier.monthlyPrice > 0 ? (
                  <>
                    <p className="text-[28px] font-medium text-foreground leading-none">${discounted}</p>
                    <p className="text-sm text-muted-foreground line-through mb-0.5">${tier.monthlyPrice}</p>
                  </>
                ) : (
                  <p className="text-[28px] font-medium text-foreground leading-none">${tier.monthlyPrice}</p>
                )}
                {tier.priceSuffix && (
                  <span className="text-xs text-muted-foreground mb-1">{tier.priceSuffix}</span>
                )}
              </div>

              <p className="text-sm text-muted-foreground mt-2">{tier.subtitle}</p>

              <div className="border-t border-border my-5" />

              <ul className="flex flex-col gap-2.5 mb-6 flex-1">
                {tier.features.map(f => (
                  <li key={f} className="flex items-start gap-2 text-[13px] text-foreground">
                    <Check className="size-3.5 text-primary shrink-0 mt-0.5" />
                    {f}
                  </li>
                ))}
              </ul>

              <Button
                className="w-full"
                variant={tier.variant === 'accent' ? 'default' : 'outline'}
                asChild
              >
                {tier.cta.href.startsWith('mailto:') ? (
                  <a href={tier.cta.href}>{tier.cta.label}</a>
                ) : (
                  <Link href={tier.cta.href}>{tier.cta.label}</Link>
                )}
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
