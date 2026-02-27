import type { KeyboardEvent, ReactNode } from 'react';
import { useCallback, useMemo, useState } from 'react';
import { ChevronRight, Loader2 } from 'lucide-react';

import {
  DndContext,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';

export type TreeNode = Readonly<{
  id: string;
  label: ReactNode;
  children?: readonly TreeNode[];
  hasChildren?: boolean;
  disabled?: boolean;
}>;

type FlatNode = Readonly<{
  id: string;
  node: TreeNode;
  depth: number;
  parentId: string | null;
  hasChildren: boolean;
}>;

export type TreeViewProps = Readonly<{
  nodes?: readonly TreeNode[];
  data?: readonly TreeNode[];

  selectedId?: string | null;
  onSelect?: (id: string) => void;
  selected?: string | null;

  expandedIds?: readonly string[];
  defaultExpandedIds?: readonly string[];
  onExpandedIdsChange?: (ids: string[]) => void;

  expanded?: readonly string[];
  onExpand?: (ids: string[]) => void;

  multiSelect?: boolean;
  selectedIds?: readonly string[];
  defaultSelectedIds?: readonly string[];
  onSelectedIdsChange?: (ids: string[]) => void;

  loadChildren?: (nodeId: string) => Promise<readonly TreeNode[]>;

  draggable?: boolean;
  onMove?: (sourceId: string, targetId: string) => void;

  className?: string;
  itemClassName?: string;
  ariaLabel?: string;
}>;

function flattenTree(
  nodes: readonly TreeNode[],
  expanded: Set<string>,
  loadedChildren: Map<string, readonly TreeNode[]>
): FlatNode[] {
  const out: FlatNode[] = [];

  const walk = (list: readonly TreeNode[], depth: number, parentId: string | null) => {
    for (const n of list) {
      const children = n.children ?? loadedChildren.get(n.id);
      const hasChildren = Boolean(children?.length) || Boolean(n.hasChildren);
      out.push({ id: n.id, node: n, depth, parentId, hasChildren });
      if (hasChildren && expanded.has(n.id)) {
        if (children) walk(children, depth + 1, n.id);
      }
    }
  };

  walk(nodes, 0, null);
  return out;
}

function toggle(set: Set<string>, id: string): Set<string> {
  const next = new Set(set);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

function TreeRow(props: {
  flat: FlatNode;
  isSelected: boolean;
  isExpanded: boolean;
  isLoadingChildren: boolean;
  draggable: boolean;
  onToggleExpand: (id: string) => void;
  onSelect: (id: string, meta: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) => void;
  tabIndex: number;
  onFocus: () => void;
  itemClassName?: string | undefined;
}) {
  const {
    flat,
    isSelected,
    isExpanded,
    isLoadingChildren,
    draggable,
    onToggleExpand,
    onSelect,
    tabIndex,
    onFocus,
    itemClassName,
  } = props;

  const disabled = !draggable || Boolean(flat.node.disabled);
  const droppable = useDroppable({ id: flat.id, disabled });
  const draggableHook = useDraggable({ id: flat.id, disabled });

  const indentPx = flat.depth * 20;

  return (
    <div
      ref={droppable.setNodeRef}
      role="treeitem"
      aria-selected={isSelected}
      aria-expanded={flat.hasChildren ? isExpanded : undefined}
      tabIndex={tabIndex}
      onFocus={onFocus}
      className={`relative flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm text-foreground outline-none transition-colors duration-150 focus-visible:shadow-[0_0_0_3px_rgba(59,130,246,0.15)] dark:focus-visible:shadow-[0_0_0_3px_rgba(96,165,250,0.2)] ${
        isSelected
          ? 'bg-blue-50/80 dark:bg-blue-900/20'
          : 'hover:bg-subtle/70 dark:hover:bg-slate-800/50'
      } ${itemClassName ?? ''}`}
      style={{ paddingLeft: indentPx + 10 }}
      data-dnd-over={droppable.isOver ? 'true' : 'false'}
    >
      {flat.depth > 0 ? (
        <span
          className="pointer-events-none absolute left-0 top-0 bottom-0"
          aria-hidden
          style={{ width: indentPx }}
        >
          {Array.from({ length: flat.depth }, (_, i) => (
            <span
              key={i}
              className="absolute top-0 bottom-0 w-px bg-slate-200 dark:bg-slate-700"
              style={{ left: i * 20 + 14 }}
            />
          ))}
        </span>
      ) : null}

      {flat.hasChildren ? (
        <button
          type="button"
          className="flex size-6 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-subtle dark:hover:bg-slate-700/60"
          onClick={() => onToggleExpand(flat.id)}
          aria-label={isExpanded ? 'Restrânge' : 'Extinde'}
        >
          <ChevronRight
            className={`size-4 text-muted transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`}
          />
        </button>
      ) : (
        <span className="size-6 shrink-0" />
      )}

      <button
        type="button"
        className="flex-1 text-left"
        onClick={(e) =>
          onSelect(flat.id, { ctrlKey: e.ctrlKey, metaKey: e.metaKey, shiftKey: e.shiftKey })
        }
      >
        {flat.node.label}
      </button>

      {isLoadingChildren ? (
        <Loader2 className="size-3.5 animate-spin text-muted" aria-label="Se încarcă…" />
      ) : null}

      {draggable ? (
        <button
          type="button"
          className="cursor-grab select-none rounded-md px-2 py-1 text-xs text-muted transition-colors hover:bg-subtle dark:hover:bg-slate-700/60"
          {...draggableHook.attributes}
          {...draggableHook.listeners}
          ref={draggableHook.setNodeRef}
          aria-label="Drag"
        >
          ⋮⋮
        </button>
      ) : null}
    </div>
  );
}

export function TreeView(props: TreeViewProps) {
  const {
    nodes: nodesProp,
    data,
    selectedId,
    onSelect,
    selected,
    expandedIds,
    expanded,
    defaultExpandedIds,
    onExpandedIdsChange,
    onExpand,
    multiSelect = false,
    selectedIds,
    defaultSelectedIds,
    onSelectedIdsChange,
    loadChildren,
    draggable = false,
    onMove,
    className,
    itemClassName,
    ariaLabel = 'Tree',
  } = props;

  const nodes = nodesProp ?? data ?? [];

  const [internalSelectedId, setInternalSelectedId] = useState<string | null>(null);
  const [internalSelectedIds, setInternalSelectedIds] = useState<Set<string>>(
    () => new Set(defaultSelectedIds ?? [])
  );
  const [internalExpanded, setInternalExpanded] = useState<Set<string>>(
    () => new Set(defaultExpandedIds ?? [])
  );

  const [loadedChildren, setLoadedChildren] = useState<Map<string, readonly TreeNode[]>>(
    () => new Map()
  );
  const [loadingChildren, setLoadingChildren] = useState<Set<string>>(() => new Set());

  const expandedSet = useMemo(() => {
    if (expandedIds ?? expanded) return new Set(expandedIds ?? expanded);
    return internalExpanded;
  }, [expanded, expandedIds, internalExpanded]);

  const flat = useMemo(
    () => flattenTree(nodes, expandedSet, loadedChildren),
    [nodes, expandedSet, loadedChildren]
  );

  const selectedSingle = selectedId ?? selected ?? internalSelectedId;
  const selectedSet = useMemo(() => {
    if (!multiSelect) return new Set(selectedSingle ? [selectedSingle] : []);
    if (selectedIds) return new Set(selectedIds);
    if (selectedSingle) return new Set([selectedSingle]);
    return internalSelectedIds;
  }, [internalSelectedIds, multiSelect, selectedIds, selectedSingle]);

  const [activeId, setActiveId] = useState<string | null>(
    () => selectedSingle ?? flat[0]?.id ?? null
  );

  const idToIndex = useMemo(() => {
    const m = new Map<string, number>();
    flat.forEach((n, i) => m.set(n.id, i));
    return m;
  }, [flat]);

  const idToParent = useMemo(() => {
    const m = new Map<string, string | null>();
    for (const n of flat) m.set(n.id, n.parentId);
    return m;
  }, [flat]);

  const updateExpanded = useCallback(
    (next: Set<string>) => {
      if (expandedIds ?? expanded) {
        onExpandedIdsChange?.([...next]);
        onExpand?.([...next]);
        return;
      }
      setInternalExpanded(next);
      onExpandedIdsChange?.([...next]);
      onExpand?.([...next]);
    },
    [expanded, expandedIds, onExpand, onExpandedIdsChange]
  );

  const handleToggleExpand = useCallback(
    (id: string) => {
      const isExpanding = !expandedSet.has(id);

      if (isExpanding && loadChildren) {
        const node = flat.find((n) => n.id === id)?.node;
        const already = loadedChildren.get(id);
        const canLazyLoad = Boolean(node?.hasChildren) && !node?.children?.length;

        if (canLazyLoad && !already && !loadingChildren.has(id)) {
          setLoadingChildren((prev) => new Set(prev).add(id));
          void loadChildren(id)
            .then((children) => {
              setLoadedChildren((prev) => {
                const next = new Map(prev);
                next.set(id, children);
                return next;
              });
            })
            .finally(() => {
              setLoadingChildren((prev) => {
                const next = new Set(prev);
                next.delete(id);
                return next;
              });
            });
        }
      }

      updateExpanded(toggle(expandedSet, id));
    },
    [expandedSet, flat, loadChildren, loadedChildren, loadingChildren, updateExpanded]
  );

  const handleSelect = useCallback(
    (id: string, meta?: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) => {
      setActiveId(id);

      if (!multiSelect) {
        if (selectedId !== undefined || selected !== undefined) {
          onSelect?.(id);
          return;
        }
        setInternalSelectedId(id);
        onSelect?.(id);
        return;
      }

      const m = meta ?? { ctrlKey: false, metaKey: false, shiftKey: false };
      const toggleOne = (prev: Set<string>) => {
        const next = new Set(prev);
        const shouldToggle = m.ctrlKey || m.metaKey;
        if (shouldToggle) {
          if (next.has(id)) next.delete(id);
          else next.add(id);
        } else {
          next.clear();
          next.add(id);
        }
        return next;
      };

      if (selectedIds) {
        const next = toggleOne(new Set(selectedIds));
        onSelectedIdsChange?.([...next]);
        onSelect?.(id);
        return;
      }

      setInternalSelectedIds((prev) => {
        const next = toggleOne(prev);
        onSelectedIdsChange?.([...next]);
        return next;
      });
      onSelect?.(id);
    },
    [multiSelect, onSelect, onSelectedIdsChange, selected, selectedId, selectedIds]
  );

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const onDragEnd = useCallback(
    (event: DragEndEvent) => {
      if (!onMove) return;
      const sourceId = String(event.active.id);
      const targetId = event.over ? String(event.over.id) : '';
      if (!targetId || sourceId === targetId) return;
      onMove(sourceId, targetId);
    },
    [onMove]
  );

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (!flat.length) return;
      const currentId = activeId ?? flat[0]?.id;
      if (!currentId) return;

      const index = idToIndex.get(currentId) ?? 0;
      const current = flat[index];
      if (!current) return;

      const moveToIndex = (nextIndex: number) => {
        const next = flat[Math.max(0, Math.min(flat.length - 1, nextIndex))];
        if (!next) return;
        setActiveId(next.id);
      };

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          moveToIndex(index + 1);
          break;
        case 'ArrowUp':
          e.preventDefault();
          moveToIndex(index - 1);
          break;
        case 'ArrowRight':
          e.preventDefault();
          if (current.hasChildren && !expandedSet.has(current.id)) {
            updateExpanded(toggle(expandedSet, current.id));
          } else {
            moveToIndex(index + 1);
          }
          break;
        case 'ArrowLeft':
          e.preventDefault();
          if (current.hasChildren && expandedSet.has(current.id)) {
            updateExpanded(toggle(expandedSet, current.id));
          } else {
            const parentId = idToParent.get(current.id);
            if (parentId) setActiveId(parentId);
          }
          break;
        case 'Enter':
        case ' ':
          e.preventDefault();
          handleSelect(current.id, {
            ctrlKey: e.ctrlKey,
            metaKey: e.metaKey,
            shiftKey: e.shiftKey,
          });
          break;
        default:
          break;
      }
    },
    [activeId, expandedSet, flat, handleSelect, idToIndex, idToParent, updateExpanded]
  );

  const focusedId = activeId ?? selectedSingle ?? flat[0]?.id ?? null;

  const content = (
    <div role="tree" aria-label={ariaLabel} className={className} onKeyDown={onKeyDown}>
      {flat.map((n) => (
        <TreeRow
          key={n.id}
          flat={n}
          isSelected={selectedSet.has(n.id)}
          isExpanded={expandedSet.has(n.id)}
          isLoadingChildren={loadingChildren.has(n.id)}
          draggable={draggable}
          onToggleExpand={handleToggleExpand}
          onSelect={(id, meta) => handleSelect(id, meta)}
          tabIndex={focusedId === n.id ? 0 : -1}
          onFocus={() => setActiveId(n.id)}
          itemClassName={itemClassName}
        />
      ))}
    </div>
  );

  if (!draggable) return content;

  return (
    <DndContext sensors={sensors} onDragEnd={onDragEnd}>
      {content}
    </DndContext>
  );
}
