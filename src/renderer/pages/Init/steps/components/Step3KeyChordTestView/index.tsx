import React from 'react';

// Keyboard key-state images (default / pressed)
import macFnControlDefault from '@/assets/webp/mac-fn-control-default.webp';
import macFnControlPressDown from '@/assets/webp/mac-fn-control-press-down.webp';
import winCtrlDefault from '@/assets/webp/win-ctrl-default.webp';
import winCtrlPressDown from '@/assets/webp/win-ctrl-press-down.webp';

type Styles = Record<string, string>;

export type Step3KeyChordTestViewProps = {
  styles: Styles;
  isMac: boolean;
  isWin: boolean;
  isChordSecondPressed: boolean;
  isSpacePressed: boolean;
  hasPressedOnce: boolean;
  onNext: () => void;
};

/* ── Preload & decode all keyboard images at module level ──
 * decode() ensures the bitmap is GPU-ready before the user ever
 * touches a key, so the first swap is just as instant as subsequent ones. */
const PRELOAD_SRCS = [macFnControlDefault, macFnControlPressDown, winCtrlDefault, winCtrlPressDown];
PRELOAD_SRCS.forEach((src) => {
  const img = new Image();
  img.src = src;
  img.decode().catch(() => {});
});

export const Step3KeyChordTestView: React.FC<Step3KeyChordTestViewProps> = ({
  styles,
  isMac,
  isWin,
  isChordSecondPressed,
  isSpacePressed,
  hasPressedOnce,
  onNext,
}) => {
  // Both chord keys must be held simultaneously to show the pressed image
  const isBothKeysPressed = isChordSecondPressed && isSpacePressed;

  const defaultImg = isMac ? macFnControlDefault : winCtrlDefault;
  const pressedImg = isMac ? macFnControlPressDown : winCtrlPressDown;

  // Platform-specific key names
  const key1 = isMac ? 'fn' : 'Ctrl';
  const key2 = isMac ? '空格键' : 'Win键';

  return (
    <div className={styles.chordRoot}>
      {/* ─── Left column: text + buttons ─── */}
      <div className={styles.chordLeft}>
        <h1 className={styles.chordTitle}>组合键测试</h1>

        <div className={styles.chordDesc}>
          <p>
            请您同时按下<span className={styles.chordKeyBold}>{key1}键</span>、
            <span className={styles.chordKeyBold}>{key2}</span>进行测试
          </p>
          <p>
            按下键盘上的{key1}键、{key2}时，右侧页面的{key1}键、{key2}是否有变色？
          </p>
        </div>

        <div className={styles.chordHint}>
          如您的键盘上没有{key1}键或{key2}，您可以点击否直接进入下一步
        </div>

        <div className={styles.chordActions}>
          <button type="button" className={styles.chordSecondaryBtn} onClick={onNext}>
            否
          </button>
          <button
            type="button"
            className={styles.chordPrimaryBtn}
            disabled={!hasPressedOnce}
            onClick={onNext}
          >
            是，下一步
          </button>
        </div>
      </div>

      {/* ─── Right column: keyboard key images ─── */}
      <div className={styles.chordRight}>
        <div className={styles.chordKeyboardWrap}>
          {/* Default image always visible (provides sizing).
              Pressed image overlays on top and fades in/out.
              No crossfade bleed — only the overlay changes opacity. */}
          <img src={defaultImg} alt="" className={styles.chordKeyImgBase} draggable={false} />
          <img
            src={pressedImg}
            alt=""
            className={`${styles.chordKeyImgOverlay} ${isBothKeysPressed ? styles.chordKeyImgActive : ''}`}
            draggable={false}
          />
        </div>

        <div className={styles.chordBottomHint}>
          {isMac && <p className={styles.chordBottomTitle}>桌面键盘同样适用</p>}
          <p>
            同时按下{key1}
            键+{key2}，松开后即可唤醒输入法开始识别，您可以自由说话，再次按下则识别结束
          </p>
        </div>
      </div>
    </div>
  );
};
