import { useRef, useState } from 'react';
import styles from '../common.module.scss';
import pageStyles from './index.module.scss';
import pkg from '../../../../package.json';
import PageHeader from '@/renderer/components/PageHeader';
import { InfoButton, InfoListCard, InfoListItem } from '@/renderer/components/InfoListCard';
import Modal from '@/renderer/components/Modal';
import { checkForUpdates } from '@/renderer/utils/checkUpdate';

const CLICK_REQUIRED = 5;
const LAST_NOTIFIED_VERSION_KEY = 'last_notified_update_version';

const AboutPage = () => {
  const versionLabel = (pkg as { version?: string }).version ?? '-';
  const clickCountRef = useRef(0);
  const [notifyOpen, setNotifyOpen] = useState(false);
  const [notifyBody, setNotifyBody] = useState('');

  const openExternal = (url: string) => {
    try {
      (window as any)?.sensetype?.shellOpenExternal?.(url);
      return;
    } catch {
      // ignore
    }
    try {
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch {
      // ignore
    }
  };

  const notify = (body: string) => {
    setNotifyBody(body);
    setNotifyOpen(true);
  };

  const onCheckUpdate = async () => {
    const result = await checkForUpdates({ force: true, openModal: true, openOnError: false });
    console.log('about-result', result);
    if (result.status === 'latest') {
      console.log('about-result-latest', result);
      notify(`您已是最新版本（${result.currentVersion}）`);
      return;
    }
    if (result.status === 'update') {
      // 已自动弹出全局“发现新版本”弹窗，这里不再重复提示
      return;
    }
    notify('检查更新失败');
  };

  const handleVersionClick = () => {
    clickCountRef.current += 1;
    if (clickCountRef.current >= CLICK_REQUIRED) {
      localStorage.removeItem(LAST_NOTIFIED_VERSION_KEY);
      clickCountRef.current = 0;
      notify('已重置更新提醒标记');
    }
  };

  const onOpenPrivacy = () => {
    const url = 'https://senseaudio.cn/docs/agreement/policy';
    // const url = (import.meta as any)?.env?.VITE_PRIVACY_POLICY_URL;
    if (typeof url === 'string' && url.trim()) return openExternal(url.trim());
    notify('暂未配置隐私政策地址');
  };

  const onOpenTerms = () => {
    const url = 'https://senseaudio.cn/docs/agreement/user';
    //const url = (import.meta as any)?.env?.VITE_TERMS_OF_SERVICE_URL;
    if (typeof url === 'string' && url.trim()) return openExternal(url.trim());
    notify('暂未配置服务条款地址');
  };

  return (
    <div className={`${styles.page} ${pageStyles.about}`}>
      <PageHeader title="关于" subtitle="了解版本状态及相关法律协议" />

      <InfoListCard>
        <InfoListItem
          title="当前版本"
          desc={
            <span
              role="button"
              tabIndex={0}
              style={{ cursor: 'default' }}
              onClick={handleVersionClick}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  handleVersionClick();
                }
              }}
            >
              {versionLabel}
            </span>
          }
          action={
            <InfoButton variant="primary" onClick={onCheckUpdate}>
              检查更新
            </InfoButton>
          }
        />

        <InfoListItem
          title="隐私政策"
          action={
            <InfoButton variant="secondary" onClick={onOpenPrivacy}>
              查看
            </InfoButton>
          }
        />

        <InfoListItem
          title="服务条款"
          action={
            <InfoButton variant="secondary" onClick={onOpenTerms}>
              查看
            </InfoButton>
          }
        />
      </InfoListCard>

      <Modal
        open={notifyOpen}
        onClose={() => setNotifyOpen(false)}
        title="提示"
        subtitle={notifyBody}
        footer={
          <InfoButton
            variant="primary"
            onClick={() => {
              setNotifyOpen(false);
            }}
          >
            知道了
          </InfoButton>
        }
      />
    </div>
  );
};

export default AboutPage;
