import styles from './index.module.scss';
import type { PageKey } from '@/renderer/types/navigation';
import HomeIcon from '@/assets/icons/home.svg?react';
import HistoryIcon from '@/assets/icons/history.svg?react';
import NotesIcon from '@/assets/icons/notes.svg?react';
import DictionariesIcon from '@/assets/icons/dictionaries.svg?react';
import PhraseIcon from '@/assets/icons/phrase.svg?react';
import MeetingIcon from '@/assets/icons/meeting.svg?react';
import HomeIconMin from '@/assets/icons/home-min.svg?react';
import HistoryIconMin from '@/assets/icons/history-min.svg?react';
import NotesIconMin from '@/assets/icons/notes-min.svg?react';
import DictionariesIconMin from '@/assets/icons/dictionaries-min.svg?react';
import PhraseIconMin from '@/assets/icons/phrase-min.svg?react';
import MeetingIconMin from '@/assets/icons/meeting-min.svg?react';
import Logo from '@/assets/icons/menu-logo.svg?react';
import MenuMinLogo from '@/assets/icons/menu-minlogo.svg?react';
import PointsCard from './PointsCard';
import PointsCardMin from './PointsCardMin';
import { track } from '@/utils/posthog';

type MenuProps = {
  currentPage: PageKey;
  onChange: (page: PageKey) => void;
  collapsed?: boolean;
};

const MENU_ITEMS: {
  key: PageKey;
  label: string;
  icon: React.ReactNode;
  iconMin: React.ReactNode;
}[] = [
  { key: 'home', label: '首页', icon: <HomeIcon />, iconMin: <HomeIconMin /> },
  { key: 'history', label: '历史记录', icon: <HistoryIcon />, iconMin: <HistoryIconMin /> },
  { key: 'notes', label: '随口记', icon: <NotesIcon />, iconMin: <NotesIconMin /> },
  { key: 'meeting', label: '会议纪要', icon: <MeetingIcon />, iconMin: <MeetingIconMin /> },
  {
    key: 'dictionaries',
    label: '词典',
    icon: <DictionariesIcon />,
    iconMin: <DictionariesIconMin />,
  },
  { key: 'phrase', label: '自定义短语', icon: <PhraseIcon />, iconMin: <PhraseIconMin /> },
  // {
  //   key: 'meetingMinutes',
  //   label: '会议纪要',
  //   icon: <MinutesIcon />,
  //   iconMin: <MinutesIconMin />,
  // },
];

const Menu = ({ currentPage, onChange, collapsed = false }: MenuProps) => {
  const isMac = window?.sensetype?.isMacOs?.() ?? false;

  return (
    <nav className={`${styles.menu} ${collapsed ? styles.collapsed : ''}`}>
      <div className={styles.logo}>
        <span className={`${styles.logoItem} ${!collapsed ? styles.logoVisible : ''}`}>
          <Logo />
        </span>
        <span className={`${styles.logoItem} ${collapsed ? styles.logoVisible : ''}`}>
          <MenuMinLogo />
        </span>
      </div>
      <div className={styles.menuContent}>
        <ul className={styles.menuList}>
          {MENU_ITEMS.map((item) => {
            const active = item.key === currentPage;
            const Icon = active ? item.iconMin : item.icon;
            return (
              <li
                key={item.key}
                className={`${styles.menuItem} ${active ? styles.active : ''}`}
                title={collapsed ? item.label : undefined}
                onClick={() => {
                  onChange(item.key);
                  track('sensetype_sidebar_click', { $x_page: item.key });
                }}
              >
                <p>{Icon}</p>
                <span className={styles.menuItemLabel}>{item.label}</span>
              </li>
            );
          })}
        </ul>
      </div>
      <div className={styles.menuBottom}>
        <div className={`${styles.pointsCardWrap} ${!collapsed ? styles.pointsCardVisible : ''}`}>
          <PointsCard
            currentPage={currentPage}
            onNavigateToAccount={() => onChange('account')}
            onNavigateToUsage={() => onChange('usage')}
            onNavigateToSettings={() => onChange('settings')}
            onNavigateToAbout={() => onChange('about')}
            onNavigateToVersion={() => onChange('version')}
          />
        </div>
        <div className={`${styles.pointsCardWrap} ${collapsed ? styles.pointsCardVisible : ''}`}>
          <PointsCardMin onNavigateToAccount={() => onChange('account')} />
        </div>
      </div>
    </nav>
  );
};

export default Menu;
