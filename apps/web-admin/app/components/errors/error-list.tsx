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
      className="rounded-lg border border-red-200/50 bg-red-50/30 px-4 py-3 text-red-700 dark:border-red-800/30 dark:bg-red-900/10 dark:text-red-300"
    >
      <BaseErrorList errors={props.errors} />
    </div>
  );
}
