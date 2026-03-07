import { useMemo } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';

import { Breadcrumbs } from '../components/layout/breadcrumbs';
import { InfoTooltip } from '../components/ui/info-tooltip';
import { PageHeader } from '../components/layout/page-header';
import { Tabs } from '../components/ui/tabs';

const tabs = [
  {
    label: (
      <span className="inline-flex items-center gap-1">
        General
        <InfoTooltip title="Setări generale" side="bottom" portalToBody>
          Configurarea de bază a magazinului: nume, domeniu, fus orar și limbă. Acestea determină
          cum se afișează datele în întreaga aplicație. De exemplu, fusul orar afectează programarea
          sincronizărilor. Sfat: setează fusul orar înainte de a programa orice sincronizare.
        </InfoTooltip>
      </span>
    ),
    value: 'general',
  },
  {
    label: (
      <span className="inline-flex items-center gap-1">
        API și Webhooks
        <InfoTooltip title="API și Webhooks Shopify" side="bottom" portalToBody>
          Conexiunea cu Shopify prin API și webhook-uri. Webhook-urile permit notificări în timp
          real la modificarea produselor sau comenzilor. De exemplu, la adăugarea unui produs nou,
          Shopify notifică automat aplicația. Sfat: verifică periodic starea conexiunii.
        </InfoTooltip>
      </span>
    ),
    value: 'api',
  },
  {
    label: (
      <span className="inline-flex items-center gap-1">
        Webhooks calitate
        <InfoTooltip title="Webhooks calitate PIM" side="bottom" portalToBody>
          Notificări automate pentru evenimente de calitate PIM: promovare, retrogradare, revizuire
          solicitată sau prag atins. Endpoint-ul tău primește un payload JSON semnat HMAC. De
          exemplu, poți trimite un Slack la fiecare Golden Record nou. Sfat: testează endpoint-ul
          înainte de activare.
        </InfoTooltip>
      </span>
    ),
    value: 'webhooks',
  },
  {
    label: (
      <span className="inline-flex items-center gap-1">
        Cozi
        <InfoTooltip title="Configurare cozi" side="bottom" portalToBody>
          Setările de procesare pentru cozile de job-uri: concurență, reîncercări, backoff și
          retenție erori. Cozile gestionează sincronizările, embedding-urile și scraping-ul. De
          exemplu, poți crește concurența pentru cozi rapide. Sfat: nu depăși 20 concurente fără
          confirmare.
        </InfoTooltip>
      </span>
    ),
    value: 'queues',
  },
  {
    label: (
      <span className="inline-flex items-center gap-1">
        OpenAI
        <InfoTooltip title="Setări OpenAI" side="bottom" portalToBody>
          Credențialele și parametrii pentru embedding-uri și căutare semantică. OpenAI transformă
          textul produselor în vectori pentru potriviri inteligente. De exemplu, „carcasă telefon"
          poate fi potrivit cu „husă smartphone". Sfat: testează conexiunea înainte de salvare.
        </InfoTooltip>
      </span>
    ),
    value: 'openai',
  },
  {
    label: (
      <span className="inline-flex items-center gap-1">
        Serper
        <InfoTooltip title="Setări Serper" side="bottom" portalToBody>
          Integrarea cu Serper API pentru căutarea externă de produse (Golden Record Stage 4).
          Serper caută pe Google informații suplimentare despre produse. De exemplu, găsește
          specificații tehnice pe site-urile producătorilor. Sfat: 2500 cereri gratuite lunar pe
          serper.dev.
        </InfoTooltip>
      </span>
    ),
    value: 'serper',
  },
  {
    label: (
      <span className="inline-flex items-center gap-1">
        xAI Grok
        <InfoTooltip title="Setări xAI Grok" side="bottom" portalToBody>
          Configurarea modelului Grok pentru AI Auditor și extracția structurată de date din pagini
          web. xAI analizează paginile scrappate și extrage specificații într-un format
          standardizat. De exemplu, extrage greutatea, dimensiunile și materialele. Sfat:
          temperatura 0.1 oferă cea mai bună consistență.
        </InfoTooltip>
      </span>
    ),
    value: 'xai',
  },
  {
    label: (
      <span className="inline-flex items-center gap-1">
        DeepSeek
        <InfoTooltip title="Setări DeepSeek" side="bottom" portalToBody>
          Configurarea modelului DeepSeek pentru AI Auditor și extracția structurată de date din
          pagini web. DeepSeek oferă modele foarte economice cu performanță competitivă. Sfat:
          DeepSeek V3.2 este cu până la 95% mai ieftin decât GPT-4o.
        </InfoTooltip>
      </span>
    ),
    value: 'deepseek',
  },
  {
    label: (
      <span className="inline-flex items-center gap-1">
        Google Gemini
        <InfoTooltip title="Setări Google Gemini" side="bottom" portalToBody>
          Configurarea modelului Gemini pentru AI Auditor, traducere, clasificare și generare de
          text. Gemini oferă modele multi-modale eficiente. De exemplu, Gemini 2.5 Flash oferă cel
          mai bun raport calitate/preț. Sfat: temperatura 0.1 oferă cea mai bună consistență.
        </InfoTooltip>
      </span>
    ),
    value: 'gemini',
  },
  {
    label: (
      <span className="inline-flex items-center gap-1">
        Self-hosted
        <InfoTooltip title="Setări Self-hosted" side="bottom" portalToBody>
          Configurarea endpointurilor vLLM/OpenAI-compatible din infrastructura internă. Acest tab
          gestionează endpointurile auditate live, model IDs exacte și starea conexiunii pentru
          rutarea locală a taskurilor AI. Sfat: endpointurile trebuie să folosească IP-uri RFC1918,
          nu hosturi publice.
        </InfoTooltip>
      </span>
    ),
    value: 'selfhosted',
  },
  {
    label: (
      <span className="inline-flex items-center gap-1">
        Scraper
        <InfoTooltip title="Setări Scraper" side="bottom" portalToBody>
          Configurarea scraper-ului Playwright pentru extragerea datelor din pagini web JS-heavy.
          Respectă automat robots.txt (RFC 9309) și aplică limitare de rată pe domeniu. De exemplu,
          poate accesa pagini SPA care necesită randare completă. Sfat: 1-2 cereri/sec e sigur
          pentru majoritatea site-urilor.
        </InfoTooltip>
      </span>
    ),
    value: 'scraper',
  },
];

function resolveActiveTab(pathname: string): string {
  const segments = pathname.split('/').filter(Boolean);
  const last = segments.at(-1) ?? 'general';
  if (last === 'settings') return 'general';
  if (tabs.some((tab) => tab.value === last)) return last;
  return 'general';
}

export default function SettingsLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const activeTab = useMemo(() => resolveActiveTab(location.pathname), [location.pathname]);

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: 'Setări', href: '/settings' }]} />
      <PageHeader
        title="Setări"
        description="Preferințe magazin, conexiune Shopify, webhooks, cozi și credențiale servicii externe."
        actions={
          <InfoTooltip title="Setări aplicație" side="bottom" portalToBody>
            Aici configurezi tot ce este necesar pentru funcționarea aplicației. Secțiunea acoperă
            informații magazin, conexiune Shopify, webhooks PIM, cozi de procesare și credențiale
            pentru servicii externe (OpenAI, Serper, xAI, Scraper). De exemplu, fără cheie OpenAI,
            căutarea semantică nu va funcționa. Sfat: parcurge fiecare tab în ordine la prima
            configurare.
          </InfoTooltip>
        }
      />
      <Tabs
        items={tabs}
        value={activeTab}
        onValueChange={(value) => {
          void navigate(`/settings/${value}`);
        }}
        ariaLabel="Secțiuni setări"
      />
      <Outlet />
    </div>
  );
}
