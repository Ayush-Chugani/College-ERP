'use client';

import { BookOpen, BookText, CalendarCheck, ClipboardCheck, ClipboardList, Briefcase, CalendarDays, Building2, ChevronRight, GraduationCap, LayoutDashboard, LogOut, Settings } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Button } from '@/components/ui/button';
import type { NavItem } from '@/lib/nav';
import { cn } from '@/lib/utils';

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  '/dashboard': LayoutDashboard,
  '/students': GraduationCap,
  '/admissions': ClipboardList,
  '/registration': ClipboardCheck,
  '/attendance': CalendarCheck,
  '/employees': Briefcase,
  '/structure': Building2,
  '/calendar': CalendarDays,
  '/curriculum': BookOpen,
  '/courses': BookText,
  '/settings': Settings,
};

function Breadcrumbs({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  const current = items.find((i) => pathname === i.href || pathname.startsWith(i.href + '/'));
  const detail = current && pathname !== current.href;
  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-sm text-muted-foreground">
      <span>SIMS</span>
      {current && (
        <>
          <ChevronRight className="h-4 w-4" aria-hidden />
          {detail ? (
            <Link href={current.href} className="hover:underline">
              {current.label}
            </Link>
          ) : (
            <span aria-current="page" className="text-foreground">
              {current.label}
            </span>
          )}
        </>
      )}
      {detail && (
        <>
          <ChevronRight className="h-4 w-4" aria-hidden />
          <span aria-current="page" className="text-foreground">
            Details
          </span>
        </>
      )}
    </nav>
  );
}

export function AppShell({
  nav,
  user,
  children,
}: {
  nav: NavItem[];
  user: { name: string; role: string };
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const active = (href: string) => pathname === href || pathname.startsWith(href + '/');
  return (
    <div className="min-h-screen md:flex">
      <aside className="hidden w-60 shrink-0 border-r border-border bg-card md:block" aria-label="Primary">
        <div className="px-5 py-4 text-lg font-semibold tracking-tight">SIMS</div>
        <nav className="space-y-1 px-3">
          {nav.map((item) => {
            const Icon = ICONS[item.href] ?? LayoutDashboard;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active(item.href) ? 'page' : undefined}
                className={cn(
                  'flex items-center gap-3 rounded-md px-3 py-2 text-sm hover:bg-muted',
                  active(item.href) && 'bg-muted font-medium text-primary',
                )}
              >
                <Icon className="h-4 w-4" aria-hidden />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-4 border-b border-border bg-card px-4 py-3 md:px-6">
          <Breadcrumbs items={nav} />
          <div className="flex items-center gap-3">
            <div className="hidden text-right text-sm leading-tight sm:block">
              <div className="font-medium">{user.name}</div>
              <div className="text-xs text-muted-foreground">{user.role}</div>
            </div>
            <form action="/auth/signout" method="post">
              <Button type="submit" variant="outline" aria-label="Sign out">
                <LogOut className="h-4 w-4" aria-hidden />
                <span className="hidden sm:inline">Sign out</span>
              </Button>
            </form>
          </div>
        </header>
        <nav className="flex gap-1 overflow-x-auto border-b border-border bg-card px-3 py-2 md:hidden" aria-label="Primary mobile">
          {nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active(item.href) ? 'page' : undefined}
              className={cn('whitespace-nowrap rounded-md px-3 py-1.5 text-sm hover:bg-muted', active(item.href) && 'bg-muted font-medium text-primary')}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <main className="flex-1 p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
