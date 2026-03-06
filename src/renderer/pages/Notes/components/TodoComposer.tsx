import type { RefObject } from 'react';
import { InfoButton } from '@/renderer/components/InfoListCard';
import styles from '../todoList.module.scss';
import type { DraftItem } from '../hooks/todoList.types';
import AddIcon from '@/assets/icons/todolist-add.svg?react';
import InfoIcon from '@/assets/icons/notes-info.svg?react';
import CloseIcon from '@/assets/icons/todolist-close.svg?react';

const MAX_DRAFT_ITEMS = 20;
const MAX_INPUT_LENGTH = 200;

type Props = {
  groupTitle: string;
  setGroupTitle: (value: string) => void;
  draftItems: DraftItem[];
  updateDraftItem: (id: string, updates: Partial<DraftItem>) => void;
  addDraftItem: (focusNewItem?: boolean) => void;
  removeDraftItem: (id: string) => void;
  draftInputRefs: RefObject<Map<string, HTMLInputElement>>;
  onSave: () => void;
};

export const TodoComposer = ({
  groupTitle,
  setGroupTitle,
  draftItems,
  updateDraftItem,
  addDraftItem,
  removeDraftItem,
  draftInputRefs,
  onSave,
}: Props) => (
  <div className={styles.composer}>
    <div className={styles.groupBg}>
      <div className={styles.groupTitleWrapper}>
        <input
          className={styles.groupTitleInput}
          type="text"
          placeholder="请输入标题（可选）"
          value={groupTitle}
          onChange={(e) => {
            const value = e.target.value;
            if (value.length <= MAX_INPUT_LENGTH) {
              setGroupTitle(value);
            }
          }}
          maxLength={MAX_INPUT_LENGTH}
        />
        {groupTitle.length > 0 && (
          <span className={styles.charCount}>
            {groupTitle.length}/{MAX_INPUT_LENGTH}
          </span>
        )}
      </div>
      <div className={styles.draftItemsList}>
        {draftItems.map((item, index) => (
          <div key={item.id} className={styles.draftItem}>
            <input
              ref={(el) => {
                if (el) {
                  draftInputRefs.current.set(item.id, el);
                } else {
                  draftInputRefs.current.delete(item.id);
                }
              }}
              className={styles.draftInput}
              type="text"
              placeholder={`请输入内容`}
              value={item.text}
              onChange={(e) => {
                const value = e.target.value;
                if (value.length <= MAX_INPUT_LENGTH) {
                  updateDraftItem(item.id, { text: value });
                }
              }}
              maxLength={MAX_INPUT_LENGTH}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  if (draftItems.length < MAX_DRAFT_ITEMS) {
                    addDraftItem(true);
                  }
                } else if (e.key === 'Backspace' && !item.text && draftItems.length > 1) {
                  e.preventDefault();
                  const currentIndex = draftItems.findIndex((d) => d.id === item.id);
                  if (currentIndex > 0) {
                    const prevInput = draftInputRefs.current.get(draftItems[currentIndex - 1].id);
                    prevInput?.focus();
                  }
                  removeDraftItem(item.id);
                }
              }}
            />
            {item.text.length > 0 && (
              <span className={styles.charCount}>
                {item.text.length}/{MAX_INPUT_LENGTH}
              </span>
            )}

            {draftItems.length > 1 && (
              <CloseIcon
                className={styles.removeDraftButton}
                onClick={() => removeDraftItem(item.id)}
              />
            )}
            {/* <AddIcon 
              className={styles.addDraftButton} 
              onClick={() => {
                if (draftItems.length < MAX_DRAFT_ITEMS) {
                  addDraftItem(true);
                }
              }}
              style={{ 
                opacity: draftItems.length >= MAX_DRAFT_ITEMS ? 0.5 : 1,
                cursor: draftItems.length >= MAX_DRAFT_ITEMS ? 'not-allowed' : 'pointer'
              }}
            /> */}
          </div>
        ))}
      </div>
    </div>
    <div className={styles.composerFooter}>
      <span className={styles.composerHint}>
        <span className={styles.composerHintIcon}>
          <InfoIcon />
        </span>
        {/* 点击加号或回车添加子项 */}
        回车添加子项 {draftItems.length}/{MAX_DRAFT_ITEMS}
      </span>
      <InfoButton
        variant="primary"
        onClick={onSave}
        disabled={!(draftItems.some((item) => item.text.trim()) || groupTitle.trim())}
      >
        完成
      </InfoButton>
    </div>
  </div>
);
