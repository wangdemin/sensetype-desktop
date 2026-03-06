import stylesHome from './index.module.scss';

const HomeSkeleton = () => (
  <div className={stylesHome.home}>
    <div className={stylesHome.skeletonHeader}>
      <div className={stylesHome.skeletonTitle} />
      <div className={stylesHome.skeletonButton} />
    </div>
    <div className={stylesHome.skeletonDataDisplay}>
      {[1, 2, 3, 4].map((i) => (
        <div key={i} className={stylesHome.skeletonBox} />
      ))}
    </div>
    <div className={stylesHome.skeletonContentRow}>
      <div className={stylesHome.skeletonBanner} />
      <div className={stylesHome.skeletonCalendar} />
    </div>
    <div className={stylesHome.skeletonCourse}>
      <div className={stylesHome.skeletonTabs}>
        <div className={stylesHome.skeletonTab} />
        <div className={stylesHome.skeletonTab} />
      </div>
      <div className={stylesHome.skeletonCourseContent} />
    </div>
  </div>
);

export default HomeSkeleton;
