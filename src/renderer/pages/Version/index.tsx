import styles from '../common.module.scss';
import pageStyles from './index.module.scss';

import PageHeader from '@/renderer/components/PageHeader';
import { VERSION_DATA, type VersionItem } from './versionData';

// 版本头部组件
const VersionHeader = ({ title, date }: { title: string; date: string }) => {
  return (
    <div className={pageStyles.versionHeader}>
      <div className={pageStyles.versionHeaderContent}>
        <h1 className={pageStyles.versionTitle}>{title}</h1>
        <p className={pageStyles.versionDate}>{date}</p>
      </div>
    </div>
  );
};

// 版本说明卡片组件
const VersionSection = ({
  sectionTitle,
  items,
}: {
  sectionTitle: string;
  items: VersionItem[];
}) => {
  return (
    <div className={pageStyles.sectionWrapper}>
      <h2 className={pageStyles.sectionTitle}>{sectionTitle}</h2>
      <ul className={pageStyles.itemList}>
        {items.map((item, index) => (
          <li className={pageStyles.item} key={index}>
            {item.desc}
          </li>
        ))}
      </ul>
    </div>
  );
};

const VersionPage = () => {
  return (
    <div className={`${styles.page} ${pageStyles.version}`}>
      <PageHeader title="版本说明" subtitle="软件更新日志与核心特性概览" />
      {VERSION_DATA.map((version, versionIndex) => (
        <div key={versionIndex} className={pageStyles.versionContent}>
          <VersionHeader title={version.title} date={version.date} />

          <div className={pageStyles.sections}>
            {version.sections.map((section, sectionIndex) => (
              <VersionSection
                key={sectionIndex}
                sectionTitle={section.title}
                items={section.items}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
};

export default VersionPage;
