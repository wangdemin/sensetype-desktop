import { useState } from 'react';
import pageStyles from '../index.module.scss';
import { DropdownSelect } from '@/renderer/components/DropdownSelect';
import CloseXIcon from '@/assets/icons/meeting/close-x.svg?react';
import { MIC_OPTIONS, LANGUAGE_OPTIONS } from '../constants';
import type { MicOption } from '../hooks/useRecording';

export type RecordConfigDialogProps = {
  onCancel: () => void;
  onConfirm: (config: {
    micOption: MicOption;
    hasTranslation: boolean;
    targetLanguage: string;
  }) => void;
  isStarting?: boolean;
};

export default function RecordConfigDialog({ onCancel, onConfirm, isStarting }: RecordConfigDialogProps) {
  const [micOption, setMicOption] = useState<MicOption>('inner+outer');
  const [needTranslation, setNeedTranslation] = useState(true);
  const [targetLanguage, setTargetLanguage] = useState('en');

  return (
    <div className={pageStyles.dialogOverlay} onClick={onCancel}>
      <div className={pageStyles.dialogCard} onClick={(e) => e.stopPropagation()}>
        <button className={pageStyles.dialogClose} onClick={onCancel}>
          <CloseXIcon />
        </button>

        <div className={pageStyles.configBody}>
          <div className={pageStyles.configContent}>
            <h2 className={pageStyles.dialogTitle}>录制配置</h2>

            <div className={pageStyles.configSections}>
              <div className={pageStyles.configSection}>
                <label className={pageStyles.configLabel}>音频输入设置</label>
                <div className={pageStyles.selectWrap}>
                  <DropdownSelect
                    className={pageStyles.dropdownSelectRoot}
                    value={micOption}
                    options={MIC_OPTIONS}
                    onChange={(v) => setMicOption(v as MicOption)}
                    ariaLabel="音频输入设置"
                    title="选择音频输入"
                    triggerClassName={pageStyles.hotkeyPill}
                  />
                </div>
              </div>

              <div className={pageStyles.configSection}>
                <label className={pageStyles.configLabel}>是否需要翻译？</label>
                <div className={pageStyles.toggleGroup}>
                  <button
                    className={`${pageStyles.toggleBtn} ${needTranslation ? pageStyles.toggleBtnActive : ''}`}
                    onClick={() => setNeedTranslation(true)}
                  >
                    是
                  </button>
                  <button
                    className={`${pageStyles.toggleBtn} ${!needTranslation ? pageStyles.toggleBtnActive : ''}`}
                    onClick={() => setNeedTranslation(false)}
                  >
                    否
                  </button>
                </div>
              </div>

              {needTranslation && (
                <div className={pageStyles.configSection}>
                  <label className={pageStyles.configLabel}>翻译语言</label>
                  <div className={pageStyles.selectWrap}>
                    <DropdownSelect
                      className={pageStyles.dropdownSelectRoot}
                      value={targetLanguage}
                      options={LANGUAGE_OPTIONS}
                      onChange={setTargetLanguage}
                      ariaLabel="翻译语言"
                      title="选择翻译语言"
                      triggerClassName={pageStyles.hotkeyPill}
                    />
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className={pageStyles.dialogActions}>
            <button className={pageStyles.dialogBtnOutline} onClick={onCancel}>
              取消
            </button>
            <button
              className={pageStyles.dialogBtnDark}
              disabled={isStarting}
              onClick={() =>
                onConfirm({
                  micOption,
                  hasTranslation: needTranslation,
                  targetLanguage: needTranslation ? targetLanguage : '',
                })
              }
            >
              {isStarting ? '正在启动…' : '开始录制'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
