import RemainingPointsIcon from '@/assets/icons/remaining-points.svg?react';
import { getWebBaseUrl } from '@/renderer/common/webBaseUrl';
import { acquireToken, pointRecordsApi, pointsApi } from '@/services/user';
import type { PointRecordsItem, PointsResponse } from '@/services/user/types';
import { formatNumberWithCommas, formatPoints } from '@/utils/format';
import { useCallback, useEffect, useRef, useState } from 'react';
import styles from './index.module.scss';
import { track } from '@/utils/posthog';

type PointsDetailProps = {
  visible: boolean;
  onClose: () => void;
};

function formatTime(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${year}.${month}.${day} ${hours}:${minutes}:${seconds}`;
}

export default function PointsDetail({ visible, onClose }: PointsDetailProps) {
  const [pointRecords, setPointRecords] = useState<PointRecordsItem[]>([]);
  const [points, setPoints] = useState<PointsResponse>({
    total_points: 0,
    details: [],
  });
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const contentRef = useRef<HTMLDivElement>(null);
  const loadingRef = useRef(false);
  const pageRef = useRef(1);

  function getPlatform(): string {
    const w = window as Window & { sensetype?: { isMacOs?: () => boolean } };
    return w?.sensetype?.isMacOs?.() ? 'MACOS' : 'Windows';
  }

  const getPointRecords = useCallback(async (pageNum: number, append = false) => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    try {
      const result = await pointRecordsApi({ page: pageNum, size: 20 });

      if (result.success) {
        const { list, total: totalCount } = result.data;
        setTotal(totalCount);
        if (append) {
          setPointRecords((prev) => {
            const newRecords = [...prev, ...list];
            // 判断是否还有更多数据
            setHasMore(newRecords.length < totalCount);
            return newRecords;
          });
        } else {
          setPointRecords(list);
          // 判断是否还有更多数据
          setHasMore(list.length < totalCount);
        }
      } else {
        console.error('获取积分明细失败:', result.error);
      }
    } catch (err: unknown) {
      const error = err as { message?: string };
      console.error('获取积分明细失败:', error?.message || String(err));
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, []);

  const getPoints = useCallback(async () => {
    try {
      const result = await pointsApi();

      if (result.success) {
        setPoints(result.data);
      } else {
        console.error('获取积分失败:', result.error);
      }
    } catch (err: unknown) {
      const error = err as { message?: string };
      console.error('获取积分失败:', error?.message || String(err));
    }
  }, []);

  // 加载更多数据
  const loadMore = useCallback(() => {
    if (!hasMore || loadingRef.current) return;
    pageRef.current += 1;
    getPointRecords(pageRef.current, true);
  }, [hasMore, getPointRecords]);

  // 滚动监听
  useEffect(() => {
    if (!visible || !contentRef.current) return;

    const contentEl = contentRef.current;
    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = contentEl;
      // 当滚动到距离底部 50px 时触发加载
      if (scrollHeight - scrollTop - clientHeight < 50) {
        loadMore();
      }
    };

    contentEl.addEventListener('scroll', handleScroll);
    return () => {
      contentEl.removeEventListener('scroll', handleScroll);
    };
  }, [visible, loadMore]);

  // 初始化数据
  useEffect(() => {
    if (visible) {
      // 重置状态
      pageRef.current = 1;
      setHasMore(true);
      setPointRecords([]);
      // 加载第一页
      getPointRecords(1, false);
      getPoints();
    }
  }, [visible, getPoints, getPointRecords]);

  if (!visible) return null;

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
        console.log(url.toString());

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
      <div className={styles.overlay} onClick={onClose} />
      <div className={styles.modal}>
        <div className={styles.header}>
          <p className={styles.title}>积分详情</p>
          <button type="button" className={styles.closeButton} onClick={onClose} aria-label="关闭">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path
                d="M12 4L4 12M4 4L12 12"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
        <div className={styles.banner}>
          <div className={styles.bannerBox}>
            <div className={styles.pointsItem}>
              <span
                className={styles.pointsNum}
                data-full={formatNumberWithCommas(points.total_points)}
              >
                <span className={styles.pointsNumText}>
                  {(() => {
                    const formatted = formatPoints(points.total_points, true);
                    return (
                      <>
                        {formatted.value}
                        <span className={styles.pointsUnit}>{formatted.unit}</span>
                      </>
                    );
                  })()}
                </span>
              </span>
              <RemainingPointsIcon />
            </div>
            <p className={styles.pointsSymbol}>=</p>
            <div className={styles.pointsItem}>
              <span
                className={styles.pointsNum}
                data-full={formatNumberWithCommas(
                  points.details.find((item) => item.name === '套餐积分')?.points ?? 0,
                )}
              >
                <span className={styles.pointsNumText}>
                  {(() => {
                    const formatted = formatPoints(
                      points.details.find((item) => item.name === '套餐积分')?.points ?? 0,
                      true,
                    );
                    return (
                      <>
                        {formatted.value}
                        <span className={styles.pointsUnit}>{formatted.unit}</span>
                      </>
                    );
                  })()}
                </span>
              </span>
              <p className={styles.pointsName}>套餐积分</p>
            </div>
            <p className={styles.pointsSymbol}>+</p>
            <div className={styles.pointsItem}>
              <span
                className={styles.pointsNum}
                data-full={formatNumberWithCommas(
                  points.details.find((item) => item.name === '充值积分')?.points ?? 0,
                )}
              >
                <span className={styles.pointsNumText}>
                  {(() => {
                    const formatted = formatPoints(
                      points.details.find((item) => item.name === '充值积分')?.points ?? 0,
                      true,
                    );
                    return (
                      <>
                        {formatted.value}
                        <span className={styles.pointsUnit}>{formatted.unit}</span>
                      </>
                    );
                  })()}
                </span>
              </span>
              <p className={styles.pointsName}>充值积分</p>
            </div>
            <p className={styles.pointsSymbol}>+</p>
            <div className={styles.pointsItem}>
              <span
                className={styles.pointsNum}
                data-full={formatNumberWithCommas(
                  points.details.find((item) => item.name === '赠送积分')?.points ?? 0,
                )}
              >
                <span className={styles.pointsNumText}>
                  {(() => {
                    const formatted = formatPoints(
                      points.details.find((item) => item.name === '赠送积分')?.points ?? 0,
                      true,
                    );
                    return (
                      <>
                        {formatted.value}
                        <span className={styles.pointsUnit}>{formatted.unit}</span>
                      </>
                    );
                  })()}
                </span>
              </span>
              <p className={styles.pointsName}>赠送积分</p>
            </div>
          </div>
        </div>
        <div className={styles.content} ref={contentRef}>
          {pointRecords.length === 0 && loading ? (
            // 初始加载时显示占位符
            Array.from({ length: 5 }).map((_, index) => (
              <div key={`placeholder-${index}`} className={styles.itemPlaceholder}>
                <div>
                  <div className={styles.placeholderTitle} />
                  <div className={styles.placeholderTime} />
                </div>
                <div className={styles.placeholderAmount} />
              </div>
            ))
          ) : (
            <>
              {pointRecords.map((item) => (
                <div key={item.id} className={styles.item}>
                  <div>
                    <p className={styles.itemTitle}>{item.reason}</p>
                    <p className={styles.itemTime}>{formatTime(item.created_at)}</p>
                  </div>
                  <p
                    className={styles.itemAmount}
                    style={{
                      color:
                        item.transaction_type === 'income' ? 'oklch(63.7% .237 25.331)' : '#141414',
                    }}
                  >
                    {item.transaction_type === 'income' ? '+' : '-'}
                    {formatNumberWithCommas(item.amount)}
                  </p>
                </div>
              ))}
              {loading && pointRecords.length > 0 && (
                <div className={styles.loading}>
                  <span>加载中...</span>
                </div>
              )}
              {!hasMore && pointRecords.length > 0 && (
                <div className={styles.noMore}>
                  <span>没有更多了</span>
                </div>
              )}
            </>
          )}
        </div>
        <div className={styles.footer}>
          <button className={styles.cancelButton} onClick={onClose}>
            取消
          </button>
          <button className={styles.confirmButton} onClick={onRecharge}>
            升级套餐
          </button>
        </div>
      </div>
    </>
  );
}
