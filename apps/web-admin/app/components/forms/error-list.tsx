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
    <ul
      className="mt-2 list-disc space-y-1 pl-6 text-sm text-red-700 dark:text-red-300"
      role="list"
    >
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
                className="rounded px-0.5 py-0.5 text-red-600 underline-offset-2 transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 dark:text-red-400"
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
