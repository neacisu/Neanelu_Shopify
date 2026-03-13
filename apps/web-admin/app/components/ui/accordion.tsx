import { type ReactNode, useId, useState, useCallback } from 'react';
import { ChevronDown } from 'lucide-react';

export interface AccordionItem {
  id: string;
  trigger: ReactNode;
  content: ReactNode;
  defaultOpen?: boolean;
}

export interface AccordionProps {
  items: AccordionItem[];
  className?: string;
  /** Permite deschiderea unui singur item simultan. Default: false */
  single?: boolean;
}

/**
 * Accordion cu animație smooth height folosind grid-template-rows pattern.
 * Respectă prefers-reduced-motion.
 */
export function Accordion({ items, className = '', single = false }: AccordionProps) {
  const defaultOpenId = single ? (items.find((item) => item.defaultOpen)?.id ?? null) : null;
  const [openId, setOpenId] = useState<string | null>(defaultOpenId);

  const handleToggle = useCallback(
    (id: string, isOpen: boolean) => {
      if (!single) return;
      setOpenId(isOpen ? id : null);
    },
    [single]
  );

  return (
    <div className={`divide-y divide-border/60 ${className}`} role="list">
      {items.map((item) => {
        const extraProps = single ? { forcedOpen: openId === item.id, onToggle: handleToggle } : {};
        return <AccordionItemComponent key={item.id} item={item} {...extraProps} />;
      })}
    </div>
  );
}

function AccordionItemComponent({
  item,
  forcedOpen,
  onToggle,
}: {
  item: AccordionItem;
  forcedOpen?: boolean;
  onToggle?: (id: string, isOpen: boolean) => void;
}) {
  const headingId = useId();
  const panelId = useId();
  const [localOpen, setLocalOpen] = useState(item.defaultOpen ?? false);

  const isOpen = forcedOpen ?? localOpen;

  const handleToggle = (e: React.SyntheticEvent<HTMLDetailsElement>) => {
    const open = (e.target as HTMLDetailsElement).open;
    if (onToggle) {
      onToggle(item.id, open);
    } else {
      setLocalOpen(open);
    }
  };

  return (
    <details className="group" open={isOpen} onToggle={handleToggle} role="listitem">
      <summary
        id={headingId}
        className="
          flex cursor-pointer list-none items-center justify-between gap-2
          px-4 py-3 text-sm font-medium text-foreground
          transition-colors duration-200
          hover:bg-subtle/50
          group-open:bg-subtle/20
          focus-ring-standard
          [&::-webkit-details-marker]:hidden
        "
        aria-expanded={isOpen}
        aria-controls={panelId}
      >
        <span className="flex-1">{item.trigger}</span>
        <ChevronDown
          className="size-4 shrink-0 text-muted transition-transform duration-200 group-open:rotate-180"
          aria-hidden
        />
      </summary>

      <div
        id={panelId}
        role="region"
        aria-labelledby={headingId}
        className="accordion-content"
        data-open={isOpen}
      >
        <div className="overflow-hidden">
          <div className="px-4 pb-3 pt-1 text-sm text-foreground/90">{item.content}</div>
        </div>
      </div>
    </details>
  );
}
