import React, { useEffect, useRef, useState } from 'react';
import styles from './index.module.scss';
import CopyIcon from '@/assets/icons/step-hand.svg?react';
import MicIcon from '@/assets/icons/step-mic.svg?react';
import SendIcon from '@/assets/icons/step-top.svg?react';
import step4AvatarSrc from '@/assets/icons/step4avatar.svg';
import rewriteWebp from '@/assets/webp/rewrite.webp';
import translateWebp from '@/assets/webp/translate.webp';
import { useHoldToRecordKeyLabel } from '@/renderer/hooks/useHoldToRecordKeyLabel';
import { useVoiceRecognition } from '@/renderer/hooks/useVoiceRecognition';

type Step4TutorialProps = {
  onNext: () => void;
  onPrev?: () => void;
  /** 子步骤变化回调：0=shortcut, 1=rewrite, 2=translate */
  onSubStepChange?: (sub: number) => void;
};

type TutorialSubStep = 'shortcut' | 'rewrite' | 'translate';

const subStepMap: Record<TutorialSubStep, number> = {
  shortcut: 0,
  rewrite: 1,
  translate: 2,
};

const InitTutorialVoiceHost: React.FC = () => {
  // 教程页需要在当前输入框内看到结果，因此开启自动插入。
  const { startRecording, stopRecording } = useVoiceRecognition({ autoInsert: true });
  const startRecordingRef = useRef(startRecording);
  const stopRecordingRef = useRef(stopRecording);

  useEffect(() => {
    startRecordingRef.current = startRecording;
    stopRecordingRef.current = stopRecording;
  }, [startRecording, stopRecording]);

  useEffect(() => {
    const runtimeWindow = window as Window & {
      sensetype?: { isMacOs?: () => boolean };
      electronAPI?: {
        ipcRenderer?: { invoke?: (channel: string, ...args: unknown[]) => Promise<unknown> };
      };
    };
    const isMac = runtimeWindow?.sensetype?.isMacOs?.() ?? false;
    const ipcRenderer = runtimeWindow?.electronAPI?.ipcRenderer;
    if (!isMac || !ipcRenderer?.invoke) return;

    // 关键：教程页临时挂起主进程全局 Option 钩子，改用本地按键监听，
    // 避免 EventTap 介入导致窗口失焦/闪烁。
    // 首次进入时先等待挂起请求完成，避免用户按键早于挂起生效导致主窗口异常后移/隐藏。
    let hotkeySuspendReady = false;
    let suspendReadyFallbackTimer: number | null = null;
    ipcRenderer
      .invoke('hotkey-set-suspended', { suspended: true, reason: 'init-step4-tutorial' })
      .then(() => {
        hotkeySuspendReady = true;
      })
      .catch(() => {
        // 挂起失败时也允许本地监听继续工作，避免教程页按键完全失效
        hotkeySuspendReady = true;
      });
    suspendReadyFallbackTimer = window.setTimeout(() => {
      hotkeySuspendReady = true;
      suspendReadyFallbackTimer = null;
    }, 1200);

    let holdingOption = false;
    const onKeyDown = (e: KeyboardEvent) => {
      if (!hotkeySuspendReady) return;
      if (e.key !== 'Alt' || e.repeat) return;
      if (holdingOption) return;
      e.preventDefault();
      holdingOption = true;
      startRecordingRef.current?.('global-hotkey');
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (!hotkeySuspendReady) return;
      if (e.key !== 'Alt') return;
      if (!holdingOption) return;
      e.preventDefault();
      holdingOption = false;
      stopRecordingRef.current?.();
    };
    const onWindowBlur = () => {
      if (!holdingOption) return;
      holdingOption = false;
      stopRecordingRef.current?.();
    };

    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    window.addEventListener('blur', onWindowBlur);

    return () => {
      if (suspendReadyFallbackTimer) {
        window.clearTimeout(suspendReadyFallbackTimer);
        suspendReadyFallbackTimer = null;
      }
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', onKeyUp, true);
      window.removeEventListener('blur', onWindowBlur);
      ipcRenderer
        .invoke('hotkey-set-suspended', { suspended: false, reason: 'leave-init-step4-tutorial' })
        .catch(() => undefined);
    };
  }, []);

  return null;
};

/* ─── 子组件1：指引卡片 ─── */
type InstructionCardProps = {
  instruction: string;
  sampleText: string;
};

const InstructionCard: React.FC<InstructionCardProps> = ({ instruction, sampleText }) => (
  <div className={styles.instructionCard}>
    {/* 行1：操作指引 */}
    <div className={styles.instructionRow}>
      <div className={styles.iconContainer}>
        <div className={styles.iconInner}>
          <CopyIcon className={styles.stepIcon} />
        </div>
      </div>
      <p className={styles.instructionText}>{instruction}</p>
    </div>

    <div className={styles.cardDivider} />

    {/* 行2：示例文本 */}
    <div className={styles.instructionRow}>
      <div className={styles.iconContainer}>
        <div className={styles.iconInner}>
          <MicIcon className={styles.stepIcon} />
        </div>
      </div>
      <p className={styles.sampleText}>{sampleText}</p>
    </div>
  </div>
);

/* ─── 子组件2：操作按钮区 ─── */
type TutorialActionsProps = {
  onContinue: () => void;
};

const TutorialActions: React.FC<TutorialActionsProps> = ({ onContinue }) => (
  <div className={styles.tutorialActions}>
    <button className={styles.secondaryBtn} onClick={onContinue} type="button">
      否
    </button>
    <button className={styles.primaryBtn} onClick={onContinue} type="button">
      是，下一步
    </button>
  </div>
);

/* ─── 子组件3：对话框预览（shortcut 子步骤） ─── */
const ChatDialogPreview: React.FC = () => (
  <div className={styles.chatDialog}>
    {/* macOS 窗口控制按钮 */}
    <div className={styles.chatWindowBar}>
      <span className={styles.windowDotRed} />
      <span className={styles.windowDotYellow} />
      <span className={styles.windowDotGreen} />
    </div>

    {/* 聊天消息 */}
    <div className={styles.chatMessageArea}>
      <div className={styles.chatMessageRow}>
        <img src={step4AvatarSrc} alt="" className={styles.chatAvatar} draggable={false} />
        <div className={styles.chatBubble}>我们这周有什么新的安排吗？</div>
      </div>
    </div>

    {/* 输入区域 */}
    <div className={styles.chatInputArea}>
      <textarea className={styles.chatTextarea} placeholder="请语音输入文字内容..." rows={2} />
      <div className={styles.chatSendBtn}>
        <SendIcon />
      </div>
    </div>
  </div>
);

/* ─── 子组件4：右侧预览面板 ─── */
type PreviewPanelProps = {
  previewImage?: string;
  previewContent?: React.ReactNode;
  description: string;
};

const PreviewPanel: React.FC<PreviewPanelProps> = ({
  previewImage,
  previewContent,
  description,
}) => (
  <div className={styles.tutorialRight}>
    <div className={styles.previewArea}>
      {previewContent || (
        <img src={previewImage} alt="" className={styles.previewImage} draggable={false} />
      )}
    </div>
    <p className={styles.previewDesc}>{description}</p>
  </div>
);

/* ─── 主组件 ─── */
const Step4Tutorial: React.FC<Step4TutorialProps> = ({ onNext, onSubStepChange }) => {
  const [subStep, setSubStep] = useState<TutorialSubStep>('shortcut');
  const { label, isMac, isWin } = useHoldToRecordKeyLabel();

  // 向父组件同步子步骤
  useEffect(() => {
    onSubStepChange?.(subStepMap[subStep]);
  }, [subStep, onSubStepChange]);

  // 平台相关的按键描述
  const holdKey = isWin && !isMac ? label : `右${label}`;
  const comboKeys = isWin && !isMac ? 'Ctrl+Win' : 'Fn+空格';

  const handleContinue = () => {
    if (subStep === 'shortcut') {
      setSubStep('rewrite');
    } else if (subStep === 'rewrite') {
      setSubStep('translate');
    } else {
      onNext();
    }
  };

  // 各子步骤配置
  const stepConfig: Record<
    TutorialSubStep,
    {
      title: string;
      instruction: string;
      sampleText: string;
      previewImage?: string;
      previewContent?: React.ReactNode;
      description: string;
    }
  > = {
    shortcut: {
      title: '语音输入功能体验',
      instruction: `点击右侧输入框，长按${holdKey}键（或同时按下${comboKeys}键）唤醒输入法，朗读下方内容，体验具体效果`,
      sampleText: '呃，那个……我们，我们要不这周三，一起，一起开个会吧',
      previewContent: <ChatDialogPreview />,
      description:
        'SenseAudio AI语音输入法将自动识别并剔除无用的语气词、重复等，让口语输出更清晰。',
    },
    rewrite: {
      title: '改写功能体验',
      instruction: `请您选中下方文字，长按${holdKey}键（或同时按下${comboKeys}键）唤醒输入法，直接说：按小红书风格改写`,
      sampleText: '今天工作很忙：1.参加会议 2.撰写材料 3.确认合同',
      previewImage: rewriteWebp,
      description: '风格改写、扩写、缩写……输入法能做的不止是识别，更多能力等你探索。',
    },
    translate: {
      title: '翻译功能体验',
      instruction: `请您选中下方文字，长按${holdKey}键（或同时按下${comboKeys}键）唤醒输入法，直接说：翻译成中文`,
      sampleText: 'The input method supports the recognition of multiple languages worldwide.',
      previewImage: translateWebp,
      description:
        '支持语言：中文（普通话）、粤语、英语、阿拉伯语、德语、俄语、法语、韩语、荷兰语、马来语、葡萄牙语、日语、泰语、土耳其语、乌尔都语、西班牙语、印尼语、意大利语、越南语',
    },
  };

  const config = stepConfig[subStep];

  return (
    <div className={styles.tutorialRoot}>
      <InitTutorialVoiceHost />

      {/* ─── 左侧面板：标题 + 指引卡片 + 按钮 ─── */}
      <div className={styles.tutorialLeft}>
        <h1 className={styles.tutorialTitle}>{config.title}</h1>
        <InstructionCard instruction={config.instruction} sampleText={config.sampleText} />
        <TutorialActions onContinue={handleContinue} />
      </div>

      {/* ─── 右侧面板：预览图 + 描述 ─── */}
      <PreviewPanel
        previewImage={config.previewImage}
        previewContent={config.previewContent}
        description={config.description}
      />
    </div>
  );
};

export default Step4Tutorial;
