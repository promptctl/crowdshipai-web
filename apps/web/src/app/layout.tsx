import type { Metadata } from 'next';
import Link from 'next/link';

import './globals.css';

export const metadata: Metadata = {
  title: 'CrowdShip — watch someone build',
  description: 'Live-streaming for building software. Builders build; backers fund what they want to see shipped.',
};

export default function RootLayout({ children }: { readonly children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen font-mono">
        <header className="sticky top-0 z-20 border-b border-edge bg-ink/85 backdrop-blur">
          <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-3">
            <Link href="/" className="group flex items-baseline gap-2">
              <span className="text-lg font-bold tracking-tight text-chalk">
                crowd<span className="text-accent">ship</span>
              </span>
              <span className="hidden text-xs text-fog group-hover:text-chalk sm:inline">// we build</span>
            </Link>
            <nav className="flex items-center gap-2 text-xs">
              <Link
                href="/"
                className="rounded-full px-3 py-1.5 text-fog transition-colors hover:bg-surface-2 hover:text-chalk"
              >
                browse
              </Link>
              <button
                type="button"
                className="rounded-full border border-accent-dim bg-accent/10 px-3 py-1.5 font-semibold text-accent transition-colors hover:bg-accent hover:text-ink"
              >
                go live
              </button>
            </nav>
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}
