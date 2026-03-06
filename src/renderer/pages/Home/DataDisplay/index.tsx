import styles from './index.module.scss';
import Icon1 from '@/assets/icons/home-card-icon1.svg?react';
import Icon2 from '@/assets/icons/home-card-icon2.svg?react';
import Icon3 from '@/assets/icons/home-card-icon3.svg?react';
import Icon4 from '@/assets/icons/home-card-icon4.svg?react';
import { useEffect, useMemo } from 'react';
import { useHistoryStore } from '@/renderer/store/useHistoryStore';
import { useCountUp } from '@/renderer/hooks/useCountUp';

type CardData = {
  icon: React.ComponentType;
  title: string;
  value: string;
  unit: string;
};

interface CardItemProps {
  icon: React.ComponentType;
  title: string;
  value: number;
  unit: string;
  enabled: boolean;
}

function CardItem({ icon: Icon, title, value, unit, enabled }: CardItemProps) {
  const { displayValue } = useCountUp({
    end: value,
    duration: 1500,
    enabled,
  });

  return (
    <div className={styles.box}>
      <div className={styles.top}>
        <span>{displayValue}</span>
        <p>{unit}</p>
      </div>
      <div className={styles.bottom}>
        <Icon />
        <span>{title}</span>
      </div>
    </div>
  );
}

function countChars(text: string): number {
  // “字数”这里按非空白字符统计（中文/英文都适用）
  return (text || '').replace(/\s+/g, '').length;
}

const DataDisplay = () => {
  const hydrate = useHistoryStore((s) => s.hydrate);
  const hydrated = useHistoryStore((s) => s.hydrated);
  const records = useHistoryStore((s) => s.records);

  useEffect(() => {
    if (!hydrated) hydrate();
  }, [hydrate, hydrated]);

  const cardData: CardData[] = useMemo(() => {
    const done = records.filter((r) => r.status === 'done' && (r.text || '').trim());

    const totalDurationMs = done.reduce((sum, r) => sum + (r.durationMs || 0), 0);
    const totalMinutes = totalDurationMs / 60000;
    const totalMinutesRounded = Math.round(totalMinutes);

    const totalChars = done.reduce((sum, r) => sum + countChars(r.text), 0);

    // 平均口述速度：每分钟字数（按时长加权）
    const avgCpm = totalMinutes > 0 ? Math.round(totalChars / totalMinutes) : 0;

    // 节省时间：用一个“打字速度”基线估算 typingTime，再减去口述耗时（避免出现负数）
    // 如果你们有产品侧的既定口径/参数（比如可配置的打字速度），我可以再把这里对齐成同一套。
    const TYPING_CPM = 40;
    const typingMinutes = TYPING_CPM > 0 ? totalChars / TYPING_CPM : 0;
    const savedMinutes = Math.max(0, Math.round(typingMinutes - totalMinutes));

    return [
      {
        icon: Icon1,
        title: '总口述时间',
        value: String(totalMinutesRounded),
        unit: '分钟',
      },
      {
        icon: Icon2,
        title: '口述字数',
        value: String(totalChars),
        unit: '字',
      },
      {
        icon: Icon3,
        title: '节省时间',
        value: String(savedMinutes),
        unit: '分钟',
      },
      {
        icon: Icon4,
        title: '平均每分钟口述字数',
        value: String(avgCpm),
        unit: '字',
      },
    ];
  }, [records]);

  return (
    <div className={styles.dataDisplay}>
      {cardData.map((item, index) => {
        const numericValue = Number(item.value) || 0;
        return (
          <CardItem
            key={index}
            icon={item.icon}
            title={item.title}
            value={numericValue}
            unit={item.unit}
            enabled={hydrated}
          />
        );
      })}
    </div>
  );
};

export default DataDisplay;
