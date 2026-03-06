import React, { useState, useEffect } from 'react';
import { getToken } from '@/utils/auth';
import Steps, { type StepItem } from '@/renderer/components/Steps';
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

const InitSteps: React.FC = () => {
  const [currentStep, setCurrentStep] = useState(1);
  const [isCompleted, setIsCompleted] = useState(false);

  // 初始化引导期间：抑制 AuthBootstrap 在 /login 上的“自动进首页”跳转
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

  // 检测是否是Windows系统
  const w = window as Window & { sensetype?: { isWindows?: () => boolean } };
  const isWindows = w?.sensetype?.isWindows?.() ?? /Windows/i.test(navigator.userAgent);

  // 防止在完成所有步骤前被AuthBootstrap自动跳转
  useEffect(() => {
    const handleHashChange = () => {
      // 如果还未完成所有步骤，且hash不是/login，则保持stay在/login
      if (!isCompleted && currentStep < 5) {
        const hash = window.location.hash;
        if (hash && hash !== '#/login' && !hash.startsWith('#/login')) {
          window.location.hash = '#/login';
        }
      }
    };

    // 监听hash变化
    window.addEventListener('hashchange', handleHashChange);

    // 初始检查
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

      // 如果没有token，保持在步骤1（登录）
      if (!tokenExists && currentStep > 1) {
        setCurrentStep(1);
      }
      // 如果有token且还在步骤1
      else if (tokenExists && currentStep === 1) {
        // Windows系统：跳过权限步骤，直接进入设置步骤（步骤3）
        // macOS系统：进入权限步骤（步骤2）
        setCurrentStep(isWindows ? 3 : 2);
      }
    };

    // 初始检查
    checkToken();

    // 监听token变化（通过localStorage事件或轮询）
    const interval = setInterval(checkToken, 500);

    // 监听localStorage变化（跨标签页同步）
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
      setCurrentStep(currentStep + 1);
    }
  };

  const handlePrev = () => {
    if (currentStep > 1) {
      // Windows系统：从设置步骤（步骤3）返回时，直接返回到登录步骤（步骤1），跳过权限步骤（步骤2）
      if (isWindows && currentStep === 3) {
        setCurrentStep(1);
      } else {
        setCurrentStep(currentStep - 1);
      }
    }
  };

  const handleComplete = () => {
    // 标记为已完成，允许跳转
    setIsCompleted(true);
    // 跳转到主窗口
    window.location.hash = '#/';
    // 通知主进程登录成功
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
        return <Step3Settings onNext={handleNext} />;
      case 4:
        return <Step4Tutorial onNext={handleNext} />;
      case 5:
        return <Step5Complete onComplete={handleComplete} />;
      default:
        return <Step1Login onNext={handleNext} />;
    }
  };

  return (
    <div className={styles.initStepsContainer}>
      <div className={styles.stepsWrapper}>
        <Steps current={currentStep} steps={stepsConfig} />
      </div>
      <div className={styles.contentWrapper}>{renderStepContent()}</div>
    </div>
  );
};

export default InitSteps;
