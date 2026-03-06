import React from 'react';
import styles from './index.module.scss';
import { useTutorialCarousel } from '@/renderer/pages/Init/steps/hooks/useTutorialCarousel';

type TutorialCarouselProps = {
  slides: string[];
  active: boolean;
  ariaLabel: string;
  autoplayMs?: number;
};

const TutorialCarousel: React.FC<TutorialCarouselProps> = ({
  slides,
  active,
  ariaLabel,
  autoplayMs = 2500,
}) => {
  const { aspectRatio, index, isReady, viewportProps, trackStyle, goTo } = useTutorialCarousel({
    slides,
    active,
    autoplayMs,
  });

  return (
    <div className={styles.root}>
      <div
        className={`${styles.viewport} ${aspectRatio ? '' : styles.viewportPlaceholder}`}
        {...viewportProps}
        style={aspectRatio ? { aspectRatio } : undefined}
      >
        <div
          className={`${styles.track} ${isReady ? styles.trackReady : styles.trackHidden}`}
          style={trackStyle}
        >
          {slides.map((src, idx) => (
            <div className={styles.slide} key={idx}>
              <img src={src} alt="" className={styles.image} draggable={false} />
            </div>
          ))}
        </div>
      </div>

      <div className={styles.dots} role="tablist" aria-label={ariaLabel}>
        {slides.map((_, idx) => (
          <button
            key={idx}
            type="button"
            className={`${styles.dot} ${idx === index ? styles.dotActive : ''}`}
            onClick={() => goTo(idx)}
            aria-label={`第 ${idx + 1} 张`}
            aria-selected={idx === index}
            role="tab"
          />
        ))}
      </div>
    </div>
  );
};

export default TutorialCarousel;
