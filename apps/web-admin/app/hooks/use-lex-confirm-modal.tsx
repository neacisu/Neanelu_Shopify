import { useCallback, useRef, useState, type ReactNode } from 'react';

import { WarningModal } from '../components/ui/warning-modal';

export type LexConfirmOptions = Readonly<{
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  confirmVariant?: 'primary' | 'destructive';
}>;

const emptyOpts: LexConfirmOptions = { title: '' };

/**
 * Modal confirm flow for PIM Translations destructive / high-impact actions.
 * Resolves `true` after the action completes; resolves `false` if the user cancels.
 * Rejects if the action throws.
 */
export function useLexConfirmModal() {
  const [open, setOpen] = useState(false);
  const [opts, setOpts] = useState<LexConfirmOptions>(emptyOpts);
  const [confirmLoading, setConfirmLoading] = useState(false);

  const resolverRef = useRef<{
    resolve: (ok: boolean) => void;
    reject: (e: unknown) => void;
  } | null>(null);
  const actionRef = useRef<(() => Promise<void>) | null>(null);

  const requestLexConfirm = useCallback(
    (options: LexConfirmOptions, action: () => Promise<void>) => {
      return new Promise<boolean>((resolve, reject) => {
        resolverRef.current = { resolve, reject };
        actionRef.current = action;
        setOpts(options);
        setOpen(true);
      });
    },
    []
  );

  const handleCancel = useCallback(() => {
    resolverRef.current?.resolve(false);
    resolverRef.current = null;
    actionRef.current = null;
    setOpen(false);
    setConfirmLoading(false);
  }, []);

  const handleConfirm = useCallback(async () => {
    const run = actionRef.current;
    const res = resolverRef.current;
    if (!run || !res) {
      setOpen(false);
      return;
    }
    setConfirmLoading(true);
    try {
      await run();
      res.resolve(true);
    } catch (e) {
      res.reject(e);
    } finally {
      resolverRef.current = null;
      actionRef.current = null;
      setConfirmLoading(false);
      setOpen(false);
    }
  }, []);

  const LexConfirmModal = useCallback(
    () => (
      <WarningModal
        open={open}
        title={opts.title}
        description={opts.description}
        confirmLabel={opts.confirmLabel ?? 'Confirm'}
        cancelLabel={opts.cancelLabel ?? 'Cancel'}
        confirmVariant={opts.confirmVariant ?? 'primary'}
        confirmLoading={confirmLoading}
        closeOnOverlayClick={false}
        onConfirm={() => void handleConfirm()}
        onCancel={handleCancel}
      />
    ),
    [open, opts, confirmLoading, handleConfirm, handleCancel]
  );

  return { requestLexConfirm, LexConfirmModal };
}
