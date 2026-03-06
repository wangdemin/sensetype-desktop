import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

export const useMasonryGrid = (deps: {
  layout: string;
  /** 接口返回的分组总数（用于统计/分页语义） */
  groupCount: number;
  /** 当前实际渲染的分组数量（用于重新测量/挂载观察器） */
  renderedGroupCount: number;
}) => {
  const gridRef = useRef<HTMLDivElement | null>(null);
  const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const [rowSpans, setRowSpans] = useState<Record<string, number>>({});
  const resizeObserverRef = useRef<ResizeObserver | null>(null);

  const measureSpans = useCallback(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const computed = getComputedStyle(grid);
    // CSS 变量 --masonry-row-height 现为 1px，以提高精度
    const rowHeight = parseFloat(computed.getPropertyValue('--masonry-row-height')) || 1;
    // CSS 变量 --masonry-row-gap 用作视觉上的底部间距
    const rowGap = parseFloat(computed.getPropertyValue('--masonry-row-gap')) || 14;

    const next: Record<string, number> = {};
    cardRefs.current.forEach((el, id) => {
      const height = el.getBoundingClientRect().height;
      // 当 row-gap 为 0、row-height 为 1px 时，span 即为高度 + 期望间距
      // 使用 ceil 确保覆盖小数像素
      next[id] = Math.ceil((height + rowGap) / rowHeight);
    });
    setRowSpans(next);
  }, []);

  // 初始测量与窗口尺寸变化处理
  useLayoutEffect(() => {
    // 立即测量
    measureSpans();

    // 使用 RAF 做一次安全校验
    const raf = window.requestAnimationFrame(measureSpans);
    return () => window.cancelAnimationFrame(raf);
  }, [deps.groupCount, deps.renderedGroupCount, deps.layout, measureSpans]);

  // ResizeObserver 处理动态内容变化（增删项）
  useEffect(() => {
    // 清理之前的观察器
    if (resizeObserverRef.current) {
      resizeObserverRef.current.disconnect();
    }

    const observer = new ResizeObserver(() => {
      window.requestAnimationFrame(measureSpans);
    });
    resizeObserverRef.current = observer;

    const grid = gridRef.current;
    if (grid) {
      observer.observe(grid);
    }

    // 观察每个卡片元素以检测内容更新导致的高度变化
    cardRefs.current.forEach((el) => {
      observer.observe(el);
    });

    return () => {
      observer.disconnect();
    };
  }, [deps.groupCount, deps.renderedGroupCount, measureSpans]); // 分组数量变化（卡片增删）时重新挂载

  return { gridRef, cardRefs, rowSpans };
};
