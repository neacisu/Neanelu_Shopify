import { useEffect, useRef } from 'react';

import { PolarisBanner } from '../../../components/polaris/index.js';

export function FormErrorSummary({
  errors,
  title = 'Please fix the following errors',
}: {
  errors: Record<string, string[]> | undefined;
  title?: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  const entries = errors ? Object.entries(errors).filter(([, msgs]) => msgs.length > 0) : [];

  useEffect(() => {
    if (entries.length > 0) {
      ref.current?.focus();
    }
  }, [entries.length]);

  if (entries.length === 0) return null;

  return (
    <div ref={ref} tabIndex={-1} role="alert" className="focus:outline-none">
      <PolarisBanner status="critical">
        <div className="text-h6">{title}</div>
        <ul className="mt-2 list-disc space-y-1 pl-6 text-body text-foreground/90">
          {entries.flatMap(([field, msgs]) =>
            msgs.map((msg, index) => <li key={`${field}-${index}`}>{msg}</li>)
          )}
        </ul>
      </PolarisBanner>
    </div>
  );
}
