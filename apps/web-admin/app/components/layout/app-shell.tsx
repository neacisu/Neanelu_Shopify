import type { PropsWithChildren } from 'react';
import { useMemo, useState } from 'react';
import {
  Cpu,
  LayoutDashboard,
  Menu,
  Package,
  Search,
  Settings,
  UserRound,
  Workflow,
} from 'lucide-react';

import { NavLink } from './nav-link';
import { ShopSelector } from './shop-selector';
import { usePendingSimilarityMatchCount } from '../../hooks/use-similarity-matches';
import { NotificationBell } from './notification-bell';

export type AppShellProps = PropsWithChildren<{
  sidebarOpen?: boolean;
  onSidebarToggle?: () => void;
}>;

interface NavItem {
  to: string;
  label: string;
  icon?: Parameters<typeof NavLink>[0]['icon'];
  badge?: Parameters<typeof NavLink>[0]['badge'];
  /** Detailed, non-technical explanation for new users. */
  tooltip?: string;
  tooltipTitle?: string;
}

export function AppShell({
  children,
  sidebarOpen: controlledSidebarOpen,
  onSidebarToggle,
}: AppShellProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);

  const isControlled = controlledSidebarOpen !== undefined;
  const sidebarOpen = isControlled ? controlledSidebarOpen : uncontrolledOpen;
  const pendingSimilarityCount = usePendingSimilarityMatchCount();

  const toggleSidebar = () => {
    onSidebarToggle?.();
    if (!isControlled) setUncontrolledOpen((value) => !value);
  };

  const navItems: NavItem[] = useMemo(
    () => [
      {
        to: '/',
        label: 'Dashboard',
        icon: LayoutDashboard,
        tooltip:
          'Pagina principală de monitorizare: vezi numărul de produse sincronizate din Shopify, câte procese în masă sunt active, rata de erori API și timpul de răspuns. Un grafic arată activitatea pe ultimele 7 zile. Acțiunile rapide sunt: Reconciliere Webhooks (recreează notificările lipsă către Shopify), Verificare Sănătate Sistem și Golire Cache — nu există aici buton pentru pornirea unei sincronizări complete de produse; pentru aceasta folosești pagina Ingestion.',
      },
      {
        to: '/queues',
        label: 'Queues',
        icon: Cpu,
        tooltip:
          'Monitorizarea cozilor de job-uri: vezi toate cozile (sincronizare, webhooks, îmbogățiri etc.), câte job-uri sunt în așteptare, active sau eșuate. Poți pune coada pe pauză, o poți reporni, șterge job-urile eșuate sau relansa, promova și șterge job-uri individuale. Tab-ul „Workeri” arată ce procesoare sunt conectate.',
      },
      {
        to: '/ingestion',
        label: 'Ingestion',
        icon: Workflow,
        tooltip:
          'Sincronizarea în masă a catalogului cu Shopify: pornești o exportare completă de produse din Shopify și urmărești progresul în timp real (descărcare, parsare, încărcare în baza de date), sau încarci manual un fișier JSONL. Din această pagină ajungi și la istoricul rulărilor și la programarea sincronizărilor.',
      },
      {
        to: '/search',
        label: 'Search',
        icon: Search,
        tooltip:
          'Căutare semantică în produse: introduci o frază în limbaj natural și aplicația găsește produse după semnificație (nu doar după cuvinte exacte). Poți filtra după furnizor, tip produs, preț și categorie, ajusta pragul de relevanță și numărul de rezultate, și exporta rezultatele. Util pentru a vedea cum „înțelege” catalogul aplicația.',
      },
      {
        to: '/products',
        label: 'Products',
        icon: Package,
        tooltip:
          'Lista și gestionarea produselor din magazin: vezi toate produsele sincronizate, filtrezi și cauți (exact sau semantic), deschizi detaliile într-un panou lateral, editezi, compari produse, asignezi categorii sau le adaugi în colecții. Poți face acțiuni în masă și export.',
      },
      {
        to: '/pim',
        label: 'PIM Dashboard',
        icon: LayoutDashboard,
        tooltip:
          'Centrul de informații despre calitatea datelor produs: vezi cum sunt clasificate produsele (bronze, silver, golden, review), progresul pipeline-ului de îmbogățire, performanța surselor de date și sincronizarea cu canalele. Tab-urile duc la detalii despre calitate, îmbogățire, costuri, evenimente și consens.',
      },
      {
        to: '/products/review',
        label: 'Review Queue',
        icon: Workflow,
        tooltip:
          'Coada de revizuiri umane: elemente care necesită confirmarea ta — fie potriviri între produsul tău și o sursă externă (confirmi sau respingi potrivirea), fie propuneri noi de atribute generate de sistem (aprobare sau respingere). Tab-ul „Coada HITL” este pentru cazuri trimise explicit pentru decizie umană.',
      },
      {
        to: '/similarity-matches',
        label: 'Similarity Matches',
        icon: Search,
        ...(pendingSimilarityCount && pendingSimilarityCount > 0
          ? { badge: pendingSimilarityCount }
          : {}),
        tooltip:
          'Potrivirile găsite între produsele tale și surse externe: aplicația identifică produse din alte surse care par să fie același produs. Aici revizuiești aceste potriviri, le confirmi sau le respingi, poți marca o sursă ca principală sau porni o extracție de atribute. Numărul din badge arată câte potriviri sunt în așteptare. Tab-urile filtrează după stare: Toate, În așteptare, AI Audit, HITL, Confirmate, Respinse.',
      },
      {
        to: '/settings',
        label: 'Settings',
        icon: Settings,
        tooltip:
          'Setările aplicației și ale magazinului: General, conexiunea cu Shopify (API și Webhooks), configurarea webhook-urilor, setări pentru cozi, și credențiale pentru serviciile folosite (OpenAI, Serper, xAI Grok, Scraper). Aici configurezi tot ce este necesar pentru ca aplicația să funcționeze cu magazinul tău și cu serviciile externe.',
      },
    ],
    [pendingSimilarityCount]
  );

  return (
    <div className="flex h-screen min-h-0 flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:text-body focus:shadow-md"
      >
        Skip to content
      </a>

      <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[280px_1fr]">
        <aside
          className={
            'h-full min-h-0 flex-col border-r border-slate-200/90 bg-white shadow-[var(--shadow-sm)] md:flex ' +
            (sidebarOpen ? 'flex' : 'hidden')
          }
        >
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <nav role="navigation" className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <div className="shrink-0 p-4 pb-2">
                <div className="text-lg font-semibold tracking-tight text-slate-800">Neanelu</div>
                <div className="mt-0.5 text-xs text-slate-500">Shopify Manager</div>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
                <div className="flex flex-col gap-0.5">
                  {navItems.map((item, index) => (
                    <div
                      key={item.to}
                      className="animate-sidebar-link-enter opacity-0"
                      style={{ animationDelay: `${index * 35}ms` }}
                    >
                      <NavLink
                        to={item.to}
                        {...(item.icon ? { icon: item.icon } : {})}
                        {...(item.badge !== undefined ? { badge: item.badge } : {})}
                        {...(item.tooltip
                          ? { tooltip: item.tooltip, tooltipTitle: item.tooltipTitle }
                          : {})}
                      >
                        {item.label}
                      </NavLink>
                    </div>
                  ))}
                </div>
              </div>
            </nav>
          </div>
          <footer className="shrink-0 border-t border-slate-200/80 bg-slate-50/70 px-3 py-2">
            <div className="flex flex-col gap-2">
              <div className="rounded-lg border border-slate-200/80 bg-white px-2.5 py-2 shadow-[var(--shadow-sm)] transition-all duration-200 hover:border-slate-300/80 hover:shadow-[var(--shadow-sm)]">
                <ShopSelector compact />
              </div>
              <div className="group/user flex items-center gap-2 rounded-lg border border-slate-200/80 bg-white px-2.5 py-2 shadow-[var(--shadow-sm)] transition-all duration-200 hover:border-slate-300/80 hover:shadow-[var(--shadow-sm)]">
                <div
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500 transition-colors duration-200 group-hover/user:bg-blue-50 group-hover/user:text-blue-600"
                  aria-hidden
                >
                  <UserRound className="size-3.5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[10px] font-medium uppercase tracking-wider text-slate-400">
                    Utilizator
                  </div>
                  <div className="truncate text-xs font-medium text-slate-700">Admin</div>
                </div>
              </div>
            </div>
          </footer>
        </aside>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <header className="shrink-0 border-b border-slate-200/90 bg-white shadow-[var(--shadow-sm)]">
            <div className="flex items-center justify-between gap-3 px-4 py-3">
              <button
                type="button"
                className="inline-flex items-center gap-2 rounded-lg border border-slate-200/90 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-[var(--shadow-sm)] transition-all duration-200 hover:bg-slate-50 hover:shadow-[var(--shadow-sm)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 md:hidden"
                onClick={toggleSidebar}
                aria-label="Deschide meniul"
              >
                <Menu className="size-4" />
                Meniu
              </button>

              <div className="min-w-0 flex-1 md:flex-none" />

              <div className="flex items-center gap-2">
                <NotificationBell />
              </div>
            </div>
          </header>

          <main id="main" className="min-w-0 flex-1 overflow-y-auto p-4">
            {children}
          </main>
        </div>
      </div>

      {sidebarOpen ? (
        <button
          type="button"
          className="fixed inset-0 z-40 bg-foreground/30 md:hidden"
          onClick={toggleSidebar}
          aria-label="Close sidebar overlay"
        />
      ) : null}
    </div>
  );
}
