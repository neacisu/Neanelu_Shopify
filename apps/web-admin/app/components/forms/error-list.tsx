import { useCallback } from 'react';

export function ErrorList({ errors }: { errors: Record<string, string[]> }) {
  const entries = Object.entries(errors).filter(([, msgs]) => msgs.length > 0);

  const onNavigate = useCallback((field: string) => {
    const el = document.getElementById(field);
    if (el instanceof HTMLElement) {
      el.focus();
    }
  }, []);

  return (
    <ul className="mt-2 list-disc space-y-1 pl-6 text-body text-foreground/90">
      {entries.flatMap(([field, msgs]) =>
        msgs.map((msg, index) => {
          const key = `${field}-${index}`;

          // "form" is a summary-level error (no field id)
          if (!field || field === 'form') {
            return <li key={key}>{msg}</li>;
          }

          return (
            <li key={key}>
              <a
                href={`#${field}`}
                className="text-primary hover:underline"
                onClick={(event) => {
                  event.preventDefault();
                  onNavigate(field);
                }}
              >
                {msg}
              </a>
            </li>
          );
        })
      )}
    </ul>
  );
}
