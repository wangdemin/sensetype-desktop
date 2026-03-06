import type { RefObject } from 'react';
import { InfoButton } from '@/renderer/components/InfoListCard';
import { Modal } from '@/renderer/components/Modal';
import styles from '../todoList.module.scss';
import type { TodoItem } from '../hooks/todoList.types';

type Props = {
  open: boolean;
  editingGroupTitle: string;
  setEditingGroupTitle: (value: string) => void;
  editingGroupItems: TodoItem[];
  updateEditingGroupItem: (id: string, updates: Partial<TodoItem>) => void;
  deleteEditingGroupItem: (id: string) => void;
  addEditingGroupItem: () => void;
  editItemInputRefs: RefObject<Map<string, HTMLInputElement>>;
  onClose: () => void;
  onSave: () => void;
};

export const TodoEditModal = ({
  open,
  editingGroupTitle,
  setEditingGroupTitle,
  editingGroupItems,
  updateEditingGroupItem,
  deleteEditingGroupItem,
  addEditingGroupItem,
  editItemInputRefs,
  onClose,
  onSave,
}: Props) => (
  <Modal
    open={open}
    onClose={onClose}
    title={editingGroupTitle || '编辑待办组'}
    className={styles.editModal}
    footer={
      <div className={styles.modalFooter}>
        <button type="button" className={styles.actionButtonGhost} onClick={onClose}>
          取消
        </button>
        <InfoButton variant="primary" onClick={onSave}>
          保存
        </InfoButton>
      </div>
    }
  >
    <div className={styles.editModalContent}>
      <div className={styles.editGroupTitleWrapper}>
        <input
          className={styles.editGroupTitleInput}
          type="text"
          placeholder="组标题（可选）"
          value={editingGroupTitle}
          onChange={(e) => setEditingGroupTitle(e.target.value)}
        />
      </div>
      <div className={styles.editItemsList}>
        {editingGroupItems.map((item, index) => (
          <div key={item.id} className={styles.editItem}>
            <input
              className={styles.editCheckbox}
              type="checkbox"
              checked={item.done}
              onChange={(e) => updateEditingGroupItem(item.id, { done: e.target.checked })}
            />
            <input
              ref={(el) => {
                if (el) {
                  editItemInputRefs.current.set(item.id, el);
                } else {
                  editItemInputRefs.current.delete(item.id);
                }
              }}
              className={styles.editItemInput}
              type="text"
              placeholder={`任务 ${index + 1}`}
              value={item.text}
              onChange={(e) => updateEditingGroupItem(item.id, { text: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  if (item.text.trim()) {
                    addEditingGroupItem();
                  }
                } else if (e.key === 'Backspace' && !item.text && editingGroupItems.length > 1) {
                  e.preventDefault();
                  const currentIndex = editingGroupItems.findIndex((d) => d.id === item.id);
                  if (currentIndex > 0) {
                    const prevInput = editItemInputRefs.current.get(
                      editingGroupItems[currentIndex - 1].id,
                    );
                    prevInput?.focus();
                  }
                  deleteEditingGroupItem(item.id);
                }
              }}
            />
            <button
              type="button"
              className={styles.removeEditItemButton}
              onClick={() => deleteEditingGroupItem(item.id)}
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <button type="button" className={styles.addEditItemButton} onClick={addEditingGroupItem}>
        + 添加任务
      </button>
    </div>
  </Modal>
);
