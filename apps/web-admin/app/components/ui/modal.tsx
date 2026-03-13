import { createPortal } from 'react-dom';
import { useCallback, useEffect, useId, useRef, type PropsWithChildren } from 'react';

export type ModalProps = PropsWithChildren<{
  open?: boolean;
  onClose?: () => void;
  title?: string;
  className?: string;
  [key: string]: unknown;
}>;

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export function Modal({
  children,
  open = false,
  onClose,
  title,
  className = '',
  ...rest
}: ModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const titleId = useId();

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape' && onClose) {
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;

      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    },
    [onClose]
  );

  const handleOverlayClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.target === overlayRef.current && onClose) {
        onClose();
      }
    },
    [onClose]
  );

  useEffect(() => {
    if (open) {
      previousFocusRef.current = document.activeElement as HTMLElement;
      window.addEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'hidden';

      // Focus first focusable element after render
      const raf = requestAnimationFrame(() => {
        const dialog = dialogRef.current;
        if (!dialog) return;
        const focusable = dialog.querySelector<HTMLElement>(FOCUSABLE);
        focusable?.focus();
      });

      return () => {
        window.removeEventListener('keydown', handleKeyDown);
        document.body.style.overflow = '';
        cancelAnimationFrame(raf);
        previousFocusRef.current?.focus();
      };
    } else {
      window.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    }
    return undefined;
  }, [open, handleKeyDown]);

  if (!open || typeof document === 'undefined') return null;

  const modal = (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-[9999] flex items-end justify-center p-0 sm:items-center sm:p-4"
      onClick={handleOverlayClick}
    >
      <div
        className="pointer-events-none absolute inset-0 bg-overlay/35 backdrop-blur-sm"
        aria-hidden
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        className={`
          relative z-10 max-h-[90dvh] w-full max-w-full overflow-auto rounded-t-2xl
          border border-border/30 bg-card/95 shadow-[var(--shadow-xl)] backdrop-blur-xl
          motion-safe:animate-[slide-in-bottom_200ms_ease-out]
          ${className.includes('max-w-') ? '' : 'sm:max-w-lg'} sm:rounded-2xl sm:motion-safe:animate-[scale-in_180ms_ease-out]
          ${className}
        `}
        onClick={(e) => e.stopPropagation()}
        {...rest}
      >
        {title ? (
          <span id={titleId} className="sr-only">
            {title}
          </span>
        ) : null}
        {children}
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
