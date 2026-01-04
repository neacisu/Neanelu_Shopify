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
    <div id={id} role="alert" className="mt-1 text-caption text-error">
      {message}
    </div>
  );
}
