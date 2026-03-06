import React from 'react';

// Keyboard key-state images (default / pressed)
import winAltDefault from '@/assets/webp/win-alt-default.webp';
import winAltPressDown from '@/assets/webp/win-alt-press-down.webp';
import macOptionDefault from '@/assets/webp/mac-option-default.webp';
import macOptionPressDown from '@/assets/webp/mac-option-press-down.webp';

type Styles = Record<string, string>;

export type Step3HoldKeyTestViewProps = {
  styles: Styles;
  isMac: boolean;
  isWin: boolean;
  keyLabel: string;
  displayLabel: string;
  isKeyPressed: boolean;
  hasPressedOnce: boolean;
  onNext: () => void;
};

/* ── Preload & decode all keyboard images at module level ──
 * decode() ensures the bitmap is GPU-ready before the user ever
 * touches a key, so the first swap is just as instant as subsequent ones. */
const PRELOAD_SRCS = [winAltDefault, winAltPressDown, macOptionDefault, macOptionPressDown];
PRELOAD_SRCS.forEach((src) => {
  const img = new Image();
  img.src = src;
  img.decode().catch(() => {});
});

export const Step3HoldKeyTestView: React.FC<Step3HoldKeyTestViewProps> = ({
  styles,
  isMac,
  isWin,
  displayLabel,
  isKeyPressed,
  hasPressedOnce,
  onNext,
}) => {
  const defaultImg = isMac ? macOptionDefault : winAltDefault;
  const pressedImg = isMac ? macOptionPressDown : winAltPressDown;

  // Platform-specific key names
  // physicalKey = the key user physically presses (右Alt on Win, 右option on Mac)
  // screenKey  = the key shown in the keyboard image on screen
  const physicalKey = isWin && !isMac ? displayLabel : `右${displayLabel}`;
  const screenKey = isWin && !isMac ? displayLabel : `右${displayLabel}`;

  return (
    <div className={styles.holdRoot}>
      {/* ─── Left column: text + buttons ─── */}
      <div className={styles.holdLeft}>
        <h1 className={styles.holdTitle}>长按键测试</h1>

        <div className={styles.holdDesc}>
          <p>请您按下{physicalKey}键进行测试</p>
          <p>
            按下键盘上的{physicalKey}键时，右侧页面的{screenKey}键是否有变色？
          </p>
        </div>

        <div className={styles.holdHint}>
          如您的键盘上没有{physicalKey}键，您可以点击否直接进入下一步
        </div>

        <div className={styles.holdActions}>
          <button type="button" className={styles.holdSecondaryBtn} onClick={onNext}>
            否
          </button>
          <button
            type="button"
            className={styles.holdPrimaryBtn}
            disabled={!hasPressedOnce}
            onClick={onNext}
          >
            是, 下一步
          </button>
        </div>
      </div>

      {/* ─── Right column: keyboard images ─── */}
      <div className={styles.holdRight}>
        <div className={styles.holdKeyboardWrap}>
          {/* Default image always visible (provides sizing).
              Pressed image overlays on top and fades in/out.
              No crossfade bleed — only the overlay changes opacity. */}
          <img src={defaultImg} alt="" className={styles.holdKeyImgBase} draggable={false} />
          <img
            src={pressedImg}
            alt=""
            className={`${styles.holdKeyImgOverlay} ${isKeyPressed ? styles.holdKeyImgActive : ''}`}
            draggable={false}
          />
        </div>

        <div className={styles.holdBottomHint}>
          <p className={styles.holdBottomTitle}>桌面键盘同样适用</p>
          <p>长按{physicalKey}键即可唤醒输入法，按住时说话，您的语音内容将被自动识别为文字</p>
        </div>
      </div>
    </div>
  );
};
