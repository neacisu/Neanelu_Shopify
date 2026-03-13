import * as React from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  side?: 'right' | 'left' | 'bottom';
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
  children: React.ReactNode;
  className?: string;
  showCloseButton?: boolean;
}

const SIDE_CLASSES: Record<NonNullable<DrawerProps['side']>, string> = {
  right: 'inset-y-0 right-0 h-full motion-safe:animate-[slide-in-right_220ms_ease-out]',
  left: 'inset-y-0 left-0 h-full motion-safe:animate-[slide-right_220ms_ease-out]',
  bottom:
    'inset-x-0 bottom-0 w-full rounded-t-2xl motion-safe:animate-[slide-in-bottom_220ms_ease-out]',
};

const SIZE_CLASSES: Record<NonNullable<DrawerProps['size']>, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-xl',
  full: 'max-w-full',
};

export function Drawer({
  open,
  onClose,
  title,
  side = 'right',
  size = 'md',
  children,
  className = '',
  showCloseButton = true,
}: DrawerProps) {
  const drawerRef = React.useRef<HTMLDivElement>(null);
  const previousFocusRef = React.useRef<HTMLElement | null>(null);
  const titleId = React.useId();

  React.useEffect(() => {
    if (!open) return;

    previousFocusRef.current = document.activeElement as HTMLElement;

    requestAnimationFrame(() => {
      const el = drawerRef.current?.querySelector<HTMLElement>(FOCUSABLE);
      el?.focus();
    });

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const focusable = Array.from(
        drawerRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []
      );
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;

      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      previousFocusRef.current?.focus();
    };
  }, [open, onClose]);

  if (!open || typeof document === 'undefined') return null;

  const sideWidthClass = side !== 'bottom' ? SIZE_CLASSES[size] : '';

  const drawer = (
    <div className="fixed inset-0 z-[9998]" onClick={onClose}>
      <div
        className="pointer-events-none absolute inset-0 bg-overlay/40 backdrop-blur-sm motion-safe:animate-[fadeIn_150ms_ease-out]"
        aria-hidden
      />
      <div
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        className={`
          absolute ${SIDE_CLASSES[side]} ${sideWidthClass}
          z-10 flex flex-col overflow-hidden
          border border-border/30 bg-card/95 shadow-[var(--shadow-xl)] backdrop-blur-xl
          ${className}
        `}
        onClick={(e) => e.stopPropagation()}
      >
        {title || showCloseButton ? (
          <div className="flex shrink-0 items-center justify-between border-b border-border/60 px-4 py-3">
            {title ? (
              <h2 id={titleId} className="text-base font-semibold text-foreground">
                {title}
              </h2>
            ) : (
              <span id={titleId} />
            )}
            {showCloseButton ? (
              <button
                type="button"
                onClick={onClose}
                aria-label="Închide"
                className="inline-flex items-center justify-center rounded-lg p-1.5 text-muted transition-colors hover:bg-subtle/60 hover:text-foreground focus-ring-standard"
              >
                <X className="size-4" />
              </button>
            ) : null}
          </div>
        ) : null}
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </div>
    </div>
  );

  return createPortal(drawer, document.body);
}
