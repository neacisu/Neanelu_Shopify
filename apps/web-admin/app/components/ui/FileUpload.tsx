import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDropzone, type Accept, type FileRejection } from 'react-dropzone';

import { Button } from './button';

export type UploadStatus = 'ready' | 'uploading' | 'done' | 'error';

export type UploadItem = Readonly<{
  id: string;
  file: File;
  status: UploadStatus;
  progress: number;
  error?: string;
  previewUrl?: string;
}>;

export type FileUploadProps = Readonly<{
  label?: string;
  description?: string;

  accept?: Accept;
  maxFiles?: number;
  maxSizeBytes?: number;

  disabled?: boolean;

  /** Controlled items (optional). If omitted, FileUpload manages state internally. */
  items?: readonly UploadItem[];
  onItemsChange?: (items: UploadItem[]) => void;

  /**
   * Optional upload strategy. When provided, newly added items will transition to uploading and
   * progress can be reported via the provided callback.
   */
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
    label = 'Upload',
    description,
    accept,
    maxFiles = 5,
    maxSizeBytes,
    disabled,
    items: itemsProp,
    onItemsChange,
    uploadFn,
    className,
  } = props;

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
    (files: readonly File[], rejections: readonly FileRejection[]) => {
      setGlobalError(null);

      if (rejections.length) {
        setGlobalError(fileErrorMessage(rejections[0]!));
      }

      const remaining = Math.max(0, maxFiles - items.length);
      if (remaining <= 0) {
        setGlobalError(`Max ${maxFiles} files`);
        return;
      }

      const toAdd = files.slice(0, remaining);
      const next: UploadItem[] = [
        ...items,
        ...toAdd.map((file) => {
          const previewUrl = isImage(file) ? URL.createObjectURL(file) : null;
          return {
            id: newId(),
            file,
            status: 'ready',
            progress: 0,
            ...(previewUrl ? { previewUrl } : {}),
          } satisfies UploadItem;
        }),
      ];

      setItems(next);
    },
    [items, maxFiles, setItems]
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

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    ...(accept ? { accept } : {}),
    ...(typeof disabled === 'boolean' ? { disabled } : {}),
    multiple: true,
    maxFiles,
    ...(typeof maxSizeBytes === 'number' ? { maxSize: maxSizeBytes } : {}),
    onDrop: (acceptedFiles, fileRejections) => {
      addFiles(acceptedFiles, fileRejections);
    },
  });

  const startUploads = useCallback(async () => {
    if (!uploadFn) return;

    const pending = items.filter((i) => i.status === 'ready' && !i.error);
    for (const item of pending) {
      updateItem(item.id, { status: 'uploading', progress: 0 });
      try {
        await uploadFn(item, {
          setProgress: (p) => updateItem(item.id, { progress: Math.max(0, Math.min(100, p)) }),
          setError: (message) => updateItem(item.id, { status: 'error', error: message }),
          setDone: () => updateItem(item.id, { status: 'done', progress: 100 }),
        });
      } catch (e) {
        updateItem(item.id, {
          status: 'error',
          error: e instanceof Error ? e.message : 'Upload failed',
        });
      }
    }
  }, [items, updateItem, uploadFn]);

  const hasUploads = items.length > 0;
  const canStart = Boolean(uploadFn) && items.some((i) => i.status === 'ready' && !i.error);

  const summary = useMemo(() => {
    const done = items.filter((i) => i.status === 'done').length;
    const uploading = items.filter((i) => i.status === 'uploading').length;
    const errors = items.filter((i) => i.status === 'error').length;
    return { done, uploading, errors, total: items.length };
  }, [items]);

  return (
    <div className={className}>
      <div className="text-caption text-muted">{label}</div>
      {description ? <div className="text-caption text-muted">{description}</div> : null}

      <div
        {...getRootProps({
          className:
            'mt-2 rounded-md border border-dashed p-4 text-sm ' +
            (isDragActive ? 'bg-muted/20' : 'bg-background') +
            (disabled ? ' opacity-60' : ''),
        })}
      >
        <input {...getInputProps()} />
        <div className="font-medium">{isDragActive ? 'Drop files here…' : 'Drag & drop files'}</div>
        <div className="text-caption text-muted">Or click to browse</div>
        <div className="mt-2 text-caption text-muted">
          Max files: {maxFiles}
          {maxSizeBytes ? ` · Max size: ${Math.round(maxSizeBytes / 1024 / 1024)}MB` : ''}
        </div>
      </div>

      {globalError ? (
        <div className="mt-2 rounded-md border border-red-300 bg-red-50 p-2 text-sm text-red-800">
          {globalError}
        </div>
      ) : null}

      {hasUploads ? (
        <div className="mt-3 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-caption text-muted">
              {summary.total} files · {summary.uploading} uploading · {summary.done} done
              {summary.errors ? ` · ${summary.errors} errors` : ''}
            </div>
            <div className="flex items-center gap-2">
              {canStart ? (
                <Button type="button" variant="primary" onClick={() => void startUploads()}>
                  Start upload
                </Button>
              ) : null}
            </div>
          </div>

          <ul className="space-y-2">
            {items.map((item) => (
              <li key={item.id} className="flex items-center gap-3 rounded-md border p-2">
                {item.previewUrl ? (
                  <img
                    src={item.previewUrl}
                    alt={item.file.name}
                    className="h-10 w-10 rounded object-cover"
                  />
                ) : (
                  <div className="flex h-10 w-10 items-center justify-center rounded bg-muted/20 text-xs text-muted">
                    FILE
                  </div>
                )}

                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{item.file.name}</div>
                  <div className="text-caption text-muted">
                    {item.status}
                    {item.error ? ` · ${item.error}` : ''}
                  </div>
                  <div className="mt-1 h-2 w-full overflow-hidden rounded bg-muted/20">
                    <div
                      className={
                        'h-full ' +
                        (item.status === 'error'
                          ? 'bg-red-500'
                          : item.status === 'done'
                            ? 'bg-emerald-500'
                            : 'bg-blue-500')
                      }
                      style={{ width: `${Math.max(0, Math.min(100, item.progress))}%` }}
                    />
                  </div>
                </div>

                <Button type="button" variant="ghost" onClick={() => remove(item.id)}>
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
