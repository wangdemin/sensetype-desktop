import type { RefObject } from 'react';
import CloseIcon from '@/assets/icons/close.svg?react';
import SearchIcon from '@/assets/icons/notes-search.svg?react';
import SortIcon from '@/assets/icons/notes-sort.svg?react';
import DeleteAll from '@/assets/icons/notes-more-delete.svg?react';
import styles from '../todoList.module.scss';
import stylesNotes from '../index.module.scss';

type Props = {
  groupCount: number;
  queryInput: string;
  setQueryInput: (value: string) => void;
  layout: string;
  toggleLayout: () => void;
  searchInputRef: RefObject<HTMLInputElement | null>;
  isBatchMode: boolean;
  setIsBatchMode: (v: boolean) => void;
  onSelectAll: () => void;
  onDeleteSelected: () => void;
  selectedCount: number;
};

export const TodoListHeader = ({
  groupCount,
  queryInput,
  setQueryInput,
  layout,
  toggleLayout,
  searchInputRef,
  isBatchMode,
  setIsBatchMode,
  onSelectAll,
  onDeleteSelected,
  selectedCount,
}: Props) => (
  <div className={styles.listHeader}>
    <div className={styles.listTitle}>
      {isBatchMode ? (
        <span>已选择 {selectedCount} 项</span>
      ) : (
        <>
          待办列表 <span className={styles.countBadge}>{groupCount}</span>
        </>
      )}
    </div>
    <div className={styles.listActions}>
      {isBatchMode ? (
        <>
          <button
            type="button"
            className={stylesNotes.textButton}
            onClick={onSelectAll}
          >
            全选
          </button>
          <button
            type="button"
            className={stylesNotes.textButtonDanger}
            onClick={onDeleteSelected}
            disabled={selectedCount === 0}
          >
            删除
          </button>
          <button
            type="button"
            className={stylesNotes.textButton}
            onClick={() => setIsBatchMode(false)}
          >
            取消
          </button>
        </>
      ) : (
        <>
          <div className={styles.searchArea}>
            <div className={styles.searchBox}>
              <SearchIcon className={styles.searchIcon} />
              <input
                className={styles.searchInput}
                placeholder="搜索待办"
                value={queryInput}
                onChange={(e) => setQueryInput(e.target.value)}
                ref={searchInputRef}
              />
              {queryInput && (
                <button
                  type="button"
                  className={styles.searchClear}
                  aria-label="清空搜索"
                  onClick={(e) => {
                    e.preventDefault();
                    setQueryInput('');
                    window.setTimeout(() => searchInputRef.current?.focus(), 0);
                  }}
                >
                  <CloseIcon className={styles.searchCloseIcon} />
                </button>
              )}
            </div>
          </div>
          <button
            type="button"
            className={stylesNotes.layoutButton}
            onClick={() => setIsBatchMode(true)}
          >
            <DeleteAll className={stylesNotes.deleteAllIcon} />
          </button>
          <button
            type="button"
            className={`${stylesNotes.layoutButton} ${stylesNotes[`layout-${layout}`]}`}
            onClick={toggleLayout}
            aria-label="切换布局"
          >
            <SortIcon className={stylesNotes.sortIcon} />
          </button>
        </>
      )}
    </div>
  </div>
);
