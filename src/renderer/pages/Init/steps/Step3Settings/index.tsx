import React, { useEffect, useState } from 'react';
import styles from './index.module.scss';

import { useHoldToRecordKeyLabel } from '@/renderer/hooks/useHoldToRecordKeyLabel';
import { Step3MicTestView } from '@/renderer/pages/Init/steps/components/Step3MicTestView';
import { Step3KeyChordTestView } from '@/renderer/pages/Init/steps/components/Step3KeyChordTestView';
import { Step3HoldKeyTestView } from '@/renderer/pages/Init/steps/components/Step3HoldKeyTestView';
import { useMicrophoneTest } from '@/renderer/pages/Init/steps/hooks/useMicrophoneTest';
import { useShortcutKeyTest } from '@/renderer/pages/Init/steps/hooks/useShortcutKeyTest';

type Step3SettingsProps = {
  onNext: () => void;
  onChangeShortcut?: () => void;
  /** 子步骤变化回调：0=麦克风, 1=组合键, 2=单键 */
  onSubStepChange?: (sub: number) => void;
};

const Step3Settings: React.FC<Step3SettingsProps> = ({ onNext, onSubStepChange }) => {
  const BARS = 24;
  const { label, isMac, isWin } = useHoldToRecordKeyLabel();
  const keyLabel = isWin && !isMac ? '右 Alt' : label;

  type IpcRendererLike = {
    invoke?: (channel: string, ...args: unknown[]) => Promise<unknown>;
    on?: (channel: string, handler: (event: unknown, ...args: unknown[]) => void) => void;
    off?: (channel: string, handler: (event: unknown, ...args: unknown[]) => void) => void;
  };

  type WindowBridge = Window & {
    electronAPI?: { ipcRenderer?: IpcRendererLike };
  };

  const ipcRenderer = (window as unknown as WindowBridge)?.electronAPI?.ipcRenderer;

  const [showMicPicker, setShowMicPicker] = useState(false);
  const [showKeyTest, setShowKeyTest] = useState(false);
  const [showKey, setShowKey] = useState(false);

  // 向父组件同步子步骤：0=mic, 1=chord, 2=hold
  useEffect(() => {
    const sub = !showKeyTest ? 0 : showKey ? 1 : 2;
    onSubStepChange?.(sub);
  }, [showKeyTest, showKey, onSubStepChange]);

  const mic = useMicrophoneTest({
    barsCount: BARS,
    enabled: !showKeyTest,
    ipcRenderer,
  });

  const keyTest = useShortcutKeyTest({
    enabled: showKeyTest,
    chordMode: showKey,
    ipcRenderer,
    isWin,
  });

  // 渲染麦克风测试视图
  if (!showKeyTest) {
    return (
      <Step3MicTestView
        styles={styles}
        barsCount={BARS}
        activeBars={mic.activeBars}
        showMicPicker={showMicPicker}
        onOpenMicPicker={() => {
          setShowMicPicker(true);
          void mic.refreshMicrophones();
        }}
        onCloseMicPicker={() => setShowMicPicker(false)}
        preferredValue={mic.preferredMicDeviceId ?? '__default__'}
        micOptions={mic.micOptions}
        onChangePreferredMic={mic.onChangePreferredMic}
        onNext={() => {
          mic.stop();
          setShowKeyTest(true);
          setShowKey(true);
        }}
      />
    );
  }
  if (showKey) {
    return (
      <Step3KeyChordTestView
        styles={styles}
        isMac={isMac}
        isWin={isWin}
        isChordSecondPressed={keyTest.isChordSecondPressed}
        isSpacePressed={keyTest.isSpacePressed}
        hasPressedOnce={keyTest.hasPressedOnce}
        onNext={() => {
          // 进入“单键测试”前重置一次，避免双键阶段已按过导致下一页直接可点
          setShowKey(false);
          keyTest.reset();
        }}
      />
    );
  }

  // 渲染按键测试视图（单键）
  return (
    <Step3HoldKeyTestView
      styles={styles}
      isMac={isMac}
      isWin={isWin}
      keyLabel={keyLabel}
      displayLabel={isWin && !isMac ? keyLabel : label}
      isKeyPressed={keyTest.isKeyPressed}
      hasPressedOnce={keyTest.hasPressedOnce}
      onNext={onNext}
    />
  );
};

export default Step3Settings;
