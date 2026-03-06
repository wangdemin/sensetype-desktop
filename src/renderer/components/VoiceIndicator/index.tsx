import { useEffect, useMemo, useState } from 'react';
import styles from './index.module.scss';

export type VoiceIndicatorStatus = 'speaking' | 'silent' | 'loading';

export type VoiceIndicatorProps = {
  status: VoiceIndicatorStatus;
  volumes?: number[]; // 0..1
  visible: boolean;
};

function clamp01(v: number) {
  return Math.max(0, Math.min(1, v));
}

export default function VoiceIndicator(props: VoiceIndicatorProps) {
  const { status, volumes, visible } = props;
  const [isHiding, setIsHiding] = useState(false);
  const [rendered, setRendered] = useState(visible);

  useEffect(() => {
    if (visible) {
      setRendered(true);
      setIsHiding(false);
      return;
    }
    if (!rendered) return;
    setIsHiding(true);
    const t = window.setTimeout(() => {
      setRendered(false);
      setIsHiding(false);
    }, 190);
    return () => window.clearTimeout(t);
  }, [rendered, visible]);

  const barValues = useMemo(() => {
    // 去掉最右边那根（最末端那根经常“几乎不动/抖动怪”）
    const count = 12;
    const min = 0.12;
    const max = 1;

    // 如果上游给了 13 根，这里只取前 12 根（丢弃最后一根 = 去掉最右边）
    const src = volumes && volumes.length ? volumes : new Array(count).fill(0);
    const vals = new Array(count).fill(0).map((_, i) => clamp01(src[i] ?? 0));

    // loading 状态使用一个"固定但有中心更高"的静态形状
    if (status === 'loading') {
      const center = (count - 1) / 2;
      return vals.map((_, i) => {
        const nd = Math.abs(i - center) / center; // 0..1
        const symmetry = Math.max(0.6, 1 - nd * nd * 0.5);
        return clamp01(min + (max - min) * 0.55 * symmetry);
      });
    }

    // speaking：输入是 0..1，做一个温和的中心增强（比 src copy 更自然）
    if (status === 'speaking') {
      const center = (count - 1) / 2;
      return vals.map((v, i) => {
        const nd = Math.abs(i - center) / center;
        const symmetry = Math.max(0.65, 1 - nd * nd * 0.35);
        const shaped = Math.pow(v, 0.7); // 提升低音量细节，避免"抽搐"
        return clamp01(min + (max - min) * shaped * symmetry);
      });
    }

    // silent 不需要 bars
    return vals.map(() => 0);
  }, [status, volumes]);

  if (!rendered) return null;

  return (
    <div className={`${styles.indicator} ${isHiding ? styles.hiding : ''}`}>
      <div className={styles.row}>
        {status === 'loading' ? (
          <div className={styles.rotatingPoints}>
            <div className={styles.rotatingPoint} />
            <div className={styles.rotatingPoint} />
            <div className={styles.rotatingPoint} />
          </div>
        ) : null}

        {status === 'silent' ? (
          <div className={styles.dots}>
            {Array.from({ length: 10 }).map((_, i) => (
              <div key={i} className={styles.dot} />
            ))}
          </div>
        ) : (
          <div className={styles.waveBars}>
            {barValues.map((v, i) => (
              <div
                key={i}
                className={styles.bar}
                style={{
                  height: `${Math.round(3 + 20 * v)}px`,
                  transition: 'height 80ms cubic-bezier(0.4, 0, 0.2, 1)',
                  animationDelay: `${i * 0.1}s`,
                }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
