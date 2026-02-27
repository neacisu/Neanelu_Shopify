import type { PropsWithChildren } from 'react';
import { useEffect, useMemo, useState } from 'react';
import {
  ChevronLeft,
  Command,
  Cpu,
  LayoutDashboard,
  Menu,
  Moon,
  Package,
  Search,
  Settings,
  Sun,
  UserRound,
  Workflow,
} from 'lucide-react';

import { NavLink } from './nav-link';
import { ShopSelector } from './shop-selector';
import { usePendingSimilarityMatchCount } from '../../hooks/use-similarity-matches';
import { NotificationBell } from './notification-bell';
import { InfoTooltip } from '../ui/info-tooltip';
import { CommandPalette } from './command-palette';

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
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem('neanelu.sidebar.collapsed') === '1';
  });
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [darkMode, setDarkMode] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    const saved = window.localStorage.getItem('neanelu.theme');
    if (saved === 'dark') return true;
    if (saved === 'light') return false;
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });

  const isControlled = controlledSidebarOpen !== undefined;
  const sidebarOpen = isControlled ? controlledSidebarOpen : uncontrolledOpen;
  const pendingSimilarityCount = usePendingSimilarityMatchCount();

  useEffect(() => {
    window.localStorage.setItem('neanelu.sidebar.collapsed', sidebarCollapsed ? '1' : '0');
  }, [sidebarCollapsed]);

  useEffect(() => {
    window.localStorage.setItem('neanelu.theme', darkMode ? 'dark' : 'light');
    document.documentElement.classList.toggle('dark', darkMode);
    document.documentElement.classList.toggle('light', !darkMode);
  }, [darkMode]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const isMeta = event.metaKey || event.ctrlKey;
      if (isMeta && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen((value) => !value);
      }
      if (event.key === 'Escape') setPaletteOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const toggleSidebar = () => {
    onSidebarToggle?.();
    if (!isControlled) setUncontrolledOpen((value) => !value);
  };

  const navItems: NavItem[] = useMemo(
    () => [
      {
        to: '/',
        label: 'Panou principal',
        icon: LayoutDashboard,
        tooltip:
          'Pagina principală de monitorizare: vezi numărul de produse sincronizate din Shopify, câte procese în masă sunt active, rata de erori API și timpul de răspuns. Un grafic arată activitatea pe ultimele 7 zile. Acțiunile rapide sunt: Reconciliere Webhooks (recreează notificările lipsă către Shopify), Verificare Sănătate Sistem și Golire Cache — nu există aici buton pentru pornirea unei sincronizări complete de produse; pentru aceasta folosești pagina Ingestion.',
      },
      {
        to: '/queues',
        label: 'Cozi',
        icon: Cpu,
        tooltip:
          'Monitorizarea cozilor de job-uri: vezi toate cozile (sincronizare, webhooks, îmbogățiri etc.), câte job-uri sunt în așteptare, active sau eșuate. Poți pune coada pe pauză, o poți reporni, șterge job-urile eșuate sau relansa, promova și șterge job-uri individuale. Tab-ul „Workeri” arată ce procesoare sunt conectate.',
      },
      {
        to: '/ingestion',
        label: 'Ingestie',
        icon: Workflow,
        tooltip:
          'Sincronizarea în masă a catalogului cu Shopify: pornești o exportare completă de produse din Shopify și urmărești progresul în timp real (descărcare, parsare, încărcare în baza de date), sau încarci manual un fișier JSONL. Din această pagină ajungi și la istoricul rulărilor și la programarea sincronizărilor.',
      },
      {
        to: '/search',
        label: 'Căutare',
        icon: Search,
        tooltip:
          'Căutare semantică în produse: introduci o frază în limbaj natural și aplicația găsește produse după semnificație (nu doar după cuvinte exacte). Poți filtra după furnizor, tip produs, preț și categorie, ajusta pragul de relevanță și numărul de rezultate, și exporta rezultatele. Util pentru a vedea cum „înțelege” catalogul aplicația.',
      },
      {
        to: '/products',
        label: 'Produse',
        icon: Package,
        tooltip:
          'Lista și gestionarea produselor din magazin: vezi toate produsele sincronizate, filtrezi și cauți (exact sau semantic), deschizi detaliile într-un panou lateral, editezi, compari produse, asignezi categorii sau le adaugi în colecții. Poți face acțiuni în masă și export.',
      },
      {
        to: '/pim',
        label: 'PIM',
        icon: LayoutDashboard,
        tooltip:
          'Centrul de informații despre calitatea datelor produs: vezi cum sunt clasificate produsele (bronze, silver, golden, review), progresul pipeline-ului de îmbogățire, performanța surselor de date și sincronizarea cu canalele. Tab-urile duc la detalii despre calitate, îmbogățire, costuri, evenimente și consens.',
      },
      {
        to: '/products/review',
        label: 'Coada review',
        icon: Workflow,
        tooltip:
          'Coada de revizuiri umane: elemente care necesită confirmarea ta — fie potriviri între produsul tău și o sursă externă (confirmi sau respingi potrivirea), fie propuneri noi de atribute generate de sistem (aprobare sau respingere). Tab-ul „Coada HITL” este pentru cazuri trimise explicit pentru decizie umană.',
      },
      {
        to: '/similarity-matches',
        label: 'Potriviri similare',
        icon: Search,
        ...(pendingSimilarityCount && pendingSimilarityCount > 0
          ? { badge: pendingSimilarityCount }
          : {}),
        tooltip:
          'Potrivirile găsite între produsele tale și surse externe: aplicația identifică produse din alte surse care par să fie același produs. Aici revizuiești aceste potriviri, le confirmi sau le respingi, poți marca o sursă ca principală sau porni o extracție de atribute. Numărul din badge arată câte potriviri sunt în așteptare. Tab-urile filtrează după stare: Toate, În așteptare, AI Audit, HITL, Confirmate, Respinse.',
      },
      {
        to: '/settings',
        label: 'Setări',
        icon: Settings,
        tooltip:
          'Setările aplicației și ale magazinului: General, conexiunea cu Shopify (API și Webhooks), configurarea webhook-urilor, setări pentru cozi, și credențiale pentru serviciile folosite (OpenAI, Serper, xAI Grok, Scraper). Aici configurezi tot ce este necesar pentru ca aplicația să funcționeze cu magazinul tău și cu serviciile externe.',
      },
    ],
    [pendingSimilarityCount]
  );

  const commandItems = useMemo(
    () =>
      navItems.map((item) => ({
        id: item.to,
        label: item.label,
        description: item.tooltipTitle ?? 'Navigare rapidă',
        to: item.to,
      })),
    [navItems]
  );

  return (
    <div className="flex h-screen min-h-0 flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:text-body focus:shadow-md"
      >
        Sari la conținut
      </a>

      <div
        className={`grid min-h-0 flex-1 grid-cols-1 ${
          sidebarCollapsed ? 'md:grid-cols-[76px_1fr]' : 'md:grid-cols-[280px_1fr]'
        }`}
      >
        <aside
          className={
            'h-full min-h-0 flex-col border-r border-slate-200/90 bg-white/90 shadow-[var(--shadow-sm)] backdrop-blur-xl transition-[width] duration-300 md:flex dark:border-slate-700/90 dark:bg-slate-900/90 ' +
            (sidebarOpen ? 'flex' : 'hidden')
          }
        >
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <nav role="navigation" className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <div className="shrink-0 p-4 pb-2">
                <div
                  className={`text-lg font-semibold tracking-tight text-slate-800 transition-opacity dark:text-slate-100 ${
                    sidebarCollapsed ? 'opacity-0' : 'opacity-100'
                  }`}
                >
                  Neanelu
                </div>
                <div
                  className={`mt-0.5 text-xs text-slate-500 transition-opacity dark:text-slate-400 ${
                    sidebarCollapsed ? 'opacity-0' : 'opacity-100'
                  }`}
                >
                  Shopify Manager
                </div>
              </div>
              <div
                className={`min-h-0 flex-1 overflow-y-auto py-2 ${sidebarCollapsed ? 'px-2' : 'px-3'}`}
              >
                <div className="flex flex-col gap-0.5">
                  {navItems.map((item, index) => (
                    <div
                      key={item.to}
                      className="animate-sidebar-link-enter opacity-0"
                      style={{ animationDelay: `${index * 35}ms` }}
                    >
                      <NavLink
                        to={item.to}
                        compact={sidebarCollapsed}
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
          <footer className="shrink-0 border-t border-slate-200/80 bg-slate-50/70 px-3 py-2 dark:border-slate-700/80 dark:bg-slate-800/70">
            <div className="flex flex-col gap-2">
              {!sidebarCollapsed ? (
                <>
                  <div className="rounded-lg border border-slate-200/80 bg-white px-2.5 py-2 shadow-[var(--shadow-sm)] transition-all duration-200 hover:border-slate-300/80 hover:shadow-[var(--shadow-sm)] dark:border-slate-700/80 dark:bg-slate-800 dark:hover:border-slate-600/80">
                    <ShopSelector compact />
                  </div>
                  <div className="flex justify-end">
                    <InfoTooltip title="Selector magazin">
                      Alege magazinul activ dacă gestionezi mai multe magazine. Toate datele din
                      aplicație se actualizează după selecția ta.
                    </InfoTooltip>
                  </div>
                  <div className="group/user flex items-center gap-2 rounded-lg border border-slate-200/80 bg-white px-2.5 py-2 shadow-[var(--shadow-sm)] transition-all duration-200 hover:border-slate-300/80 hover:shadow-[var(--shadow-sm)] dark:border-slate-700/80 dark:bg-slate-800 dark:hover:border-slate-600/80">
                    <div
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500 transition-colors duration-200 group-hover/user:bg-blue-50 group-hover/user:text-blue-600 dark:bg-slate-700 dark:text-slate-400 dark:group-hover/user:bg-blue-900/30 dark:group-hover/user:text-blue-400"
                      aria-hidden
                    >
                      <UserRound className="size-3.5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-[10px] font-medium uppercase tracking-wider text-slate-400 dark:text-slate-500">
                        Utilizator
                      </div>
                      <div className="truncate text-xs font-medium text-slate-700 dark:text-slate-200">
                        Admin
                      </div>
                    </div>
                  </div>
                  <div className="flex justify-end">
                    <InfoTooltip title="Cont utilizator">
                      Aici vezi utilizatorul conectat în sesiunea curentă. În următoarele etape,
                      acest card va include și opțiuni de profil/sesiune.
                    </InfoTooltip>
                  </div>
                </>
              ) : (
                <div className="flex justify-center">
                  <div className="rounded-lg border border-slate-200/80 bg-white p-2 shadow-[var(--shadow-sm)] dark:border-slate-700/80 dark:bg-slate-800">
                    <UserRound className="size-4 text-slate-500 dark:text-slate-400" />
                  </div>
                </div>
              )}
            </div>
          </footer>
        </aside>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <header className="shrink-0 border-b border-slate-200/90 bg-white shadow-[var(--shadow-sm)] dark:border-slate-700 dark:bg-slate-900">
            <div className="flex items-center justify-between gap-3 px-4 py-3">
              <button
                type="button"
                className="inline-flex items-center gap-2 rounded-lg border border-slate-200/90 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-[var(--shadow-sm)] transition-all duration-200 hover:bg-slate-50 hover:shadow-[var(--shadow-sm)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--color-ring))]/40 focus-visible:ring-offset-2 md:hidden dark:border-slate-700/90 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                onClick={toggleSidebar}
                aria-label="Deschide meniul"
              >
                <Menu className="size-4" />
                Meniu
              </button>
              <div className="md:hidden">
                <InfoTooltip title="Meniu mobil">
                  Deschide meniul principal al aplicației pe ecrane mici. Aici găsești acces rapid
                  la toate paginile importante.
                </InfoTooltip>
              </div>

              <div className="min-w-0 flex-1 md:flex-none">
                <div className="hidden items-center gap-2 md:flex">
                  <InfoTooltip title="Colapsare meniu">
                    Micșorează/extinde meniul lateral pentru mai mult spațiu de lucru pe desktop.
                  </InfoTooltip>
                  <button
                    type="button"
                    className="inline-flex items-center rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-slate-600 shadow-[var(--shadow-xs)] transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--color-ring))]/40 focus-visible:ring-offset-2 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700"
                    onClick={() => setSidebarCollapsed((value) => !value)}
                    aria-label="Colapsează meniul lateral"
                  >
                    <ChevronLeft
                      className={`size-4 transition-transform ${sidebarCollapsed ? 'rotate-180' : ''}`}
                    />
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="hidden items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs font-medium text-slate-600 shadow-[var(--shadow-xs)] transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--color-ring))]/40 focus-visible:ring-offset-2 md:inline-flex dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700"
                  onClick={() => setPaletteOpen(true)}
                  aria-label="Deschide Command Palette"
                >
                  <Command className="size-3.5" />
                  Căutare
                </button>
                <InfoTooltip title="Mod culoare">
                  Comută între temă luminoasă și temă întunecată. Preferința este păstrată pentru
                  sesiunea următoare.
                </InfoTooltip>
                <button
                  type="button"
                  className="inline-flex items-center rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-slate-600 shadow-[var(--shadow-xs)] transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--color-ring))]/40 focus-visible:ring-offset-2 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700"
                  onClick={() => setDarkMode((value) => !value)}
                  aria-label="Comută tema"
                >
                  {darkMode ? <Sun className="size-4" /> : <Moon className="size-4" />}
                </button>
                <InfoTooltip title="Notificări">
                  Aici vezi alertele importante ale aplicației: evenimente noi, procese finalizate
                  și probleme care necesită atenție.
                </InfoTooltip>
                <NotificationBell />
              </div>
            </div>
          </header>

          <main id="main" className="min-w-0 flex-1 overflow-y-auto p-4 dark:bg-slate-950">
            {children}
          </main>
        </div>
      </div>

      {sidebarOpen ? (
        <button
          type="button"
          className="fixed inset-0 z-40 bg-foreground/30 md:hidden"
          onClick={toggleSidebar}
          aria-label="Închide suprapunerea meniului"
        />
      ) : null}

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        items={commandItems}
      />
    </div>
  );
}
