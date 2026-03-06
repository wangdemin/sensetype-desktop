import PlanLevel0Icon from '@/assets/icons/plan-level0.svg?react';
import PlanLevel1Icon from '@/assets/icons/plan-level1.svg?react';
import PlanLevel2Icon from '@/assets/icons/plan-level2.svg?react';
import PlanLevel3Icon from '@/assets/icons/plan-level3.svg?react';
import PlanLevel4Icon from '@/assets/icons/plan-level4.svg?react';
import PlanLevel5Icon from '@/assets/icons/plan-level5.svg?react';
import PointsArrow from '@/assets/icons/points-arrow.svg?react';
import Avatar from '@/renderer/components/Avatar';
import { getWebBaseUrl } from '@/renderer/common/webBaseUrl';
import { useUserStore } from '@/renderer/store/useUserStore';
import { acquireToken } from '@/services/user';
import { useState } from 'react';
import styles from './index.module.scss';
import { formatNumberWithCommas, formatPoints } from '@/utils/format';
import Confetti from '@/renderer/components/Confetti/index';
import { track } from '@/utils/posthog';

type PointsCardMinProps = {
  onNavigateToAccount?: () => void;
};

export default function PointsCardMin({ onNavigateToAccount }: PointsCardMinProps) {
  const userInfo = useUserStore((s) => s.userInfo);
  const points = useUserStore((s) => (s.userInfo as Record<string, unknown> | null)?.points);
  const planLevel =
    useUserStore((s) => (s.userInfo as Record<string, unknown> | null)?.plan_level) ?? 0;
  const phone = String(userInfo?.phone ?? userInfo?.mobile ?? userInfo?.tel ?? '').trim() || null;
  const [detailVisible, setDetailVisible] = useState(false);
  const [confetti, setConfetti] = useState<{ x: number; y: number; key: number } | null>(null);
  const pointsValue = Number(points) || 0;
  const formattedPoints = formatPoints(pointsValue, true);

  const getPlanLevelIcon = () => {
    const icons = [
      PlanLevel0Icon, // 0: 免费
      PlanLevel1Icon, // 1: 尝鲜
      PlanLevel2Icon, // 2: 高级
      PlanLevel3Icon, // 3: 专业
      PlanLevel4Icon, // 4: 商业
      PlanLevel5Icon, // 5: 企业
    ];
    const level = Math.max(0, Math.min(5, Number(planLevel) || 0));
    return icons[level];
  };

  const PlanIcon = getPlanLevelIcon();

  /**
   * 判断当前运行平台
   */
  function getPlatform(): string {
    const w = window as Window & { sensetype?: { isMacOs?: () => boolean } };
    return w?.sensetype?.isMacOs?.() ? 'MACOS' : 'Windows';
  }

  const onRecharge = () => {
    (async () => {
      // 注意：target 可能包含 `/`、`?`、中文等，必须做 URL 编码（用 URLSearchParams 自动处理）
      const url = new URL(`${getWebBaseUrl()}/auth-intermediate?`);

      const shellOpenExternal = (
        window as unknown as { sensetype?: { shellOpenExternal?: (url: string) => void } }
      )?.sensetype?.shellOpenExternal;

      track('sensetype_vip_upgrade_click');

      try {
        // 获取网页端 token（用于打开浏览器页面时免登录）
        const resp = await acquireToken({ platform: 'WEB', product: 'SenseAudio' });

        if (resp.success && resp.data?.token) {
          const baseTargetWithQuery = `/workspace/vip-pay?product=SenseType`;
          url.searchParams.set('target', baseTargetWithQuery); // 对方页面会读 target（或 to）
          url.searchParams.set('platform', getPlatform());
          url.searchParams.set('product', 'SenseType');
          url.searchParams.set('token', String(resp.data.token));
        }

        shellOpenExternal?.(url.toString());
      } catch {
        // 兜底：获取网页 token 失败也不影响用户充值入口
        try {
          shellOpenExternal?.(url.toString());
        } catch {
          // ignore
        }
      }
    })();
  };

  return (
    <>
      <div className={styles.pointsCard}>
        <div
          className={styles.avatar}
          role="button"
          tabIndex={0}
          onClick={() => {
            onNavigateToAccount?.();
            track('sensetype_sidebar_click', { $x_page: 'account' });
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onNavigateToAccount?.();
              track('sensetype_sidebar_click', { $x_page: 'account' });
            }
          }}
          style={{ cursor: onNavigateToAccount ? 'pointer' : undefined }}
        >
          <Avatar className={styles.avatar} disableModal />
        </div>
        <PlanIcon
          className={styles.trialVersionIcon}
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const x = rect.left + rect.width / 2;
            const y = rect.top + rect.height / 2;
            setConfetti({ x, y, key: Date.now() });
          }}
          style={{ cursor: 'pointer' }}
        />
        <div className={styles.points}>
          <span className={styles.pointsValue} data-full={formatNumberWithCommas(pointsValue)}>
            <span className={styles.pointsValueText}>{formattedPoints.value}</span>
            {formattedPoints.unit ? (
              <span className={styles.pointsUnit}>{formattedPoints.unit}</span>
            ) : null}
          </span>
        </div>
        <button className={styles.button} onClick={onRecharge}>
          升级
        </button>
      </div>
      {confetti && (
        <Confetti
          key={confetti.key}
          x={confetti.x}
          y={confetti.y}
          particleCount={56}
          duration={1900}
          onComplete={() => setConfetti(null)}
        />
      )}
    </>
  );
}
