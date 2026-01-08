import { ExternalLink, Link2Off } from 'lucide-react';

import { buildShopifyAdminAppUrl, isValidShopDomain } from './shopify-url';

export interface MissingHostPageProps {
  apiKey?: string;
  shop?: string | null;
}

export function MissingHostPage({ apiKey, shop }: MissingHostPageProps) {
  const canOpenInAdmin = Boolean(apiKey && shop && isValidShopDomain(shop));
  const adminUrl = canOpenInAdmin ? buildShopifyAdminAppUrl(shop!, apiKey!) : null;

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="inline-flex size-12 items-center justify-center rounded-xl bg-muted/10 text-muted">
        <Link2Off className="size-6" />
      </div>

      <div>
        <div className="text-caption text-muted">Embedded bootstrap</div>
        <h1 className="mt-1 text-h2">
          Lipsește parametrul Shopify <span className="font-mono">host</span>
        </h1>
        <p className="mt-2 text-body text-muted">
          Aplicația embedded trebuie deschisă din Shopify Admin (iframe). URL-ul trebuie să includă
          <span className="mx-1 font-mono">?host=...</span>
          (și de regulă <span className="font-mono">shop</span>).
        </p>
      </div>

      <div className="rounded-md border border-muted/20 bg-background p-4 text-body">
        <div className="text-caption text-muted">Detalii</div>
        <div className="mt-1 flex flex-col gap-1">
          <div>
            <span className="text-muted">shop:</span>{' '}
            <span className="font-mono">{shop ?? '—'}</span>
          </div>
          <div>
            <span className="text-muted">apiKey:</span>{' '}
            <span className="font-mono">{apiKey ?? '—'}</span>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {adminUrl ? (
          <a
            href={adminUrl}
            target="_top"
            rel="noreferrer"
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-body text-background shadow-sm hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            <ExternalLink className="size-4" />
            Open in Shopify Admin
          </a>
        ) : null}

        <div className="text-caption text-muted">
          Dacă ai ajuns aici după un click intern, înseamnă că navigația nu a păstrat query params.
        </div>
      </div>
    </div>
  );
}
