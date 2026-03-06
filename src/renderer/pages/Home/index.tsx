import { useCallback, useState, useEffect } from 'react';
import stylesHome from './index.module.scss';
import DataDisplay from './DataDisplay';
import Banner from './Banner';
import Calendar from './Calendar';
import Course from './Course';
import Test from './Test';
import HomeSkeleton from './HomeSkeleton';
import { useHoldToRecordKeyLabel } from '@/renderer/hooks/useHoldToRecordKeyLabel';
import HowToUseVideoModal from './HowToUseVideoModal';
import HomeVideoTutorialsIcon from '@/assets/icons/home-video-tutorials.svg?react';
// 与 Banner、Course 使用同一资源，用于预加载，避免首屏图片闪一下
import banner1 from '@/assets/webp/banner-two-bg.webp';
import banner2 from '@/assets/webp/banner-one-bg.webp';
import InputsCourseMac from '@/assets/webp/inputs-course-mac.webp';
import InputCourseWin from '@/assets/webp/input-course-win.webp';
import RewriteCourseMac from '@/assets/webp/rewrite-course-mac.webp';
import RewriteCourseWin from '@/assets/webp/rewrite-course-win.webp';

const HOME_IMAGE_SRCS = [
  banner1,
  banner2,
  InputsCourseMac,
  InputCourseWin,
  RewriteCourseMac,
  RewriteCourseWin,
] as const;

const PRELOAD_TIMEOUT_MS = 5000;

const HomePage = () => {
  const { label, isMac, isWin } = useHoldToRecordKeyLabel();
  const [howToUseModalOpen, setHowToUseModalOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      setLoading(false);
    };

    const timeoutId = setTimeout(finish, PRELOAD_TIMEOUT_MS);

    let pending = HOME_IMAGE_SRCS.length;
    const check = () => {
      pending -= 1;
      if (pending <= 0) finish();
    };

    HOME_IMAGE_SRCS.forEach((src) => {
      const img = new Image();
      img.onload = check;
      img.onerror = check;
      img.src = src;
    });

    return () => {
      done = true;
      clearTimeout(timeoutId);
    };
  }, []);

  const openHowToUseModal = useCallback(() => setHowToUseModalOpen(true), []);
  const closeHowToUseModal = useCallback(() => setHowToUseModalOpen(false), []);

  if (loading) {
    return <HomeSkeleton />;
  }

  return (
    <div className={`${stylesHome.home}`}>
      <div className={stylesHome.header}>
        <p>欢迎来到 SenseAudio AI 语音输入法👋</p>
        <button type="button" onClick={openHowToUseModal}>
          <HomeVideoTutorialsIcon />
          <span>查看如何使用</span>
        </button>
      </div>
      <HowToUseVideoModal
        open={howToUseModalOpen}
        onClose={closeHowToUseModal}
        videoSrc={`https://static.senseaudio.cn/sensetype/home-teaching-video-${isMac ? 'mac' : 'win'}.mov`}
      />
      <DataDisplay />
      <div className={stylesHome.content}>
        <Banner />
        <Calendar />
      </div>
      <Course />
      {/* <Test /> */}
    </div>
  );
};

export default HomePage;
