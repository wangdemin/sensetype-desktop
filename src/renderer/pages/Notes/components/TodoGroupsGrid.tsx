import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import styles from '../todoList.module.scss';
import type { TodoGroup } from '../hooks/todoList.types';
import stylesNotes from '../index.module.scss';
import NotesButtonIcon from '@/assets/icons/notes-button.svg?react';
import DeleteIcon from '@/assets/icons/notes-delete.svg?react';
import PushpinIcon from '@/assets/icons/notes-pushpin.svg?react';
import CopyIcon from '@/assets/icons/notes-copy.svg?react';
import DoneIcon from '@/assets/icons/todolist-done.svg?react';
import { formatDateTime, toTimestamp } from '../hooks/notesUtils';

type Props = {
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  onLoadMore: () => void;
  groups: TodoGroup[];
  layoutClass: string;
  rowSpans: Record<string, number>;
  gridRef: RefObject<HTMLDivElement | null>;
  cardRefs: RefObject<Map<string, HTMLDivElement>>;
  toggleDone: (id: string) => void;
  openEditGroup: (groupId: string) => void;
  deleteGroup: (groupId: string) => void;
  openStickyNoteIds?: Set<string>;
  isBatchMode?: boolean;
  selectedGroupIds?: Set<string>;
  toggleGroupSelection?: (groupId: string) => void;
};

export const TodoGroupsGrid = ({
  isBatchMode = false,
  loading,
  loadingMore,
  hasMore,
  onLoadMore,
  groups,
  layoutClass,
  rowSpans,
  gridRef,
  cardRefs,
  toggleDone,
  openEditGroup,
  deleteGroup,
  openStickyNoteIds,
  selectedGroupIds,
  toggleGroupSelection,
}: Props) => {
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);

  const closeMenu = useCallback(() => setActiveMenuId(null), []);
  const toggleMenu = useCallback((groupId: string) => {
    setActiveMenuId((prev) => (prev === groupId ? null : groupId));
  }, []);

  useEffect(() => {
    if (!activeMenuId) return;

    const onMouseDownCapture = (ev: MouseEvent) => {
      const target = ev.target as HTMLElement | null;
      if (!target) return;
      if (target.closest('[data-todo-group-menu-root="true"]')) return;
      closeMenu();
    };

    document.addEventListener('mousedown', onMouseDownCapture, true);
    return () => document.removeEventListener('mousedown', onMouseDownCapture, true);
  }, [activeMenuId, closeMenu]);

  useEffect(() => {
    const el = loadMoreRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const [entry] = entries;
        if (entry?.isIntersecting && hasMore && !loadingMore && !loading) {
          onLoadMore();
        }
      },
      { root: null, rootMargin: '200px 0px', threshold: 0 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore, loading, loadingMore, onLoadMore]);

  return (
    <div ref={gridRef} className={`${styles.groupsGrid} ${layoutClass}`}>
      {groups.map((group) => {
        const visibleItems = group.items.filter((item) => item.text.trim());
        const completedCount = visibleItems.filter((item) => item.done).length;
        const totalCount = visibleItems.length;
        const timeLabel = formatDateTime(toTimestamp(group.createdAt));
        const isSelected = selectedGroupIds?.has(group.groupId);

        return (
          <div
            key={group.groupId}
            className={`${styles.groupCard} ${isSelected ? stylesNotes.noteCardSelected : ''}`}
            onClick={() => {
              if (isBatchMode && toggleGroupSelection) {
                toggleGroupSelection(group.groupId);
                return;
              }
              const selection = window.getSelection();
              if (selection && selection.toString().length > 0) {
                return;
              }
              openEditGroup(group.groupId);
            }}
            style={
              rowSpans[group.groupId]
                ? { gridRowEnd: `span ${rowSpans[group.groupId]}` }
                : undefined
            }
            ref={(el) => {
              if (el) {
                cardRefs.current?.set(group.groupId, el);
              } else {
                cardRefs.current?.delete(group.groupId);
              }
            }}
          >
            {isBatchMode && (
              <label className={stylesNotes.batchCheckbox} onClick={(e) => e.stopPropagation()}>
                <input
                  type="checkbox"
                  checked={isSelected || false}
                  onChange={() => toggleGroupSelection?.(group.groupId)}
                />
              </label>
            )}
            {!isBatchMode && (
              <span
                className={`${styles.pushpinIcon} ${
                  openStickyNoteIds?.has(group.groupId) ? styles.active : ''
                }`}
                title="置顶屏幕"
                role="button"
                tabIndex={0}
                aria-label="置顶屏幕"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  closeMenu();
                  try {
                    const ipc = (window as any).electronAPI?.ipcRenderer;
                    ipc?.send?.('create-sticky-note', {
                      type: 'todo',
                      id: group.groupId,
                    });
                  } catch {
                    // ignore
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter' && e.key !== ' ') return;
                  e.preventDefault();
                  e.stopPropagation();
                  closeMenu();
                  try {
                    const ipc = (window as any).electronAPI?.ipcRenderer;
                    ipc?.send?.('create-sticky-note', {
                      type: 'todo',
                      id: group.groupId,
                    });
                  } catch {
                    // ignore
                  }
                }}
              >
                <PushpinIcon />
              </span>
            )}
            <div className={styles.groupHeader}>
              <h3 className={styles.groupTitle}>
                {group.groupTitle ? group.groupTitle : '未命名的'}
              </h3>
              {!isBatchMode && (
                <div className={styles.groupHeaderMeta}>
                  <DoneIcon />
                  <span className={styles.groupStats}>
                    完成 {completedCount}/{totalCount}
                  </span>
                </div>
              )}
            </div>

            <div className={styles.groupItems}>
              {visibleItems.map((item) => (
                <div
                  key={item.id}
                  className={styles.groupItem}
                  onClick={(e) => {
                    e.stopPropagation();
                  }}
                >
                  <label className={styles.itemLeft}>
                    {!isBatchMode && (
                      <input
                        className={styles.checkbox}
                        type="checkbox"
                        checked={item.done}
                        disabled={isBatchMode}
                        onChange={() => toggleDone(item.id)}
                        onClick={(e) => e.stopPropagation()}
                      />
                    )}
                    <span className={`${styles.itemText} ${item.done ? styles.itemTextDone : ''}`}>
                      {item.text}
                    </span>
                  </label>
                </div>
              ))}
            </div>
            <div className={`${styles.groupFooter} ${stylesNotes.noteFooter}`}>
              <div
                className={`${styles.groupActions} ${stylesNotes.noteActions}`}
                data-todo-group-menu-root="true"
              >
                {!isBatchMode && (
                  <button
                    type="button"
                    className={stylesNotes.menuButton}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleMenu(group.groupId);
                    }}
                    aria-label="清单操作"
                  >
                    <NotesButtonIcon />
                  </button>
                )}

                {activeMenuId === group.groupId ? (
                  <div
                    className={stylesNotes.menuPanel}
                    onClick={(e) => e.stopPropagation()}
                    data-todo-group-menu-root="true"
                  >
                    <button
                      type="button"
                      className={stylesNotes.menuItem}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        closeMenu();
                        openEditGroup(group.groupId);
                      }}
                    >
                      <CopyIcon className={stylesNotes.menuItemIcon} />
                      编辑
                    </button>

                    <button
                      type="button"
                      className={stylesNotes.menuItemDanger}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        closeMenu();
                        deleteGroup(group.groupId);
                      }}
                    >
                      <DeleteIcon className={stylesNotes.menuItemIcon} />
                      删除
                    </button>
                  </div>
                ) : null}
              </div>

              <span className={stylesNotes.noteTime}>{timeLabel}</span>
            </div>
          </div>
        );
      })}
      <div ref={loadMoreRef} className={stylesNotes.loadMoreTrigger} />
      {groups.length > 0 ? (
        <div className={stylesNotes.loadMoreStatus}>
          {loading
            ? '\u00A0'
            : loadingMore
              ? '加载更多...'
              : hasMore
                ? '下拉加载更多'
                : '没有更多了'}
        </div>
      ) : null}
    </div>
  );
};
