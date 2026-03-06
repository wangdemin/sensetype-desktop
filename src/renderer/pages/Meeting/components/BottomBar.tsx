import type { ChangeEvent } from 'react';
import type { RecordingActions } from '../hooks/useRecording';
import { PauseIcon, PlayIcon } from './MeetingDetailIcons';
import styles from './BottomBar.module.scss';
import { formatTime } from '../detail/utils';

function formatSpeed(value: number): string {
  if (value === Math.floor(value) && value !== 1) return `${value}`;
  return value.toFixed(1);
}

type BottomBarProps = {
  mode: 'recording' | 'playback';
  recordTime: number;
  isRecordPaused: boolean;
  onStopRecording?: () => void;
  recordingActions?: RecordingActions;
  isPlaying: boolean;
  speed: number;
  showSpeedMenu: boolean;
  speedOptions: number[];
  currentTime: number;
  duration: number;
  progress: number;
  onTogglePlay: () => void;
  onToggleSpeedMenu: () => void;
  onSelectSpeed: (speed: number) => void;
  onSeek: (e: ChangeEvent<HTMLInputElement>) => void;
  onSeekStart: () => void;
  onOpenExport: () => void;
};

export default function BottomBar({
  mode,
  recordTime,
  isRecordPaused,
  onStopRecording,
  recordingActions,
  isPlaying,
  speed,
  showSpeedMenu,
  speedOptions,
  currentTime,
  duration,
  progress,
  onTogglePlay,
  onToggleSpeedMenu,
  onSelectSpeed,
  onSeek,
  onSeekStart,
  onOpenExport,
}: BottomBarProps) {
  if (mode === 'recording') {
    return (
      <div className={styles.minibar}>
        <div className={styles.minibarTimePill}>{formatTime(recordTime)}</div>

        <button
          className={styles.minibarPlayPill}
          onClick={() => {
            void recordingActions?.togglePause();
          }}
          title={isRecordPaused ? '继续录制' : '暂停录制'}
        >
          {isRecordPaused ? <PlayIcon /> : <PauseIcon />}
        </button>

        <button className={styles.minibarEndPill} onClick={onStopRecording}>
          结束录制
        </button>
      </div>
    );
  }

  return (
    <div className={styles.player}>
      <button
        className={styles.playPill}
        onClick={onTogglePlay}
        title={isPlaying ? '暂停' : '播放'}
      >
        {isPlaying ? <PauseIcon /> : <PlayIcon />}
      </button>

      <div className={styles.speedWrap}>
        <button className={styles.speedBtn} onClick={onToggleSpeedMenu}>
          {formatSpeed(speed)}×
        </button>
        {showSpeedMenu && (
          <>
            <div className={styles.speedOverlay} onClick={onToggleSpeedMenu} />
            <div className={styles.speedMenu}>
              {speedOptions.map((option) => (
                <button
                  key={option}
                  className={`${styles.speedOption} ${speed === option ? styles.speedOptionActive : ''}`}
                  onClick={() => onSelectSpeed(option)}
                >
                  {formatSpeed(option)}×
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      <span className={styles.timeLabel}>{formatTime(currentTime)}</span>

      <div className={styles.progressWrap}>
        <div className={styles.progressTrack}>
          <div className={styles.progressFill} style={{ width: `${progress}%` }} />
        </div>
        <div className={styles.progressThumb} style={{ left: `${progress}%` }} />
        <input
          type="range"
          className={styles.progressInput}
          min={0}
          max={duration}
          step={0.1}
          value={currentTime}
          onChange={onSeek}
          onMouseDown={onSeekStart}
        />
      </div>

      <span className={styles.timeLabel}>{formatTime(duration)}</span>

      <button className={styles.exportBtn} onClick={onOpenExport}>
        导出
      </button>
    </div>
  );
}
