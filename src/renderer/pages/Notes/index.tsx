import { useCallback, useState } from 'react';
import styles from '../common.module.scss';
import stylesNotes from './index.module.scss';
import TodoListPage from './todoList';
import NotesList from './notesList';

const NotesPage = () => {
  const [activeTab, setActiveTab] = useState<'notes' | 'todos'>(() => {
    try {
      const saved = window.localStorage.getItem('notes_active_tab');
      return saved === 'todos' ? 'todos' : 'notes';
    } catch {
      return 'notes';
    }
  });

  const onChangeTab = useCallback((next: 'notes' | 'todos') => {
    setActiveTab(next);
    try {
      window.localStorage.setItem('notes_active_tab', next);
    } catch {
      // ignore
    }
  }, []);

  return (
    <div className={`${styles.page} ${stylesNotes.notes}`}>
      <div className={stylesNotes.tabContainer} role="tablist" aria-label="笔记与待办切换">
        <div
          role="tab"
          aria-selected={activeTab === 'notes'}
          className={`${stylesNotes.tab} ${activeTab === 'notes' ? stylesNotes.tabActive : ''}`}
          onClick={() => onChangeTab('notes')}
        >
          笔记
        </div>
        <div
          role="tab"
          aria-selected={activeTab === 'todos'}
          className={`${stylesNotes.tab} ${activeTab === 'todos' ? stylesNotes.tabActive : ''}`}
          onClick={() => onChangeTab('todos')}
        >
          待办事项
        </div>
      </div>

      {activeTab === 'todos' ? <TodoListPage embedded /> : <NotesList />}
    </div>
  );
};

export default NotesPage;
