import { useEffect, useState } from 'react';

import { Button } from '../ui/button';
import { InfoTooltip } from '../ui/info-tooltip';
import { Select, type SelectOption } from '../ui/select';

type WebhookTesterProps = Readonly<{
  topics: string[];
  onTest: (topic: string) => Promise<{ success: boolean; latencyMs?: number; error?: string }>;
  disabled?: boolean;
}>;

export function WebhookTester({ topics, onTest, disabled }: WebhookTesterProps) {
  const [selectedTopic, setSelectedTopic] = useState('');
  const [state, setState] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const isDisabled = (disabled ?? false) || topics.length === 0;

  useEffect(() => {
    if (!selectedTopic && topics.length > 0) {
      const first = topics.at(0);
      if (first) setSelectedTopic(first);
    }
  }, [selectedTopic, topics]);

  const handleTest = async () => {
    if (!selectedTopic) return;
    setState('loading');
    setMessage(null);
    try {
      const result = await onTest(selectedTopic);
      if (result.success) {
        setState('success');
        setMessage(
          typeof result.latencyMs === 'number'
            ? `Webhook primit în ${result.latencyMs} ms.`
            : 'Webhook primit.'
        );
      } else {
        setState('error');
        setMessage(result.error ?? 'Test webhook eșuat.');
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Webhook test failed.';
      setState('error');
      setMessage(msg);
    }
  };

  return (
    <div className="space-y-3 rounded-md border border-muted/20 bg-background p-4">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">Test webhook Shopify</span>
        <InfoTooltip title="Test webhook Shopify" side="bottom" portalToBody>
          Trimite un eveniment de test pentru topic-ul selectat către endpoint-ul aplicației.
          Verifică că backend-ul primește cererea. Folosit pentru webhooks generale Shopify
          (produse, comenzi etc.).
        </InfoTooltip>
      </div>

      <div className="flex flex-col gap-3 md:flex-row md:items-center">
        <div className="md:w-64">
          <Select
            label="Topic"
            options={topics.map((t): SelectOption => ({ value: t, label: t }))}
            value={selectedTopic}
            onChange={(e) => setSelectedTopic(e.target.value)}
            disabled={isDisabled}
          />
        </div>

        <Button
          variant="secondary"
          onClick={() => void handleTest()}
          disabled={isDisabled || !selectedTopic || state === 'loading'}
        >
          {state === 'loading' ? 'Se testează…' : 'Testează webhook'}
        </Button>
      </div>

      {message ? (
        <div
          className={`rounded-md border p-3 text-sm shadow-[var(--shadow-sm)] ${
            state === 'error'
              ? 'border-error/30 bg-error/10 text-error'
              : 'border-success/30 bg-success/10 text-success'
          }`}
        >
          {message}
        </div>
      ) : null}
    </div>
  );
}
