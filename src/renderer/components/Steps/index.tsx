import React from 'react';
import styles from './index.module.scss';
import RightArrowIcon from '@/assets/icons/right-arrows.svg?react';

export type StepItem = {
  title: string;
  description?: string;
};

type StepsProps = {
  current: number;
  steps: StepItem[];
  /** 紧凑模式：用于嵌入标题栏，缩小尺寸 */
  compact?: boolean;
};

const Steps: React.FC<StepsProps> = ({ current, steps, compact }) => {
  // 检测是否是Windows系统
  const w = window as Window & { sensetype?: { isWindows?: () => boolean } };
  const isWindows = w?.sensetype?.isWindows?.() ?? /Windows/i.test(navigator.userAgent);

  const displaySteps = steps
    .map((step, index) => ({ step, index, stepNumber: index + 1 }))
    .filter(({ index }) => !(isWindows && index === 1));

  const containerCls = compact
    ? `${styles.stepsContainer} ${styles.stepsContainerCompact}`
    : styles.stepsContainer;
  const contentCls = compact
    ? `${styles.stepsContent} ${styles.stepsContentCompact}`
    : styles.stepsContent;

  return (
    <div className={containerCls}>
      <div className={contentCls}>
        {displaySteps.map(({ step, index, stepNumber }, displayIndex) => {
          const isActive = stepNumber === current;
          const stepTitleClassNames = [
            styles.stepTitle,
            compact && styles.stepTitleCompact,
            isActive ? styles.stepTitleActive : styles.stepTitleInactive,
          ]
            .filter(Boolean)
            .join(' ');

          // 判断箭头前面的步骤是否已完成
          const isPreviousStepCompleted = stepNumber < current;
          const arrowClassNames = [
            styles.arrowIcon,
            compact && styles.arrowIconCompact,
            isPreviousStepCompleted && styles.arrowIconCompleted,
          ]
            .filter(Boolean)
            .join(' ');

          return (
            <React.Fragment key={index}>
              <span className={stepTitleClassNames}>{step.title}</span>
              {displayIndex < displaySteps.length - 1 && (
                <RightArrowIcon className={arrowClassNames} />
              )}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
};

export default Steps;
