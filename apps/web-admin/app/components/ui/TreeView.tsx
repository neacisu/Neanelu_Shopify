import type { KeyboardEvent, ReactNode } from 'react';
import { useCallback, useMemo, useState } from 'react';

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
  nodes: readonly TreeNode[];

  /** Controlled selection */
  selectedId?: string | null;
  onSelect?: (id: string) => void;

  /** Controlled expansion */
  expandedIds?: readonly string[];
  defaultExpandedIds?: readonly string[];
  onExpandedIdsChange?: (ids: string[]) => void;

  /** Enable drag & drop (source/target ids). */
  draggable?: boolean;
  onMove?: (sourceId: string, targetId: string) => void;

  className?: string;
  itemClassName?: string;
  ariaLabel?: string;
}>;

function flattenTree(nodes: readonly TreeNode[], expanded: Set<string>): FlatNode[] {
  const out: FlatNode[] = [];

  const walk = (list: readonly TreeNode[], depth: number, parentId: string | null) => {
    for (const n of list) {
      const hasChildren = Boolean(n.children?.length);
      out.push({ id: n.id, node: n, depth, parentId, hasChildren });
      if (hasChildren && expanded.has(n.id)) {
        walk(n.children!, depth + 1, n.id);
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
  draggable: boolean;
  onToggleExpand: (id: string) => void;
  onSelect: (id: string) => void;
  tabIndex: number;
  onFocus: () => void;
  itemClassName?: string | undefined;
}) {
  const {
    flat,
    isSelected,
    isExpanded,
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

  const indentPx = flat.depth * 16;

  return (
    <div
      ref={droppable.setNodeRef}
      role="treeitem"
      aria-selected={isSelected}
      aria-expanded={flat.hasChildren ? isExpanded : undefined}
      tabIndex={tabIndex}
      onFocus={onFocus}
      className={`flex items-center gap-2 rounded-sm px-2 py-1 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring ${
        isSelected ? 'bg-muted/20' : 'hover:bg-muted/10'
      } ${itemClassName ?? ''}`}
      style={{ paddingLeft: indentPx }}
      data-dnd-over={droppable.isOver ? 'true' : 'false'}
    >
      {flat.hasChildren ? (
        <button
          type="button"
          className="h-6 w-6 shrink-0 rounded-sm hover:bg-black/5"
          onClick={() => onToggleExpand(flat.id)}
          aria-label={isExpanded ? 'Collapse' : 'Expand'}
        >
          {isExpanded ? '▾' : '▸'}
        </button>
      ) : (
        <span className="h-6 w-6 shrink-0" />
      )}

      <button type="button" className="flex-1 text-left" onClick={() => onSelect(flat.id)}>
        {flat.node.label}
      </button>

      {draggable ? (
        <button
          type="button"
          className="cursor-grab select-none rounded-sm px-2 py-1 text-xs text-muted hover:bg-black/5"
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
    nodes,
    selectedId,
    onSelect,
    expandedIds,
    defaultExpandedIds,
    onExpandedIdsChange,
    draggable = false,
    onMove,
    className,
    itemClassName,
    ariaLabel = 'Tree',
  } = props;

  const [internalSelectedId, setInternalSelectedId] = useState<string | null>(null);
  const [internalExpanded, setInternalExpanded] = useState<Set<string>>(
    () => new Set(defaultExpandedIds ?? [])
  );

  const expandedSet = useMemo(() => {
    if (expandedIds) return new Set(expandedIds);
    return internalExpanded;
  }, [expandedIds, internalExpanded]);

  const flat = useMemo(() => flattenTree(nodes, expandedSet), [nodes, expandedSet]);

  const selected = selectedId ?? internalSelectedId;
  const [activeId, setActiveId] = useState<string | null>(() => selected ?? flat[0]?.id ?? null);

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
      if (expandedIds) {
        onExpandedIdsChange?.([...next]);
        return;
      }
      setInternalExpanded(next);
      onExpandedIdsChange?.([...next]);
    },
    [expandedIds, onExpandedIdsChange]
  );

  const handleToggleExpand = useCallback(
    (id: string) => {
      updateExpanded(toggle(expandedSet, id));
    },
    [expandedSet, updateExpanded]
  );

  const handleSelect = useCallback(
    (id: string) => {
      setActiveId(id);
      if (selectedId !== undefined) {
        onSelect?.(id);
        return;
      }
      setInternalSelectedId(id);
      onSelect?.(id);
    },
    [onSelect, selectedId]
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
          handleSelect(current.id);
          break;
        default:
          break;
      }
    },
    [activeId, expandedSet, flat, handleSelect, idToIndex, idToParent, updateExpanded]
  );

  const content = (
    <div role="tree" aria-label={ariaLabel} className={className} onKeyDown={onKeyDown}>
      {flat.map((n) => (
        <TreeRow
          key={n.id}
          flat={n}
          isSelected={selected === n.id}
          isExpanded={expandedSet.has(n.id)}
          draggable={draggable}
          onToggleExpand={handleToggleExpand}
          onSelect={handleSelect}
          tabIndex={(activeId ?? selected ?? flat[0]?.id) === n.id ? 0 : -1}
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
