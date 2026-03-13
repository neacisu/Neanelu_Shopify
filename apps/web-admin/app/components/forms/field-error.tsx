export function FieldError({
  name,
  errors,
}: {
  name: string;
  errors: Record<string, string[]> | undefined;
}) {
  const message = errors?.[name]?.[0];
  if (!message) return null;

  const id = `${name}-error`;

  return (
    <div
      id={id}
      role="alert"
      aria-live="polite"
      className="mt-1.5 text-xs text-error motion-safe:animate-[fadeSlideUp_0.15s_ease-out]"
      title="Eroare de validare pentru acest câmp"
    >
      {message}
    </div>
  );
}
