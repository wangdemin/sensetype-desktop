import React, { useEffect, useRef, useState } from 'react';
import styles from './index.module.scss';
import LoginLogoIcon from '@/assets/icons/login-logo.svg?react';
import CompleteBg from '@/assets/webp/complete-bg.webp';

type Step5CompleteProps = {
  onComplete: () => void;
};

const Step5Complete: React.FC<Step5CompleteProps> = ({ onComplete }) => {
  const [countdown, setCountdown] = useState(10);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    timerRef.current = window.setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          onComplete();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (timerRef.current) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [onComplete]);

  const handleGoToApp = () => {
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    // 立即跳转
    onComplete();
  };

  return (
    <div className={styles.completeStep}>
      <div className={styles.content}>
        <div className={styles.heroGroup}>
          <LoginLogoIcon />
          <p className={styles.title}>即刻开启&quot;语音输入&quot;之旅！</p>
          <p className={styles.subtitle}>
            我们将赠送您 <span>10000积分</span> 进行使用
          </p>
          <div className={styles.fireworksLayer} aria-hidden="true">
            <span className={`${styles.firework} ${styles.fireworkA}`} />
            <span className={`${styles.firework} ${styles.fireworkB}`} />
            <span className={`${styles.firework} ${styles.fireworkC}`} />
            <span className={`${styles.firework} ${styles.fireworkD}`} />
            <span className={`${styles.firework} ${styles.fireworkE}`} />
          </div>
        </div>
        <button className={styles.button} onClick={handleGoToApp}>
          进入SenseAudio 输入法（{countdown}s）
        </button>
      </div>
      <div className={styles.completeStepRight}>
        <img src={CompleteBg} alt="complete-bg" />
        <p>
          我们相信，最好的输入方式，是让你忘
          <br />
          记&quot;输入&quot;这件事。
        </p>
      </div>
    </div>
  );
};

export default Step5Complete;
