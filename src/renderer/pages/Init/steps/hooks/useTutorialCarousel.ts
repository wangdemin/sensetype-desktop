import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';

type UseTutorialCarouselParams = {
  slides: string[];
  active: boolean;
  autoplayMs?: number;
};

const preloadImages = (urls: string[]) =>
  Promise.all(
    urls.map(
      (url) =>
        new Promise<void>((resolve) => {
          const img = new Image();
          img.onload = () => resolve();
          img.onerror = () => resolve();
          img.src = url;
        }),
    ),
  );

export function useTutorialCarousel({
  slides,
  active,
  autoplayMs = 2500,
}: UseTutorialCarouselParams) {
  const [index, setIndex] = useState(0);
  const [isReady, setIsReady] = useState(false);
  const [aspectRatio, setAspectRatio] = useState<string | undefined>(undefined);

  const pointerRef = useRef<{ pointerId: number | null; startX: number }>({
    pointerId: null,
    startX: 0,
  });
  const autoplayTimerRef = useRef<number | null>(null);

  const clampIndex = useCallback(
    (next: number) => {
      const max = Math.max(0, slides.length - 1);
      return Math.max(0, Math.min(max, next));
    },
    [slides.length],
  );

  const stopAutoplay = useCallback(() => {
    if (autoplayTimerRef.current) {
      window.clearInterval(autoplayTimerRef.current);
      autoplayTimerRef.current = null;
    }
  }, []);

  const startAutoplay = useCallback(() => {
    stopAutoplay();
    if (!active || slides.length <= 1) {
      return;
    }
    autoplayTimerRef.current = window.setInterval(() => {
      setIndex((idx) => (idx + 1) % slides.length);
    }, autoplayMs);
  }, [active, autoplayMs, slides.length, stopAutoplay]);

  // slides 变更时：重置 index/ready，并探测首图比例 + 预加载
  useEffect(() => {
    let cancelled = false;
    setIsReady(false);
    setIndex(0);

    const probe = new Image();
    probe.onload = () => {
      if (cancelled) return;
      const w = probe.naturalWidth || probe.width;
      const h = probe.naturalHeight || probe.height;
      if (w && h) setAspectRatio(`${w} / ${h}`);
    };
    if (slides[0]) {
      probe.src = slides[0];
    }

    void preloadImages(slides).then(() => {
      if (!cancelled) setIsReady(true);
    });

    return () => {
      cancelled = true;
    };
  }, [slides]);

  // 自动播放仅在 active 时运行
  useEffect(() => {
    if (!active) {
      stopAutoplay();
      return;
    }
    startAutoplay();
    return () => stopAutoplay();
  }, [active, startAutoplay, stopAutoplay]);

  const goTo = useCallback(
    (next: number) => {
      setIndex(clampIndex(next));
      startAutoplay();
    },
    [clampIndex, startAutoplay],
  );

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (e.pointerType === 'mouse' && e.button !== 0) {
        return;
      }
      stopAutoplay();
      pointerRef.current.pointerId = e.pointerId;
      pointerRef.current.startX = e.clientX;
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    [stopAutoplay],
  );

  const onPointerUp = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (pointerRef.current.pointerId !== e.pointerId) {
        return;
      }
      const deltaX = e.clientX - pointerRef.current.startX;
      pointerRef.current.pointerId = null;
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }

      const threshold = 40;
      if (Math.abs(deltaX) < threshold) {
        startAutoplay();
        return;
      }
      const nextIndex = deltaX > 0 ? index - 1 : index + 1;
      setIndex(clampIndex(nextIndex));
      startAutoplay();
    },
    [clampIndex, index, startAutoplay],
  );

  const onPointerCancel = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (pointerRef.current.pointerId !== e.pointerId) {
        return;
      }
      pointerRef.current.pointerId = null;
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
      startAutoplay();
    },
    [startAutoplay],
  );

  const trackStyle = useMemo(
    () => ({
      transform: `translate3d(-${index * 100}%, 0, 0)`,
    }),
    [index],
  );

  return {
    index,
    setIndex,
    isReady,
    aspectRatio,
    trackStyle,
    goTo,
    viewportProps: {
      onPointerDown,
      onPointerUp,
      onPointerCancel,
    },
  };
}
