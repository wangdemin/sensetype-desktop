import React, { useState, useEffect, useRef, useCallback } from 'react';
import { getToken } from '@/utils/auth';
import Steps, { type StepItem } from '@/renderer/components/Steps';
import InitHeader from '@/renderer/components/InitHeader';
import LeftArrowIcon from '@/assets/icons/left-arrow.svg?react';
import StepRightBg from '@/assets/webp/step-right-bg.webp';
import Step1Login from './steps/Step1Login';
import Step2Permission from './steps/Step2Permission';
import Step3Settings from './steps/Step3Settings';
import Step4Tutorial from './steps/Step4Tutorial';
import Step5Complete from './steps/Step5Complete';
import styles from './InitSteps.module.scss';

const stepsConfig: StepItem[] = [
  { title: '登录', description: '登录账号' },
  { title: '权限', description: '授予必要权限' },
  { title: '设置', description: '应用设置' },
  { title: '教程', description: '快速了解' },
  { title: '完成', description: '开始使用' },
];

/**
 * 9 小步映射（全局）:
 *   1 = 登录
 *   2 = 权限（Windows 跳过，进度从 1→3）
 *   3 = 设置 - 麦克风测试
 *   4 = 设置 - 组合键测试
 *   5 = 设置 - 单键测试
 *   6 = 教程 - 快捷键试用
 *   7 = 教程 - 翻译功能
 *   8 = 教程 - 改写功能
 *   9 = 完成
 */
const TOTAL_SUB_STEPS = 9;

const INIT_STEPS_COMPLETED_KEY = 'sensetype_init_steps_completed';

const getInitStepsCompleted = () => {
  try {
    return localStorage.getItem(INIT_STEPS_COMPLETED_KEY) === 'true';
  } catch {
    return false;
  }
};

const InitSteps: React.FC = () => {
  const [currentStep, setCurrentStep] = useState(1);
  const [isCompleted, setIsCompleted] = useState(() => getInitStepsCompleted());
  const autoCompletedRef = useRef(false);

  // 子步骤追踪（仅 Step3 / Step4 有多个子步骤）
  const [step3Sub, setStep3Sub] = useState(0); // 0=mic, 1=chord, 2=hold
  const [step4Sub, setStep4Sub] = useState(0); // 0=shortcut, 1=rewrite, 2=translate

  // 计算全局小步（1-9）
  const computeGlobalSubStep = useCallback(() => {
    switch (currentStep) {
      case 1:
        return 1;
      case 2:
        return 2;
      case 3:
        return 3 + step3Sub; // 3, 4, 5
      case 4:
        return 6 + step4Sub; // 6, 7, 8
      case 5:
        return 9;
      default:
        return 1;
    }
  }, [currentStep, step3Sub, step4Sub]);

  const globalSubStep = computeGlobalSubStep();
  const progress = (globalSubStep / TOTAL_SUB_STEPS) * 100;

  // 平台检测
  const w = window as Window & {
    sensetype?: { isWindows?: () => boolean; isMacOs?: () => boolean };
  };
  const isWindows = w?.sensetype?.isWindows?.() ?? /Windows/i.test(navigator.userAgent);
  const isMac = w?.sensetype?.isMacOs?.() ?? false;

  // Mac 设置页：若权限已全部授予，则不显示返回按钮（因为返回也进不到权限页）
  const [macPermissionsGranted, setMacPermissionsGranted] = useState(false);
  useEffect(() => {
    if (!isMac || currentStep !== 3) return;
    const ipc = (
      window as Window & {
        electronAPI?: {
          ipcRenderer?: { invoke?: (ch: string, ...a: unknown[]) => Promise<unknown> };
        };
      }
    )?.electronAPI?.ipcRenderer;
    const invoke = ipc?.invoke;
    if (!invoke) return;
    let stopped = false;
    const check = async () => {
      try {
        const [accRaw, micRaw] = await Promise.all([
          invoke('check-accessibility-permission'),
          invoke('check-microphone-permission'),
        ]);
        if (stopped) return;
        const acc =
          accRaw &&
          typeof (accRaw as { granted?: boolean }).granted === 'boolean' &&
          (accRaw as { granted: boolean }).granted === true;
        const mic =
          micRaw &&
          typeof (micRaw as { granted?: boolean }).granted === 'boolean' &&
          (micRaw as { granted: boolean }).granted === true;
        setMacPermissionsGranted(acc && mic);
      } catch {
        if (!stopped) setMacPermissionsGranted(false);
      }
    };
    void check();
    const timer = window.setInterval(check, 800);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [isMac, currentStep]);

  // 初始化引导期间：抑制 AuthBootstrap 在 /login 上的"自动进首页"跳转
  useEffect(() => {
    try {
      (window as any).__sensetype_init_steps_in_progress__ = !isCompleted;
    } catch {
      // ignore
    }
    return () => {
      try {
        (window as any).__sensetype_init_steps_in_progress__ = false;
      } catch {
        // ignore
      }
    };
  }, [isCompleted]);

  // 引导页期间：锁定窗口大小，禁止缩放/最大化/全屏
  useEffect(() => {
    try {
      const ipc = (
        window as Window & {
          electronAPI?: { ipcRenderer?: { send?: (ch: string, ...a: unknown[]) => void } };
        }
      )?.electronAPI?.ipcRenderer;
      ipc?.send?.('window-set-resizable', false);
    } catch {
      // ignore
    }
    return () => {
      try {
        const ipc = (
          window as Window & {
            electronAPI?: { ipcRenderer?: { send?: (ch: string, ...a: unknown[]) => void } };
          }
        )?.electronAPI?.ipcRenderer;
        ipc?.send?.('window-set-resizable', true);
      } catch {
        // ignore
      }
    };
  }, []);

  // 防止在完成所有步骤前被AuthBootstrap自动跳转
  useEffect(() => {
    const handleHashChange = () => {
      if (!isCompleted && currentStep < 5) {
        const hash = window.location.hash;
        if (hash && hash !== '#/login' && !hash.startsWith('#/login')) {
          window.location.hash = '#/login';
        }
      }
    };
    window.addEventListener('hashchange', handleHashChange);
    handleHashChange();
    return () => {
      window.removeEventListener('hashchange', handleHashChange);
    };
  }, [currentStep, isCompleted]);

  // 监听token变化，决定当前步骤
  useEffect(() => {
    const checkToken = () => {
      const token = getToken();
      const tokenExists = !!token;
      const initAlreadyCompleted = getInitStepsCompleted();

      if (!tokenExists && currentStep > 1) {
        setCurrentStep(1);
      } else if (tokenExists && currentStep === 1) {
        if (initAlreadyCompleted && !autoCompletedRef.current) {
          handleComplete();
          return;
        }
        setCurrentStep(isWindows ? 3 : 2);
      } else if (tokenExists && initAlreadyCompleted && !autoCompletedRef.current) {
        handleComplete();
      }
    };

    checkToken();
    const interval = setInterval(checkToken, 500);
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'Authorization') {
        checkToken();
      }
    };
    window.addEventListener('storage', handleStorageChange);
    return () => {
      clearInterval(interval);
      window.removeEventListener('storage', handleStorageChange);
    };
  }, [currentStep]);

  const handleNext = () => {
    if (currentStep < stepsConfig.length) {
      // 切换大步骤时重置子步骤
      if (currentStep === 3) setStep4Sub(0);
      setCurrentStep(currentStep + 1);
    }
  };

  const handlePrev = () => {
    if (currentStep > 1) {
      if (isWindows && currentStep === 3) {
        setCurrentStep(1);
      } else {
        setCurrentStep(currentStep - 1);
      }
    }
  };

  const handleComplete = () => {
    autoCompletedRef.current = true;
    setIsCompleted(true);
    try {
      localStorage.setItem(INIT_STEPS_COMPLETED_KEY, 'true');
    } catch {
      // ignore
    }
    window.location.hash = '#/';
    try {
      const ipcRenderer = (
        window as Window & {
          electronAPI?: { ipcRenderer?: { send?: (channel: string, ...args: unknown[]) => void } };
        }
      )?.electronAPI?.ipcRenderer;
      if (ipcRenderer?.send) {
        ipcRenderer.send('login-success');
      }
    } catch {
      // ignore
    }
  };

  const renderStepContent = () => {
    switch (currentStep) {
      case 1:
        return <Step1Login onNext={handleNext} />;
      case 2:
        return <Step2Permission onNext={handleNext} />;
      case 3:
        return <Step3Settings onNext={handleNext} onSubStepChange={setStep3Sub} />;
      case 4:
        return <Step4Tutorial onNext={handleNext} onSubStepChange={setStep4Sub} />;
      case 5:
        return <Step5Complete onComplete={handleComplete} />;
      default:
        return <Step1Login onNext={handleNext} />;
    }
  };

  // ─── 渲染 ───
  const stepsBar = <Steps compact current={currentStep} steps={stepsConfig} />;
  const isPermissionStep = currentStep === 2;
  const isSettingsStep = currentStep === 3;
  const shouldHideReturnBtn =
    isPermissionStep ||
    (isWindows && isSettingsStep) ||
    (isMac && isSettingsStep && macPermissionsGranted);
  const showReturnBtn = !shouldHideReturnBtn && currentStep > 1;

  return (
    <div className={styles.initStepsContainer}>
      {/* ─── 标题栏：Steps 居中 ─── */}
      {isMac ? (
        <div className={styles.macHeader}>{stepsBar}</div>
      ) : (
        <InitHeader>{stepsBar}</InitHeader>
      )}

      {/* ─── 进度条（9 小步） ─── */}
      <div className={styles.progressBar}>
        <div className={styles.progressFill} style={{ width: `${progress}%` }} />
      </div>

      {/* ─── 内容区域 ─── */}
      <div className={styles.contentWrapper}>
        {showReturnBtn && (
          <div className={styles.returnBtnAnchor}>
            <button className={styles.returnBtn} onClick={handlePrev}>
              <LeftArrowIcon className={styles.leftArrowIcon} />
              <span>返回</span>
            </button>
          </div>
        )}
        <div className={styles.content}>
          <img src={StepRightBg} alt="step-right-bg" className={styles.stepRightBg} />
          <div className={styles.stepContent}>{renderStepContent()}</div>
        </div>
      </div>
    </div>
  );
};

export default InitSteps;
