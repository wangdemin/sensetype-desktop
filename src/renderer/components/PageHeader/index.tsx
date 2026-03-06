import styles from './index.module.scss';

type Props = {
  title: string;
  subtitle?: string;
  className?: string;
  onBack?: () => void;
};

const BackIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const PageHeader = ({ title, subtitle, className, onBack }: Props) => {
  return (
    <div className={`${styles.header} ${className ?? ''}`}>
      <div className={styles.titleWrap}>
        {onBack && (
          <button className={styles.backBtn} onClick={onBack}>
            <BackIcon />
            返回
          </button>
        )}
        <h1 className={styles.title}>{title}</h1>
        {subtitle ? <p className={styles.subtitle}>{subtitle}</p> : null}
      </div>
    </div>
  );
};

export default PageHeader;
