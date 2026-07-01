'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Network } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const NAV_LINKS = [
  { href: '#features', label: 'Features' },
  { href: '#how-it-works', label: 'How it works' },
  { href: '#pricing', label: 'Pricing' },
  { href: '#', label: 'Docs' },
];

export default function Navbar() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    function onScroll() {
      setScrolled(window.scrollY > 60);
    }
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header
      className={cn(
        'sticky top-0 z-50 border-b transition-colors',
        scrolled ? 'bg-background/80 backdrop-blur-md border-border shadow-sm' : 'bg-background border-transparent'
      )}
    >
      <div className="max-w-[1100px] mx-auto px-6 h-16 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2">
          <Network className="size-5 text-primary" strokeWidth={2} />
          <span className="text-base font-semibold tracking-tight text-foreground">Graph</span>
        </Link>

        <nav className="hidden md:flex items-center gap-8">
          {NAV_LINKS.map(link => (
            <a
              key={link.label}
              href={link.href}
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              {link.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" asChild>
            <Link href="/login">Sign in</Link>
          </Button>
          <Button size="sm" asChild>
            <Link href="/login?mode=signup">Start free</Link>
          </Button>
        </div>
      </div>
    </header>
  );
}
