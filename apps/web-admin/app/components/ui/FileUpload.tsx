import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { FileText, Upload, X } from 'lucide-react';
import { useDropzone, type Accept, type FileRejection } from 'react-dropzone';

export type UploadStatus = 'ready' | 'uploading' | 'done' | 'error';

export type JsonlPreview = Readonly<{
  valid: boolean;
  rows: Record<string, unknown>[];
  totalLines: number;
  errors: readonly { line: number; message: string }[];
}>;

export type UploadItem = Readonly<{
  id: string;
  file: File;
  status: UploadStatus;
  progress: number;
  error?: string;
  previewUrl?: string;
  jsonlPreview?: JsonlPreview;
}>;

export type FileUploadProps = Readonly<{
  label?: string;
  description?: string;

  accept?: Accept;
  maxFiles?: number;

  maxSize?: number;
  maxSizeBytes?: number;

  preview?: boolean;

  acceptJsonl?: boolean;

  disabled?: boolean;

  items?: readonly UploadItem[];
  onItemsChange?: (items: UploadItem[]) => void;

  onUpload?: (
    file: File,
    api: {
      setProgress: (progress: number) => void;
      setError: (message: string) => void;
      setDone: () => void;
    }
  ) => Promise<void>;

  uploadFn?: (
    item: UploadItem,
    api: {
      setProgress: (progress: number) => void;
      setError: (message: string) => void;
      setDone: () => void;
    }
  ) => Promise<void>;

  className?: string;
}>;

function isImage(file: File): boolean {
  return file.type.startsWith('image/');
}

function isJsonlFile(file: File): boolean {
  const n = file.name.toLowerCase();
  return n.endsWith('.jsonl') || n.endsWith('.ndjson');
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getFileExtension(name: string): string {
  const parts = name.split('.');
  return parts.length > 1 ? (parts.pop()?.toUpperCase() ?? '') : '';
}

function parseJsonlFile(file: File): Promise<JsonlPreview> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      const raw = reader.result;
      const text = typeof raw === 'string' ? raw : '';
      const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
      const rows: Record<string, unknown>[] = [];
      const errors: { line: number; message: string }[] = [];

      for (let i = 0; i < lines.length; i++) {
        try {
          const parsed = JSON.parse(lines[i]!) as unknown;
          rows.push(
            typeof parsed === 'object' && parsed !== null
              ? (parsed as Record<string, unknown>)
              : { value: parsed }
          );
        } catch (e) {
          errors.push({ line: i + 1, message: e instanceof Error ? e.message : 'JSON invalid' });
        }
      }

      resolve({
        valid: errors.length === 0,
        rows,
        totalLines: lines.length,
        errors,
      });
    };
    reader.onerror = () =>
      resolve({
        valid: false,
        rows: [],
        totalLines: 0,
        errors: [{ line: 0, message: 'Eroare la citirea fișierului' }],
      });
    reader.readAsText(file);
  });
}

function newId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `up_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function fileErrorMessage(rejection: FileRejection): string {
  return rejection.errors.map((e) => e.message).join(', ');
}

export function FileUpload(props: FileUploadProps) {
  const {
    label = 'Încărcare',
    description,
    accept,
    maxFiles = 5,
    maxSize,
    maxSizeBytes,
    preview = true,
    acceptJsonl = false,
    disabled,
    items: itemsProp,
    onItemsChange,
    onUpload,
    uploadFn,
    className,
  } = props;

  const labelId = useId();
  const descriptionId = useId();
  const errorId = useId();

  const effectiveMaxSize = typeof maxSize === 'number' ? maxSize : maxSizeBytes;

  const [uncontrolled, setUncontrolled] = useState<UploadItem[]>([]);
  const items = itemsProp ? Array.from(itemsProp) : uncontrolled;

  const setItems = useCallback(
    (next: UploadItem[]) => {
      onItemsChange?.(next);
      if (!itemsProp) setUncontrolled(next);
    },
    [itemsProp, onItemsChange]
  );

  const [globalError, setGlobalError] = useState<string | null>(null);

  const itemByIdRef = useRef(new Map<string, UploadItem>());
  useEffect(() => {
    itemByIdRef.current = new Map(items.map((i) => [i.id, i]));
  }, [items]);

  const addFiles = useCallback(
    async (files: readonly File[], rejections: readonly FileRejection[]) => {
      setGlobalError(null);

      if (rejections.length) {
        setGlobalError(fileErrorMessage(rejections[0]!));
      }

      const remaining = Math.max(0, maxFiles - items.length);
      if (remaining <= 0) {
        setGlobalError(`Maxim ${maxFiles} fișiere`);
        return;
      }

      const toAdd = files.slice(0, remaining);
      const newItems: UploadItem[] = [];

      for (const file of toAdd) {
        if (acceptJsonl && isJsonlFile(file)) {
          const jsonlPreview = await parseJsonlFile(file);
          if (!jsonlPreview.valid) {
            setGlobalError(
              `Fișierul ${file.name} conține erori JSONL (linia ${jsonlPreview.errors[0]?.line ?? '?'}). Verifică formatul.`
            );
          }
          newItems.push({
            id: newId(),
            file,
            status: 'ready',
            progress: 0,
            jsonlPreview,
          } satisfies UploadItem);
          continue;
        }

        const previewUrl = preview && isImage(file) ? URL.createObjectURL(file) : null;

        newItems.push({
          id: newId(),
          file,
          status: 'ready',
          progress: 0,
          ...(previewUrl ? { previewUrl } : {}),
        } satisfies UploadItem);
      }

      setItems([...items, ...newItems]);
    },
    [items, maxFiles, preview, acceptJsonl, setItems]
  );

  const remove = useCallback(
    (id: string) => {
      const item = items.find((x) => x.id === id);
      if (item?.previewUrl) URL.revokeObjectURL(item.previewUrl);
      setItems(items.filter((x) => x.id !== id));
    },
    [items, setItems]
  );

  const updateItem = useCallback(
    (id: string, patch: Partial<UploadItem>) => {
      setItems(items.map((x) => (x.id === id ? ({ ...x, ...patch } satisfies UploadItem) : x)));
    },
    [items, setItems]
  );

  const runUpload = useCallback(
    async (item: UploadItem) => {
      updateItem(item.id, { status: 'uploading', progress: 0 });
      try {
        if (onUpload) {
          await onUpload(item.file, {
            setProgress: (p) => updateItem(item.id, { progress: Math.max(0, Math.min(100, p)) }),
            setError: (message) => updateItem(item.id, { status: 'error', error: message }),
            setDone: () => updateItem(item.id, { status: 'done', progress: 100 }),
          });
          return;
        }

        if (uploadFn) {
          await uploadFn(item, {
            setProgress: (p) => updateItem(item.id, { progress: Math.max(0, Math.min(100, p)) }),
            setError: (message) => updateItem(item.id, { status: 'error', error: message }),
            setDone: () => updateItem(item.id, { status: 'done', progress: 100 }),
          });
          return;
        }

        updateItem(item.id, { status: 'done', progress: 100 });
      } catch (e) {
        updateItem(item.id, {
          status: 'error',
          error: e instanceof Error ? e.message : 'Încărcare eșuată',
        });
      }
    },
    [onUpload, updateItem, uploadFn]
  );

  const dropzoneAccept: Accept = useMemo(() => {
    const base = accept ?? {};
    if (acceptJsonl) {
      return {
        ...base,
        'application/jsonlines': ['.jsonl'],
        'application/x-ndjson': ['.ndjson'],
        'text/plain': ['.jsonl', '.ndjson'],
      };
    }
    return base;
  }, [accept, acceptJsonl]);

  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    accept: dropzoneAccept,
    ...(typeof disabled === 'boolean' ? { disabled } : {}),
    multiple: true,
    maxFiles,
    ...(typeof effectiveMaxSize === 'number' ? { maxSize: effectiveMaxSize } : {}),
    onDrop: (acceptedFiles, fileRejections) => {
      void addFiles(acceptedFiles, fileRejections);
    },
  });

  useEffect(() => {
    if (!onUpload && !uploadFn) return;
    const pending = items.filter((i) => i.status === 'ready' && !i.error);
    if (pending.length === 0) return;
    void (async () => {
      for (const item of pending) {
        const current = itemByIdRef.current.get(item.id);
        if (!current) continue;
        if (current.status !== 'ready' || current.error) continue;
        await runUpload(current);
      }
    })();
  }, [items, onUpload, runUpload, uploadFn]);

  const hasUploads = items.length > 0;

  const summary = useMemo(() => {
    const done = items.filter((i) => i.status === 'done').length;
    const uploading = items.filter((i) => i.status === 'uploading').length;
    const errors = items.filter((i) => i.status === 'error').length;
    return { done, uploading, errors, total: items.length };
  }, [items]);

  return (
    <div className={className}>
      <div id={labelId} className="text-xs font-medium uppercase tracking-wider text-muted">
        {label}
      </div>
      {description ? (
        <div id={descriptionId} className="mt-0.5 text-xs text-muted">
          {description}
        </div>
      ) : null}

      <div
        {...getRootProps({
          className:
            'mt-2 group rounded-xl border-2 border-dashed bg-card p-6 text-center text-sm transition-all duration-200 focus-visible:shadow-[0_0_0_3px_rgba(59,130,246,0.15)] dark:focus-visible:shadow-[0_0_0_3px_rgba(96,165,250,0.2)] ' +
            (isDragActive
              ? 'border-blue-400 bg-blue-50/50 dark:border-blue-500 dark:bg-blue-900/20 motion-safe:animate-[pulse-border_1s_ease-in-out_infinite]'
              : 'border-border hover:border-slate-400 dark:hover:border-slate-500') +
            (disabled ? ' opacity-60 cursor-not-allowed' : ' cursor-pointer'),
          role: 'button',
          tabIndex: disabled ? -1 : 0,
          'aria-disabled': disabled ? true : undefined,
          'aria-labelledby': labelId,
          'aria-describedby':
            [description ? descriptionId : null, globalError ? errorId : null]
              .filter(Boolean)
              .join(' ') || undefined,
          onKeyDown: (e: React.KeyboardEvent) => {
            if (disabled) return;
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              open();
            }
          },
        })}
      >
        <input {...getInputProps()} />
        <div className="mx-auto mb-2 flex size-10 items-center justify-center rounded-xl bg-slate-100 text-slate-400 transition-colors group-hover:bg-blue-100 group-hover:text-blue-500 dark:bg-slate-800 dark:text-slate-500 dark:group-hover:bg-blue-900/40 dark:group-hover:text-blue-400">
          <Upload className="size-5" />
        </div>
        <div className="font-medium text-foreground">
          {isDragActive ? 'Plasează fișierele aici…' : 'Trage și plasează fișiere'}
        </div>
        <div className="mt-1 text-xs text-muted">Sau dă click pentru a răsfoi</div>
        <div className="mt-2 text-xs text-muted">
          Maxim {maxFiles} fișiere
          {typeof effectiveMaxSize === 'number' ? ` · Max ${formatFileSize(effectiveMaxSize)}` : ''}
        </div>
      </div>

      {globalError ? (
        <div
          id={errorId}
          role="alert"
          aria-live="assertive"
          className="mt-2 rounded-xl border border-red-200 bg-red-50/80 px-3 py-2 text-sm text-red-700 dark:border-red-800/50 dark:bg-red-900/20 dark:text-red-300"
        >
          {globalError}
        </div>
      ) : null}

      {hasUploads ? (
        <div className="mt-3 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs text-muted">
              {summary.total} fișiere · {summary.uploading} în curs · {summary.done} finalizate
              {summary.errors ? ` · ${summary.errors} erori` : ''}
            </div>
          </div>

          <ul className="space-y-2">
            {items.map((item) => (
              <li
                key={item.id}
                className="flex items-center gap-3 rounded-xl border border-border bg-card p-2.5 transition-colors dark:border-slate-700 dark:bg-slate-800/50"
              >
                {item.previewUrl ? (
                  <img
                    src={item.previewUrl}
                    alt={item.file.name}
                    className="size-10 rounded-lg object-cover"
                  />
                ) : (
                  <div className="flex size-10 items-center justify-center rounded-lg bg-slate-100 dark:bg-slate-700/60">
                    {item.jsonlPreview ? (
                      <span className="text-[10px] font-bold text-blue-500">JSONL</span>
                    ) : (
                      <FileText className="size-4 text-slate-400 dark:text-slate-500" />
                    )}
                  </div>
                )}

                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="truncate text-sm font-medium text-foreground">
                      {item.file.name}
                    </span>
                    <span className="shrink-0 text-[10px] text-muted">
                      {formatFileSize(item.file.size)}
                      {getFileExtension(item.file.name)
                        ? ` · ${getFileExtension(item.file.name)}`
                        : ''}
                    </span>
                  </div>
                  <div className="text-xs text-muted">
                    {item.status === 'ready' && 'În așteptare'}
                    {item.status === 'uploading' && 'Se încarcă…'}
                    {item.status === 'done' && 'Finalizat'}
                    {item.status === 'error' && 'Eroare'}
                    {item.error ? ` · ${item.error}` : ''}
                  </div>
                  <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-200/60 dark:bg-slate-700/60">
                    <div
                      role="progressbar"
                      aria-label={`Progres pentru ${item.file.name}`}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={Math.max(0, Math.min(100, item.progress))}
                      className={
                        'h-full rounded-full transition-all duration-300 ' +
                        (item.status === 'error'
                          ? 'bg-red-500'
                          : item.status === 'done'
                            ? 'bg-emerald-500'
                            : 'bg-gradient-to-r from-blue-400 to-blue-600')
                      }
                      style={{ width: `${Math.max(0, Math.min(100, item.progress))}%` }}
                    />
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => remove(item.id)}
                  className="rounded-lg p-1.5 text-muted transition-colors hover:bg-red-100 hover:text-red-600 dark:hover:bg-red-900/30 dark:hover:text-red-400"
                  aria-label={`Elimină ${item.file.name}`}
                >
                  <X className="size-4" />
                </button>
              </li>
            ))}
          </ul>

          {items.some((i) => i.jsonlPreview) ? (
            <div className="mt-3 space-y-2">
              {items
                .filter((i): i is UploadItem & { jsonlPreview: JsonlPreview } =>
                  Boolean(i.jsonlPreview)
                )
                .map((item) => {
                  const jp = item.jsonlPreview;
                  const cols = jp.rows[0] ? Object.keys(jp.rows[0]) : [];
                  const previewRows = jp.rows.slice(0, 10);
                  return (
                    <div
                      key={item.id}
                      className="overflow-hidden rounded-xl border border-border dark:border-slate-700"
                    >
                      <div className="border-b border-border bg-slate-50/50 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-muted dark:border-slate-700 dark:bg-slate-800/50">
                        Previzualizare JSONL: {item.file.name}
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-left text-xs">
                          <thead>
                            <tr className="border-b border-border bg-slate-50/30 dark:border-slate-700 dark:bg-slate-800/30">
                              <th className="px-3 py-2 font-medium text-muted">#</th>
                              {cols.map((c) => (
                                <th key={c} className="px-3 py-2 font-medium text-muted">
                                  {c}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {previewRows.map((row, i) => (
                              <tr
                                key={i}
                                className="border-b border-border/50 last:border-0 dark:border-slate-700/50"
                              >
                                <td className="px-3 py-1.5 text-muted">{i + 1}</td>
                                {cols.map((c) => {
                                  const val = row[c];
                                  const display =
                                    val === null || val === undefined
                                      ? '—'
                                      : typeof val === 'object'
                                        ? JSON.stringify(val)
                                        : typeof val === 'string' ||
                                            typeof val === 'number' ||
                                            typeof val === 'boolean'
                                          ? String(val)
                                          : JSON.stringify(val);
                                  return (
                                    <td
                                      key={c}
                                      className="max-w-48 truncate px-3 py-1.5 text-foreground"
                                    >
                                      {display}
                                    </td>
                                  );
                                })}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <div className="border-t border-border px-3 py-1.5 text-xs text-muted dark:border-slate-700">
                        {jp.totalLines} linii
                        {jp.errors.length > 0
                          ? ` · ${jp.errors.length} erori (ex: linia ${jp.errors[0]?.line})`
                          : ' · Valid ✓'}
                      </div>
                    </div>
                  );
                })}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
