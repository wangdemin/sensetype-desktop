import React from 'react';
import { Modal } from '@/renderer/components/Modal';
import { DropdownSelect } from '@/renderer/components/DropdownSelect';

type Styles = Record<string, string>;

export type Step3MicTestViewProps = {
  styles: Styles;
  barsCount: number;
  activeBars: number;

  showMicPicker: boolean;
  onOpenMicPicker: () => void;
  onCloseMicPicker: () => void;

  preferredValue: string;
  micOptions: { value: string; label: string }[];
  onChangePreferredMic: (value: string) => void;

  onNext: () => void;
};

export const Step3MicTestView: React.FC<Step3MicTestViewProps> = ({
  styles,
  barsCount,
  activeBars,
  showMicPicker,
  onOpenMicPicker,
  onCloseMicPicker,
  preferredValue,
  micOptions,
  onChangePreferredMic,
  onNext,
}) => {
  return (
    <div className={styles.micRoot}>
      {/* ─── 左栏：文字 + 按钮 ─── */}
      <div className={styles.micLeft}>
        <h1 className={styles.micTitle}>请您说话测试麦克风是否可用</h1>
        <div className={styles.micDesc}>
          <p>您可以选择电脑自带的麦克风，也可以使用其他外接设备。</p>
          <p>我们只会在您使用输入法时访问您的麦克风设备。</p>
        </div>
        <div className={styles.micQuestion}>请您确认，说话时黑色的音量条是否在跳动？</div>
        <div className={styles.micActions}>
          <button type="button" className={styles.micSecondaryBtn} onClick={onOpenMicPicker}>
            否，更换麦克风
          </button>
          <button type="button" className={styles.micPrimaryBtn} onClick={onNext}>
            是，下一步
          </button>
        </div>
      </div>

      {/* ─── 右栏：音量条卡片 ─── */}
      <div className={styles.micRight}>
        <div className={styles.micBarsCard}>
          {Array.from({ length: barsCount }).map((_, i) => (
            <span
              key={i}
              className={`${styles.micBar} ${i < activeBars ? styles.micBarActive : ''}`}
            />
          ))}
        </div>
      </div>

      {/* ─── 麦克风选择弹窗（逻辑不变） ─── */}
      <Modal
        open={showMicPicker}
        onClose={onCloseMicPicker}
        title="更换麦克风"
        subtitle="请选择您要使用的麦克风"
        footer={
          <button type="button" className={styles.modalCloseBtn} onClick={onCloseMicPicker}>
            关闭
          </button>
        }
      >
        <div className={styles.micPickerRow}>
          <div className={styles.micPickerLabel}>麦克风</div>
          <div className={styles.micPickerControl}>
            <DropdownSelect
              value={preferredValue}
              options={micOptions}
              onChange={onChangePreferredMic}
              ariaLabel="选择麦克风"
              title="选择麦克风"
            />
          </div>
        </div>
      </Modal>
    </div>
  );
};
