import { useCallback, useEffect, useMemo, useState } from 'react';
import styles from './index.module.scss';
import banner2 from '@/assets/webp/banner-one-bg.webp';
import banner1 from '@/assets/webp/banner-two-bg.webp';
import banner3 from '@/assets/webp/banner-three-bg.webp';
import InviteModal from '@/renderer/components/InviteModal';
import { inviteFriendsApi } from '@/services/user';
import type { InviteFriendsResponse } from '@/services/user/types';
import { getWebBaseUrl } from '@/renderer/common/webBaseUrl';
import { useHoldToRecordKeyLabel } from '@/renderer/hooks/useHoldToRecordKeyLabel';
import { useCheckinConfigStore } from '@/renderer/store/useCheckinConfigStore';

const AUTOPLAY_MS = 3000;

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const el = document.createElement('textarea');
      el.value = text;
      el.setAttribute('readonly', '');
      el.style.position = 'fixed';
      el.style.left = '-9999px';
      document.body.appendChild(el);
      el.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(el);
      return ok;
    } catch {
      return false;
    }
  }
}

const Banner = () => {
  const { label, isMac, isWin } = useHoldToRecordKeyLabel();
  const keyLabel = isWin && !isMac ? '右 Alt' : label;
  const comboKey1 = isWin && !isMac ? 'Ctrl' : 'Fn';
  const comboKey2 = isWin && !isMac ? 'Win' : '空格';
  const config = useCheckinConfigStore((s) => s.config);
  const formatPoints = (points: number): string => {
    if (points >= 10000) {
      const wan = points / 10000;
      return wan % 1 === 0 ? `${wan}万` : `${wan.toFixed(1)}万`;
    }
    return String(points);
  };
  const slides = useMemo(
    () => [
      {
        id: 'banner3',
        tipsVariant: 'usage',
        dotLabel: '天天用，天天送积分',
        dotKey: 'banner3',
        key: 'banner3',
        src: banner3,
        title: '天天用，天天送积分',
        subtitle: `每日使用签到可领${formatPoints(config?.remedy_points ?? 0)}积分，会员可领双倍<br/>每月累计使用，最多可额外领取35万积分`,
        tips: [
          `累计使用7天，可领取${formatPoints(config?.seven_day ?? 0)}积分`,
          `累计使用15天，可领取${formatPoints(config?.fifteen_day ?? 0)}积分`,
          `累计使用25天，可领取${formatPoints(config?.twenty_five_day ?? 0)}积分`,
        ],
      },
      {
        id: 'banner1',
        tipsVariant: 'invite',
        dotLabel: '邀请新用户注册得积分',
        dotKey: 'banner1',
        key: 'banner1',
        src: banner1,
        title: '邀请新用户注册得积分',
        subtitle: '每邀请一位新用户注册',
        tips: ['即可获得 10 万积分', '新用户通过您的邀请码注册可获得共 20 万积分'],
        actionText: '立即邀请',
      },
      {
        id: 'banner2',
        tipsVariant: 'usage',
        dotLabel: '支持在任意应用中使用',
        dotKey: 'banner2',
        key: 'banner2',
        src: banner2,
        title: '支持在任意应用中使用',
        subtitle: '通过语音就可以完成 <br/>“消息发送”“撰写邮件”“内容优化”“文本翻译”等',
        tips: [
          `长按 ${keyLabel} 键讲话，松开后即可插入语音文本`,
          `同时按下 ${comboKey1} + ${comboKey2} 键讲话，再次按下即可停止`,
        ],
      },
    ],
    [keyLabel, comboKey1, comboKey2, config],
  );
  const [index, setIndex] = useState(0);
  const [inviteModalOpen, setInviteModalOpen] = useState(false);
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteInfo, setInviteInfo] = useState<InviteFriendsResponse | null>(null);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const [isHovering, setIsHovering] = useState(false);
  const [dragStartX, setDragStartX] = useState<number | null>(null);
  const handleCloseInviteModal = useCallback(() => setInviteModalOpen(false), []);

  const goTo = useCallback(
    (next: number) => {
      const max = Math.max(0, slides.length - 1);
      setIndex(Math.max(0, Math.min(max, next)));
    },
    [slides.length],
  );

  useEffect(() => {
    if (!inviteModalOpen) return;
    let alive = true;
    setInviteLoading(true);
    setCopyState('idle');
    inviteFriendsApi()
      .then((res) => {
        if (!alive) return;
        if (res.success) {
          setInviteInfo(res.data);
        } else {
          setInviteInfo(null);
        }
      })
      .catch(() => {
        if (!alive) return;
        setInviteInfo(null);
      })
      .finally(() => {
        if (!alive) return;
        setInviteLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [inviteModalOpen]);

  const shareLink = useMemo(() => {
    const code = inviteInfo?.code?.trim();
    if (!code) return '';
    return `告别繁琐打字！ SenseAudio AI 语音输入法来袭，语音精准识别，支持智能润色。用我的邀请链接注册，直接领积分额度！点击体验：${getWebBaseUrl()}/login?inviteCode=${code}`;
  }, [inviteInfo?.code]);

  const handleCopyLink = async () => {
    if (!shareLink) return;
    const ok = await copyToClipboard(shareLink);
    setCopyState(ok ? 'copied' : 'failed');
    if (ok) {
      window.setTimeout(() => setCopyState('idle'), 2000);
    }
  };

  useEffect(() => {
    if (slides.length <= 1 || isHovering) return;
    const timer = window.setInterval(() => {
      setIndex((current) => (current + 1) % slides.length);
    }, AUTOPLAY_MS);
    return () => window.clearInterval(timer);
  }, [slides.length, isHovering]);

  const handleMouseDown = (e: React.MouseEvent) => {
    setDragStartX(e.clientX);
  };

  const handleMouseUp = (e: React.MouseEvent) => {
    if (dragStartX === null) return;
    const diff = e.clientX - dragStartX;
    const threshold = 50;

    if (Math.abs(diff) > threshold) {
      if (diff > 0) {
        // Drag right, show previous
        setIndex((current) => (current - 1 + slides.length) % slides.length);
      } else {
        // Drag left, show next
        setIndex((current) => (current + 1) % slides.length);
      }
    }
    setDragStartX(null);
  };

  const handleMouseLeave = () => {
    setIsHovering(false);
    setDragStartX(null);
  };

  return (
    <div className={styles.banner}>
      <div
        className={styles.viewport}
        onMouseEnter={() => setIsHovering(true)}
        onMouseLeave={handleMouseLeave}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
      >
        <div className={styles.track} style={{ transform: `translate3d(-${index * 100}%, 0, 0)` }}>
          {slides.map((slide) => (
            <div className={styles.slide} key={slide.key}>
              <img src={slide.src} alt="" className={styles.image} draggable={false} />
              <div className={styles.content}>
                <h3 className={styles.title}>{slide.title}</h3>
                {slide.subtitle ? (
                  <p
                    className={styles.subtitle}
                    dangerouslySetInnerHTML={{ __html: slide.subtitle }}
                  ></p>
                ) : null}
                {slide.tips?.length ? (
                  <ul
                    className={`${styles.tips} ${slide.tipsVariant === 'usage' ? styles.tips1 : ''}`}
                  >
                    {slide.tips.map((tip) => (
                      <li key={tip}>{tip}</li>
                    ))}
                  </ul>
                ) : null}
                {slide.actionText ? (
                  <button
                    type="button"
                    onClick={() => {
                      setInviteModalOpen(true);
                    }}
                    className={styles.actionBtn}
                  >
                    <span>{slide.actionText}</span>
                    <span className={styles.actionArrow}>›</span>
                  </button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
        <div className={styles.dots} role="tablist" aria-label="首页轮播">
          {slides.map((slide, idx) => (
            <button
              key={slide.dotKey}
              type="button"
              className={`${styles.dot} ${idx === index ? styles.dotActive : ''}`}
              onClick={() => goTo(idx)}
              aria-label={`${slide.dotLabel}（第 ${idx + 1} 张）`}
              aria-selected={idx === index}
              role="tab"
            />
          ))}
        </div>
      </div>
      <InviteModal
        open={inviteModalOpen}
        inviteInfo={inviteInfo}
        inviteLoading={inviteLoading}
        shareLink={shareLink}
        copyState={copyState}
        onClose={handleCloseInviteModal}
        onCopyLink={handleCopyLink}
      />
    </div>
  );
};

export default Banner;
