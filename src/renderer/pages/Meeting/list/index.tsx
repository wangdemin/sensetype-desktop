import { useState, useEffect, useRef } from 'react';
import styles from '../index.module.scss';
import RenameDialog from '../components/RenameDialog';
import DeleteDialog from '../components/DeleteDialog';
import FileDocIcon from '@/assets/icons/meeting/file-doc.svg?react';
import SearchIcon from '@/assets/icons/meeting/search.svg?react';
import ClearIcon from '@/assets/icons/meeting/clear.svg?react';
import DotsMenuIcon from '@/assets/icons/meeting/dots-menu.svg?react';
import CheckIcon from '@/assets/icons/meeting/check.svg?react';

export type MeetingItem = {
  id: string;
  title: string;
  duration: string;
  date: string;
};

type MeetingListProps = {
  meetings: MeetingItem[];
  onRename: (id: string, newTitle: string) => void | Promise<boolean>;
  onDelete: (id: string) => void;
  isBatchMode: boolean;
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onNavigateToDetail?: (id: string) => void;
  onLoadMore?: () => void;
  hasMore?: boolean;
  isLoading?: boolean;
  total?: number;
  onSearchChange?: (search: string) => void;
};

const MeetingList = ({
  meetings,
  onRename,
  onDelete,
  isBatchMode,
  selectedIds,
  onToggleSelect,
  onNavigateToDetail,
  onLoadMore,
  hasMore = false,
  isLoading = false,
  total = 0,
  onSearchChange,
}: MeetingListProps) => {
  const [searchValue, setSearchValue] = useState('');
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [renameTarget, setRenameTarget] = useState<MeetingItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<MeetingItem | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const handleSearchChange = (value: string) => {
    setSearchValue(value);

    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    searchTimeoutRef.current = setTimeout(() => {
      onSearchChange?.(value);
    }, 500);
  };

  useEffect(() => {
    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container || !onLoadMore || !hasMore || isLoading) return;

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container;
      if (scrollHeight - scrollTop - clientHeight < 100) {
        onLoadMore();
      }
    };

    container.addEventListener('scroll', handleScroll);
    return () => container.removeEventListener('scroll', handleScroll);
  }, [onLoadMore, hasMore, isLoading]);

  const handleRenameConfirm = async (newTitle: string) => {
    if (!renameTarget) return;
    const success = await Promise.resolve(onRename(renameTarget.id, newTitle));
    if (success) setRenameTarget(null);
  };

  const handleDeleteConfirm = () => {
    if (!deleteTarget) return;
    onDelete(deleteTarget.id);
    setDeleteTarget(null);
  };

  return (
    <>
      <div className={styles.listSection}>
        <div className={styles.listSectionHeader}>
          <span className={styles.listSectionLabel}>历史纪要（{total}）</span>
          <div className={styles.searchBox}>
            <span className={styles.searchIconWrap}>
              <SearchIcon />
            </span>
            <input
              className={styles.searchInput}
              placeholder="请搜索内容..."
              value={searchValue}
              onChange={(e) => handleSearchChange(e.target.value)}
            />
            {searchValue && (
              <button
                className={styles.searchClear}
                onClick={() => {
                  setSearchValue('');
                  onSearchChange?.('');
                }}
              >
                <ClearIcon />
              </button>
            )}
          </div>
        </div>

        <div className={styles.cardList} ref={scrollContainerRef}>
          {meetings.map((item) => {
            const isSelected = selectedIds.has(item.id);
            return (
              <div
                key={item.id}
                className={[
                  styles.meetingCard,
                  isBatchMode ? styles.meetingCardBatch : '',
                  isSelected ? styles.meetingCardSelected : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                onClick={() => {
                  if (isBatchMode) {
                    onToggleSelect(item.id);
                  } else {
                    setOpenMenuId(null);
                    onNavigateToDetail?.(item.id);
                  }
                }}
              >
                {isBatchMode && (
                  <div className={styles.checkboxWrap}>
                    <span
                      className={`${styles.checkbox} ${isSelected ? styles.checkboxChecked : ''}`}
                    >
                      {isSelected && <CheckIcon />}
                    </span>
                  </div>
                )}

                <div className={styles.cardLeft}>
                  <div className={styles.fileIconWrap}>
                    <FileDocIcon />
                  </div>
                  <div className={styles.cardTexts}>
                    <p className={styles.cardTitle}>{item.title}</p>
                    <p className={styles.cardDuration}>{item.duration}</p>
                  </div>
                </div>

                <div className={styles.cardRight}>
                  <span className={styles.cardDate}>{item.date}</span>
                  {!isBatchMode && (
                    <div className={styles.menuWrap}>
                      <button
                        className={styles.menuTrigger}
                        onClick={(e) => {
                          e.stopPropagation();
                          setOpenMenuId(openMenuId === item.id ? null : item.id);
                        }}
                      >
                        <DotsMenuIcon />
                      </button>

                      {openMenuId === item.id && (
                        <>
                          <div
                            className={styles.menuOverlay}
                            onClick={(e) => {
                              e.stopPropagation();
                              setOpenMenuId(null);
                            }}
                          />
                          <div className={styles.contextMenu}>
                            <button
                              className={styles.contextMenuItem}
                              onClick={(e) => {
                                e.stopPropagation();
                                setOpenMenuId(null);
                                setRenameTarget(item);
                              }}
                            >
                              重命名
                            </button>
                            <button
                              className={`${styles.contextMenuItem} ${styles.contextMenuItemDanger}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                setOpenMenuId(null);
                                setDeleteTarget(item);
                              }}
                            >
                              删除
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          {isLoading && <div className={styles.loadingMore}>加载中...</div>}

          {!isLoading && meetings.length === 0 && (
            <div className={styles.emptyState}>暂无会议记录</div>
          )}

          {!isLoading && !hasMore && meetings.length > 0 && (
            <div className={styles.noMoreData}>没有更多数据了</div>
          )}
        </div>
      </div>

      {renameTarget && (
        <RenameDialog
          initialTitle={renameTarget.title}
          onConfirm={handleRenameConfirm}
          onCancel={() => setRenameTarget(null)}
        />
      )}

      {deleteTarget && (
        <DeleteDialog onConfirm={handleDeleteConfirm} onCancel={() => setDeleteTarget(null)} />
      )}
    </>
  );
};

export default MeetingList;
