import React, { useMemo, useEffect, useState } from 'react';
import { getToken } from '@/utils/auth';
import styles from './index.module.scss';
import LoginLogoIcon from '@/assets/icons/login-logo.svg?react';
import LoginBg from '@/assets/webp/login-bg.webp';
import { getWebBaseUrl } from '@/renderer/common/webBaseUrl';

type Step1LoginProps = {
  onNext: () => void;
};

const Step1Login: React.FC<Step1LoginProps> = ({ onNext }) => {
  const isMac = window?.sensetype?.isMacOs?.() ?? false;
  const hasToken = !!getToken();

  function getPlatform(): string {
    const w = window as Window & { sensetype?: { isMacOs?: () => boolean } };
    return w?.sensetype?.isMacOs?.() ? 'MACOS' : 'Windows';
  }

  const loginUrl = useMemo(() => {
    const platform = getPlatform();
    const product = 'SenseType';
    const target = 'login';
    return `${getWebBaseUrl()}/auth-intermediate?target=${encodeURIComponent(target)}&platform=${encodeURIComponent(
      platform,
    )}&product=${encodeURIComponent(product)}`;
  }, []);

  // 监听token变化，如果有token则自动进入下一步
  useEffect(() => {
    const checkToken = () => {
      const token = getToken();
      if (token) {
        onNext();
      }
    };

    // 初始检查
    checkToken();

    // 监听token变化（通过localStorage事件或轮询）
    const interval = setInterval(checkToken, 500);
    return () => clearInterval(interval);
  }, [onNext]);

  const openLoginUrl = () => {
    // 已有 token：进入下一步
    if (hasToken) {
      onNext();
      return;
    }

    // 无 token：打开网页登录（让用户在浏览器完成登录）
    try {
      (
        window as unknown as { sensetype?: { shellOpenExternal?: (url: string) => void } }
      )?.sensetype?.shellOpenExternal?.(loginUrl);
      return;
    } catch {
      // ignore
    }
    try {
      window.open(loginUrl, '_blank', 'noopener,noreferrer');
    } catch {
      // ignore
    }
  };

  const openUserProtocol = () => {
    (
      window as unknown as { sensetype?: { shellOpenExternal?: (url: string) => void } }
    )?.sensetype?.shellOpenExternal?.('https://senseaudio.cn/docs/agreement/user');
  };

  const openPrivacyPolicy = () => {
    (
      window as unknown as { sensetype?: { shellOpenExternal?: (url: string) => void } }
    )?.sensetype?.shellOpenExternal?.('https://senseaudio.cn/docs/agreement/policy');
  };

  const [agreed, setAgreed] = useState(false);
  const [lockAgreement, setLockAgreement] = useState(false);

  const handleLoginClick = () => {
    if (!agreed) return;
    setLockAgreement(true);
    openLoginUrl();
  };

  return (
    <div className={styles.loginStep}>
      <div className={styles.loginContent}>
        <div className={styles.logoSection}>
          <LoginLogoIcon />
          <p className={styles.title}>听懂灵感重塑表达</p>
        </div>
        <p className={styles.subtitle}>最好的输入方式，是让你忘记&ldquo;输入&rdquo;这件事。</p>
        <button
          className={styles.loginButton}
          onClick={handleLoginClick}
          type="button"
          disabled={!agreed}
        >
          一键登录账号
        </button>
        <div className={styles.agreeRow}>
          <input
            className={styles.checkbox}
            type="checkbox"
            checked={agreed}
            disabled={lockAgreement}
            onChange={(e) => {
              if (lockAgreement) return;
              setAgreed(e.target.checked);
            }}
          />
          <span className={styles.agreeRowText}>
            我已阅读并同意
            <span className={styles.agree} onClick={openUserProtocol}>
              用户协议
            </span>
            与
            <span className={styles.privacy} onClick={openPrivacyPolicy}>
              隐私条款
            </span>
          </span>
        </div>
        {hasToken && <div className={styles.statusText}>登录成功，即将进入下一步...</div>}
      </div>
      <div className={styles.loginStepRight}>
        <img src={LoginBg} alt="login-bg" />
      </div>
    </div>
  );
};

export default Step1Login;
