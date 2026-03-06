import styles from '../common.module.scss';
import { useRef, useState } from 'react';
import stylesAccount from './index.module.scss';
import { useUserStore } from '@/renderer/store/useUserStore';
import { clearToken } from '@/utils/auth';
import PageHeader from '@/renderer/components/PageHeader';
import { InfoButton, InfoListCard, InfoListItem } from '@/renderer/components/InfoListCard';
import { logoutApi } from '@/services';
import { getWebBaseUrl } from '@/renderer/common/webBaseUrl';
import Avatar from '@/renderer/components/Avatar';

function toDisplayText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const str = String(value).trim();
  return str.length ? str : null;
}

const INIT_STEPS_COMPLETED_KEY = 'sensetype_init_steps_completed';
const INIT_STEPS_CLICK_REQUIRED = 5;

const AccountPage = () => {
  const [loggingOut, setLoggingOut] = useState(false);
  const [avatarModalOpen, setAvatarModalOpen] = useState(false);
  const initStepsClickCountRef = useRef(0);
  const userInfo = useUserStore((s) => s.userInfo);
  const clearUserInfo = useUserStore((s) => s.clearUserInfo);

  const phoneRaw = toDisplayText(userInfo?.phone ?? userInfo?.mobile ?? userInfo?.tel);
  const username = toDisplayText(userInfo?.username ?? userInfo?.name);
  const account = phoneRaw ?? username ?? '-';

  // 根据 plan_level 显示对应的套餐名称
  const getPlanNameByLevel = (level: unknown): string | null => {
    const labels = ['免费版', '尝鲜版', '高级版', '专业版', '商业版', '企业版'];
    const numLevel = Number(level);
    if (isNaN(numLevel) || numLevel < 0 || numLevel > 5) return null;
    return labels[numLevel];
  };

  // 优先使用 plan_level，如果没有则尝试其他字段，最后使用默认值
  const plan =
    (userInfo && typeof userInfo.plan_level !== 'undefined' && userInfo.plan_level !== null
      ? getPlanNameByLevel(userInfo.plan_level)
      : null) ??
    toDisplayText(
      userInfo?.plan_name ??
        userInfo?.plan ??
        userInfo?.package_name ??
        userInfo?.vip_name ??
        userInfo?.member_name ??
        userInfo?.product_name,
    ) ??
    (userInfo ? '尝鲜版' : '-');

  const loginStatus = userInfo ? '在线' : '未登录';

  const handleLogout = async () => {
    if (loggingOut) return;

    setLoggingOut(true);
    try {
      // 后端登出接口已移除：这里保留 best-effort 调用，不阻塞本地退出流程。
      void logoutApi().catch(() => undefined);

      // 通知主进程执行统一退出流程（清主进程登录态/切登录路由/更新窗口状态）。
      if (window.electronAPI?.ipcRenderer) {
        window.electronAPI.ipcRenderer.send('logout-success');
      }

      // 立即清理本地登录态，避免并发请求把旧 token 回写。
      clearToken();
      clearUserInfo();
      try {
        window.location.hash = '#/login';
      } catch {
        // ignore
      }
    } catch (error) {
      console.error('退出登录失败:', error);
    } finally {
      setLoggingOut(false);
    }
  };

  function getPlatform(): string {
    const w = window as Window & { sensetype?: { isMacOs?: () => boolean } };
    return w?.sensetype?.isMacOs?.() ? 'MACOS' : 'Windows';
  }

  const loginUrl = () => {
    // 这里预留给你们的新登录方式（非验证码登录）：
    // - 优先使用环境变量（按需在 .env / 打包环境注入）
    // - 兜底给一个可访问站点（你也可以改成你们真实登录页）
    // const fromEnv = (import.meta as any)?.env?.VITE_LOGIN_WEB_URL;
    // if (typeof fromEnv === 'string' && fromEnv.trim()) return fromEnv.trim();
    const platform = getPlatform();
    const product = 'SenseType';
    const target = 'login';
    const isnew = 1;
    return `${getWebBaseUrl()}/auth-intermediate?target=${encodeURIComponent(target)}&platform=${encodeURIComponent(
      platform,
    )}&product=${encodeURIComponent(product)}&isnew=${encodeURIComponent(isnew)}`;
  };

  const openLoginUrl = () => {
    try {
      (
        window as unknown as { sensetype?: { shellOpenExternal?: (url: string) => void } }
      )?.sensetype?.shellOpenExternal?.(loginUrl());
      return;
    } catch {
      // ignore
    }
  };

  const handleAccountSecretClick = () => {
    if (!phoneRaw) return;
    initStepsClickCountRef.current += 1;

    if (initStepsClickCountRef.current >= INIT_STEPS_CLICK_REQUIRED) {
      localStorage.removeItem(INIT_STEPS_COMPLETED_KEY);
      initStepsClickCountRef.current = 0;
    }
  };

  const accountDesc = phoneRaw ? (
    <span
      role="button"
      tabIndex={0}
      onClick={handleAccountSecretClick}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          handleAccountSecretClick();
        }
      }}
    >
      {account}
    </span>
  ) : (
    account
  );

  return (
    <div className={`${styles.page} ${stylesAccount.account}`}>
      <PageHeader title="账户" subtitle="查看你的账户信息" />
      <div className={stylesAccount.accountWrapper}>
        <InfoListCard>
          <InfoListItem
            title="账号"
            desc={accountDesc}
            action={
              <>
                <InfoButton
                  variant="secondary"
                  onClick={() => openLoginUrl()}
                  className={stylesAccount.logoutBtn}
                >
                  切换账号
                </InfoButton>
              </>
            }
          />
          <InfoListItem
            title="用户头像"
            desc={
              <>
                <Avatar
                  size={32}
                  disabled={!userInfo}
                  ariaLabel="设置头像"
                  open={avatarModalOpen}
                  onOpenChange={setAvatarModalOpen}
                />
              </>
            }
            action={
              <>
                <InfoButton
                  variant="secondary"
                  className={stylesAccount.logoutBtn}
                  onClick={() => setAvatarModalOpen(true)}
                  disabled={!userInfo}
                >
                  更换头像
                </InfoButton>
              </>
            }
          />
          <InfoListItem title="当前套餐" desc={plan} />
        </InfoListCard>
        <InfoListCard>
          <InfoListItem
            title="登录状态"
            desc={loginStatus}
            action={
              <>
                <InfoButton
                  variant="secondary"
                  onClick={() => handleLogout()}
                  className={stylesAccount.logoutBtn}
                >
                  退出登录
                </InfoButton>
              </>
            }
          />
        </InfoListCard>
      </div>
    </div>
  );
};

export default AccountPage;
