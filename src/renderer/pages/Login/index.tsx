import React, { useMemo } from 'react';
import { getToken } from '@/utils/auth';
import styles from './index.module.scss';
import LoginLogoIcon from '@/assets/icons/login-logo.svg?react';
import { getWebBaseUrl } from '@/renderer/common/webBaseUrl';
const Login: React.FC = () => {
  const isMac = window?.sensetype?.isMacOs?.() ?? false;
  const hasToken = !!getToken();

  function getPlatform(): string {
    const w = window as Window & { sensetype?: { isMacOs?: () => boolean } };
    return w?.sensetype?.isMacOs?.() ? 'MACOS' : 'Windows';
  }

  const loginUrl = useMemo(() => {
    // 这里预留给你们的新登录方式（非验证码登录）：
    // - 优先使用环境变量（按需在 .env / 打包环境注入）
    // - 兜底给一个可访问站点（你也可以改成你们真实登录页）
    // const fromEnv = (import.meta as any)?.env?.VITE_LOGIN_WEB_URL;
    // if (typeof fromEnv === 'string' && fromEnv.trim()) return fromEnv.trim();
    const platform = getPlatform();
    const product = 'SenseType';
    const target = 'login';
    return `${getWebBaseUrl()}/auth-intermediate?target=${encodeURIComponent(target)}&platform=${encodeURIComponent(
      platform,
    )}&product=${encodeURIComponent(product)}`;
  }, []);

  const openLoginUrl = () => {
    // 已有 token：直接进主页面
    if (hasToken) {
      window.location.hash = '#/';
      return;
    }

    // 无 token：打开网页登录（让用户在浏览器完成登录）
    try {
      (
        window as unknown as { sensetype?: { shellOpenExternal?: (url: string) => void } }
      )?.sensetype?.shellOpenExternal?.(loginUrl);
      // shell.openExternal('');
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

  return (
    <div className={styles.loginContainer}>
      <div className={styles.loginBox}>
        <div className={styles.loginContent}>
          <div className={styles.logoSection}>
            <LoginLogoIcon />
            <p className={styles.title}>听懂灵感重塑表达 </p>
          </div>
          <p className={styles.subtitle}>最好的输入方式，是让你忘记“输入”这件事。</p>
          <button className={styles.loginButton} onClick={openLoginUrl} type="button">
            一键登录账号
          </button>
          <div className={styles.agreeRow}>
            <input className={styles.checkbox} type="checkbox" defaultChecked />
            <span className={styles.agreeRowText}>
              我已阅读并
              <span className={styles.agree} onClick={openUserProtocol}>
                同意用户协议
              </span>
              与
              <span className={styles.privacy} onClick={openPrivacyPolicy}>
                隐私条款
              </span>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Login;
