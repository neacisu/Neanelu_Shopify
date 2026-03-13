import { ErrorList as BaseErrorList } from '../forms/error-list';

export function ErrorList(props: { errors: Record<string, string[]> }) {
  const entries = Object.entries(props.errors).filter(([, msgs]) => msgs.length > 0);
  if (entries.length === 0) return null;
  return (
    <div
      role="alert"
      aria-live="polite"
      aria-atomic="true"
      aria-label="Listă erori formulare"
      className="rounded-lg border border-error/30 bg-error/5 px-4 py-3 text-error"
    >
      <BaseErrorList errors={props.errors} />
    </div>
  );
}
