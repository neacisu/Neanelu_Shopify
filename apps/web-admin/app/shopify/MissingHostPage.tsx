import { ExternalLink, Link2Off } from 'lucide-react';

import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader } from '../components/ui/card';
import { buildShopifyAdminAppUrl, isValidShopDomain } from './shopify-url';

export interface MissingHostPageProps {
  apiKey?: string;
  shop?: string | null;
}

export function MissingHostPage({ apiKey, shop }: MissingHostPageProps) {
  const canOpenInAdmin = Boolean(apiKey && shop && isValidShopDomain(shop));
  const adminUrl = canOpenInAdmin ? buildShopifyAdminAppUrl(shop!, apiKey!) : null;

  return (
    <Card variant="glass" padding="lg" className="mx-auto max-w-2xl">
      <CardHeader className="border-b-0 pb-0">
        <div className="inline-flex size-12 items-center justify-center rounded-xl bg-subtle text-muted">
          <Link2Off className="size-6" />
        </div>
        <div className="mt-4 text-caption text-muted">Embedded bootstrap</div>
        <h1 className="mt-1 text-h2">
          Lipsește parametrul Shopify <span className="font-mono">host</span>
        </h1>
        <p className="mt-2 text-body text-muted">
          Aplicația embedded trebuie deschisă din Shopify Admin (iframe). URL-ul trebuie să includă
          <span className="mx-1 font-mono">?host=...</span>
          (și de regulă <span className="font-mono">shop</span>).
        </p>
      </CardHeader>

      <CardContent className="mt-6">
        <Card padding="md" className="mb-4">
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
        </Card>

        <div className="flex flex-wrap items-center gap-3">
          {adminUrl ? (
            <Button
              variant="primary"
              onClick={() => {
                window.open(adminUrl, '_top');
              }}
            >
              <ExternalLink className="size-4" />
              Open in Shopify Admin
            </Button>
          ) : null}

          <div className="text-caption text-muted">
            Dacă ai ajuns aici după un click intern, înseamnă că navigația nu a păstrat query
            params.
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
