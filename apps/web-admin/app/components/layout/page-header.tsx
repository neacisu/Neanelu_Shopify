import type { ReactNode } from 'react';

export interface PageHeaderProps {
  title: string;
  description?: string;
  actions?: ReactNode;
}

export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <header
      className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"
      role="banner"
    >
      <div className="min-w-0">
        <h1 className="text-h2 text-foreground transition-colors motion-safe:animate-[fadeSlideUp_0.5s_ease-out_both]">
          {title}
        </h1>
        {description ? (
          <p className="mt-1 text-body text-muted motion-safe:animate-[fadeSlideUp_0.5s_ease-out_0.1s_both]">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? (
        <div
          className="flex shrink-0 items-center gap-2 [&>*]:focus-ring [&>*]:rounded-md [&>*]:transition-transform [&>*]:duration-200 [&>*:hover]:scale-[1.02] [&>*:active]:scale-[0.98]"
          role="group"
          aria-label="Acțiuni pagină"
        >
          {actions}
        </div>
      ) : null}
    </header>
  );
}
