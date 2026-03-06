import { useEffect, useMemo } from 'react';
import styles from './index.module.scss';

type Shape = 'rect' | 'slim' | 'parallelogram' | 'diamond';

type Piece = {
  id: number;
  shape: Shape;
  color: string;
  width: number;
  height: number;
  sx: number;
  sy: number;
  ex: number;
  ey: number;
  r0: number;
  r1: number;
  delay: number;
  dur: number;
  s0: number;
  s1: number;
};

interface ConfettiProps {
  /** 点击位置 x（用于轻微偏移，不强制作为中心） */
  x: number;
  /** 点击位置 y（用于轻微偏移，不强制作为中心） */
  y: number;
  /** 期望数量（实际会 clamp 到 24~80） */
  particleCount?: number;
  /** 持续时间（毫秒） */
  duration?: number;
  /** 动画结束回调 */
  onComplete?: () => void;
}

const COLORS = [
  '#F59E0B', // yellow
  '#F97316', // orange
  '#3B82F6', // blue
  '#22C55E', // green
  '#EF4444', // red
  '#A855F7', // purple
  '#EC4899', // pink
];

const rand = (min: number, max: number) => min + Math.random() * (max - min);
const pick = <T,>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)];

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function rayToEdge(x: number, y: number, dx: number, dy: number, w: number, h: number) {
  const ts: number[] = [];
  if (dx > 0) ts.push((w - x) / dx);
  else if (dx < 0) ts.push((0 - x) / dx);
  if (dy > 0) ts.push((h - y) / dy);
  else if (dy < 0) ts.push((0 - y) / dy);
  if (ts.length === 0) return 0;
  return Math.max(0, Math.min(...ts));
}

function createPieces(x: number, y: number, count: number, baseDuration: number): Piece[] {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const margin = 220;

  // 方向：从左下（点击点附近）→ 右上（往上撒），并且更“散开”
  const pieces: Piece[] = [];
  for (let i = 0; i < count; i += 1) {
    const shape: Shape = pick(['rect', 'slim', 'parallelogram', 'diamond']);
    const color = pick(COLORS);

    // size：再小一档（更轻、更密）
    const sizePreset = Math.random();
    let width = 80;
    let height = 60;
    if (shape === 'slim') {
      width = rand(56, 110);
      height = rand(7, 11);
    } else if (sizePreset < 0.35) {
      width = rand(58, 98);
      height = rand(34, 72);
    } else if (sizePreset < 0.7) {
      width = rand(30, 58);
      height = rand(30, 58);
    } else {
      width = rand(44, 86);
      height = rand(22, 46);
    }

    // 起点：围绕点击点（更松一点，避免起点过于挤）
    const sx = x + rand(-36, 18);
    const sy = y + rand(-18, 36);

    // 终点：扇形往右上发散（比现在更散）
    // 以 -45° 为中心（右上），扇形范围加大到约 160°，确保“全部散开”
    const base = -Math.PI / 4;
    const spread = (Math.PI * 160) / 180;
    const angle = base + rand(-spread / 2, spread / 2);
    const dirX = Math.cos(angle);
    const dirY = Math.sin(angle);

    // 让部分粒子偏“更上”、部分偏“更右”，增加覆盖
    const bias = rand(-0.22, 0.22);
    const dx = dirX + bias * 0.35;
    const dy = dirY - bias * 0.25;

    const t = rayToEdge(x, y, dx, dy, w, h);
    const dist = (t + margin) * rand(0.85, 1.15);

    // 垂直方向漂移，让终点更分散
    const px = -dy;
    const py = dx;
    const curve = rand(-dist * 0.25, dist * 0.25);

    const ex = x + dx * dist + px * curve + rand(-140, 160);
    const ey = y + dy * dist + py * curve + rand(-180, 120);

    // 少量随机延迟即可（避免“分段感”）
    const delay = rand(0, 60);
    const dur = rand(baseDuration * 0.95, baseDuration * 1.25);
    const r0 = rand(-22, 22);
    const r1 = r0 + rand(-110, 110);
    const s0 = rand(0.95, 1.03);
    const s1 = rand(0.95, 1.03);

    pieces.push({
      id: i,
      shape,
      color,
      width,
      height,
      sx,
      sy,
      ex,
      ey,
      r0,
      r1,
      delay,
      dur,
      s0,
      s1,
    });
  }

  return pieces;
}

export default function Confetti({
  x,
  y,
  particleCount = 56,
  duration = 1900,
  onComplete,
}: ConfettiProps) {
  const count = clamp(Math.round(particleCount), 24, 80);

  const pieces = useMemo(() => {
    // 读一次 window 尺寸，生成“Flow 风格”的大块彩纸
    return createPieces(x, y, count, duration);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [x, y, count, duration]);

  useEffect(() => {
    const maxDelay = Math.max(...pieces.map((p) => p.delay));
    const maxDur = Math.max(...pieces.map((p) => p.dur));
    const t = window.setTimeout(
      () => {
        onComplete?.();
      },
      Math.ceil(maxDelay + maxDur + 50),
    );
    return () => window.clearTimeout(t);
  }, [onComplete, pieces]);

  return (
    <div className={styles.confettiContainer}>
      {pieces.map((p) => (
        <div
          key={p.id}
          className={`${styles.piece} ${styles[p.shape]}`}
          style={
            {
              width: `${p.width}px`,
              height: `${p.height}px`,
              background: p.color,
              '--sx': `${p.sx}px`,
              '--sy': `${p.sy}px`,
              '--ex': `${p.ex}px`,
              '--ey': `${p.ey}px`,
              '--r0': `${p.r0}deg`,
              '--r1': `${p.r1}deg`,
              '--delay': `${p.delay}ms`,
              '--dur': `${Math.round(p.dur)}ms`,
              '--s0': `${p.s0}`,
              '--s1': `${p.s1}`,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}
