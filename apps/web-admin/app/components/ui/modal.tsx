import { createPortal } from 'react-dom';
import { useCallback, useEffect, useRef, type PropsWithChildren } from 'react';

export type ModalProps = PropsWithChildren<{
  open?: boolean;
  onClose?: () => void;
  className?: string;
  [key: string]: unknown;
}>;

export function Modal({ children, open = false, onClose, className = '', ...rest }: ModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape' && onClose) {
        onClose();
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
      window.addEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'hidden';
    }
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [open, handleKeyDown]);

  if (!open || typeof document === 'undefined') return null;

  const modal = (
    <div
      ref={overlayRef}
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
      onClick={handleOverlayClick}
    >
      <div
        className="pointer-events-none absolute inset-0 bg-black/30 backdrop-blur-sm"
        aria-hidden
      />
      <div
        className={`
          relative z-10 max-h-[90vh] w-full max-w-lg overflow-auto rounded-2xl
          border border-white/20 bg-white/90 shadow-xl backdrop-blur-xl
          motion-safe:animate-[scale-in_180ms_ease-out]
          dark:border-white/10 dark:bg-slate-900/90
          ${className}
        `}
        onClick={(e) => e.stopPropagation()}
        {...rest}
      >
        {children}
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
