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
    <ul className="mt-2 list-disc space-y-1 pl-6 text-sm text-error" role="list">
      {entries.flatMap(([field, msgs]) =>
        msgs.map((msg, index) => {
          const key = `${field}-${index}`;

          if (!field || field === 'form') {
            return <li key={key}>{msg}</li>;
          }

          return (
            <li key={key}>
              <a
                href={`#${field}`}
                className="rounded px-0.5 py-0.5 text-error underline-offset-2 transition-colors hover:underline focus-ring-standard"
                onClick={(event) => {
                  event.preventDefault();
                  onNavigate(field);
                }}
                title="Sari la câmpul cu eroare"
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
