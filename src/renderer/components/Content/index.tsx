import styles from './index.module.scss';
import type { PageKey } from '@/renderer/types/navigation';
import HomePage from '../../pages/Home';
import HistoryPage from '../../pages/History';
import AccountPage from '../../pages/Account';
import NotePage from '../../pages/Notes';
import SettingsPage from '../../pages/Settings';
import AboutPage from '../../pages/About';
import VersionPage from '../../pages/Version';
import UsagePage from '../../pages/Usage';
import MeetingPage from '../../pages/Meeting';
import DictionariesPage from '../../pages/Dictionaries';
import PhrasePage from '../../pages/Phrase';

type ContentProps = {
  currentPage: PageKey;
};

const Content = ({ currentPage }: ContentProps) => {
  const renderPage = () => {
    switch (currentPage) {
      case 'home':
        return <HomePage />;
      case 'history':
        return <HistoryPage />;
      case 'account':
        return <AccountPage />;
      case 'notes':
        return <NotePage />;
      case 'meeting':
        return <MeetingPage />;
      case 'settings':
        return <SettingsPage />;
      case 'about':
        return <AboutPage />;
      case 'version':
        return <VersionPage />;
      case 'usage':
        return <UsagePage />;
      case 'dictionaries':
        return <DictionariesPage />;
      case 'phrase':
        return <PhrasePage />;
      default:
        return null;
    }
  };

  return (
    <section
      className={`${styles.content} ${currentPage === 'home' || currentPage === 'meeting' ? styles.contentHome : ''}`}
    >
      {renderPage()}
    </section>
  );
};

export default Content;
