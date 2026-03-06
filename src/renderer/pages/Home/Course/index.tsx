import { useState } from 'react';
import styles from './index.module.scss';
import InputsCourseMac from '@/assets/webp/inputs-course-mac.webp';
import InputCourseWin from '@/assets/webp/input-course-win.webp';
import RewriteCourseMac from '@/assets/webp/rewrite-course-mac.webp';
import RewriteCourseWin from '@/assets/webp/rewrite-course-win.webp';

type TabKey = 'input' | 'rewrite';

const Course = () => {
  const [activeTab, setActiveTab] = useState<TabKey>('input');
  const isMac = window?.sensetype?.isMacOs?.() ?? false;

  const inputsCourseImg = isMac ? InputsCourseMac : InputCourseWin;
  const rewriteCourseImg = isMac ? RewriteCourseMac : RewriteCourseWin;

  return (
    <div className={styles.course}>
      <div className={styles.header}>
        <p
          className={activeTab === 'input' ? styles.active : ''}
          onClick={() => setActiveTab('input')}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => e.key === 'Enter' && setActiveTab('input')}
        >
          <span>语音输入流程</span>
          <span className={styles.underline} />
        </p>
        <p
          className={activeTab === 'rewrite' ? styles.active : ''}
          onClick={() => setActiveTab('rewrite')}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => e.key === 'Enter' && setActiveTab('rewrite')}
        >
          <span>语音改写流程</span>
          <span className={styles.underline} />
        </p>
      </div>
      <div className={styles.content}>
        {activeTab === 'input' ? (
          <img src={inputsCourseImg} className={styles.inputsCourse} alt="语音输入流程" />
        ) : (
          <img src={rewriteCourseImg} className={styles.rewriteCourse} alt="语音改写流程" />
        )}
      </div>
    </div>
  );
};

export default Course;
