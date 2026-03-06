import { useEffect, useState, useRef } from 'react';

interface UseCountUpOptions {
  /** 目标数值 */
  end: number;
  /** 动画持续时间（毫秒） */
  duration?: number;
  /** 是否启用动画 */
  enabled?: boolean;
  /** 格式化函数 */
  formatter?: (value: number) => string;
}

/**
 * 数字递增动画 Hook
 * 从 0 递增到目标值，带有平滑的动画效果
 */
export function useCountUp({ end, duration = 1500, enabled = true, formatter }: UseCountUpOptions) {
  const [count, setCount] = useState(0);
  const [isAnimating, setIsAnimating] = useState(false);
  const startTimeRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const previousEndRef = useRef<number>(0);
  const isInitialMountRef = useRef(true);

  useEffect(() => {
    // 首次挂载时，如果禁用动画，直接设置
    if (isInitialMountRef.current) {
      isInitialMountRef.current = false;
      if (!enabled) {
        setCount(end);
        previousEndRef.current = end;
        return;
      }
      // 首次启用动画时，从 0 开始
      previousEndRef.current = 0;
    }

    // 如果禁用动画，直接设置
    if (!enabled) {
      setCount(end);
      previousEndRef.current = end;
      return;
    }

    // 如果值没有变化，不重新动画
    if (end === previousEndRef.current) {
      return;
    }

    // 如果值变小了，直接设置（不反向动画）
    if (end < previousEndRef.current) {
      setCount(end);
      previousEndRef.current = end;
      return;
    }

    // 开始新的动画
    const startValue = previousEndRef.current;
    const endValue = end;
    const difference = endValue - startValue;

    if (difference === 0) return;

    // 取消之前的动画
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
    }

    setIsAnimating(true);
    startTimeRef.current = null;

    const animate = (currentTime: number) => {
      if (startTimeRef.current === null) {
        startTimeRef.current = currentTime;
      }

      const elapsed = currentTime - startTimeRef.current;
      const progress = Math.min(elapsed / duration, 1);

      // 使用 easeOutCubic 缓动函数，让动画更自然
      const easeOutCubic = 1 - Math.pow(1 - progress, 3);
      const currentValue = Math.floor(startValue + difference * easeOutCubic);

      setCount(currentValue);

      if (progress < 1) {
        rafRef.current = requestAnimationFrame(animate);
      } else {
        setCount(endValue);
        setIsAnimating(false);
        previousEndRef.current = endValue;
        rafRef.current = null;
      }
    };

    rafRef.current = requestAnimationFrame(animate);

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [end, duration, enabled]);

  const displayValue = formatter ? formatter(count) : String(count);

  return { count, displayValue, isAnimating };
}
