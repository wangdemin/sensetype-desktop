import { memo, useEffect, useMemo, useState, type MutableRefObject, type RefObject } from 'react';
import { BackArrowIcon, SparkleIcon } from './MeetingDetailIcons';
import styles from './MeetingPanels.module.scss';
import { formatTime } from '../detail/utils';
import type { Segment, Word } from '../detail/types';

type TranscriptPanelProps = {
  mode: 'recording' | 'playback';
  onBack?: () => void;
  hasTranslation: boolean;
  segments: Segment[];
  playbackEmptyText?: string;
  liveTranscriptLines: string[];
  liveTranscriptSegments: Segment[];
  activeSegmentId: string | null;
  currentTime: number;
  transcriptPanelRef: RefObject<HTMLDivElement>;
  segmentRefs: MutableRefObject<Record<string, HTMLDivElement | null>>;
  onSeekSegment: (start: number) => void;
  onSeekWord: (word: Word) => void;
};

type TranscriptSegmentRowProps = {
  mode: 'recording' | 'playback';
  segment: Segment;
  hasTranslation: boolean;
  isActive: boolean;
  activeTime: number;
  segmentRefs: MutableRefObject<Record<string, HTMLDivElement | null>>;
  onSeekSegment: (start: number) => void;
  onSeekWord: (word: Word) => void;
};

const TRANSCRIPT_RECORDING_LOADING_STEPS = ['正在识别发言内容', '正在生成实时文字记录'];

const TranscriptSegmentRow = memo(function TranscriptSegmentRow({
  mode,
  segment,
  hasTranslation,
  isActive,
  activeTime,
  segmentRefs,
  onSeekSegment,
  onSeekWord,
}: TranscriptSegmentRowProps) {
  const wordsContent = useMemo(() => {
    if (mode !== 'playback') return segment.text;
    return segment.words.map((word, wi) => {
      const wordActive = isActive && activeTime >= word.start && activeTime < word.end;
      return (
        <span
          key={`${word.start}-${word.end}-${wi}`}
          className={`${styles.word} ${wordActive ? styles.wordActive : ''}`}
          data-export-highlight={wordActive ? 'true' : undefined}
          onClick={(e) => {
            e.stopPropagation();
            onSeekWord(word);
          }}
        >
          {word.text}
        </span>
      );
    });
  }, [mode, segment.text, segment.words, isActive, activeTime, onSeekWord]);

  return (
    <div
      ref={(el) => {
        segmentRefs.current[segment.id] = el;
      }}
      className={`${styles.segment} ${mode === 'playback' ? styles.segmentClickable : ''} ${isActive ? styles.segmentActive : ''}`}
      onClick={() => {
        if (mode === 'playback') onSeekSegment(segment.start);
      }}
    >
      <div className={styles.segmentSource}>
        {mode === 'playback' && (
          <div className={styles.segmentMeta}>
            <span className={styles.segmentTime}>{formatTime(segment.start)}</span>
          </div>
        )}

        <p className={styles.segmentText}>{wordsContent}</p>
      </div>

      {hasTranslation && segment.translation && (
        <div className={styles.translationBubble}>
          <span className={styles.translationText}>{segment.translation}</span>
        </div>
      )}
    </div>
  );
});
TranscriptSegmentRow.displayName = 'TranscriptSegmentRow';

export default function TranscriptPanel({
  mode,
  onBack,
  hasTranslation,
  segments,
  playbackEmptyText,
  liveTranscriptLines,
  liveTranscriptSegments,
  activeSegmentId,
  currentTime,
  transcriptPanelRef,
  segmentRefs,
  onSeekSegment,
  onSeekWord,
}: TranscriptPanelProps) {
  const displaySegments = useMemo(() => {
    if (mode !== 'recording') return segments;
    if (liveTranscriptSegments.length > 0) return liveTranscriptSegments;
    return liveTranscriptLines.map((line, idx) => ({
      id: `live-${idx}`,
      start: 0,
      end: 0,
      words: [] as Word[],
      text: line,
      translation: '',
      speakerId: 'live',
    }));
  }, [mode, segments, liveTranscriptSegments, liveTranscriptLines]);
  const [loadingStep, setLoadingStep] = useState(0);
  const showRecordingLoading = mode === 'recording';
  const recordingLoadingText = TRANSCRIPT_RECORDING_LOADING_STEPS[loadingStep];
  const showRecordingEmpty = mode === 'recording' && displaySegments.length === 0;

  useEffect(() => {
    if (!showRecordingLoading) {
      setLoadingStep(0);
      return;
    }
    const timer = window.setInterval(() => {
      setLoadingStep((prev) => (prev + 1) % TRANSCRIPT_RECORDING_LOADING_STEPS.length);
    }, 1600);
    return () => window.clearInterval(timer);
  }, [showRecordingLoading]);

  return (
    <div className={styles.transcriptPanel} ref={transcriptPanelRef}>
      <div className={styles.panelHeader}>
        <div className={styles.panelTitleGroup}>
          {onBack && (
            <button
              className={styles.backBtn}
              onClick={onBack}
              title="返回"
              data-export-ignore="true"
            >
              <BackArrowIcon />
            </button>
          )}
          <SparkleIcon />
          <span className={styles.panelTitle}>文字记录</span>
        </div>
      </div>

      <div
        className={styles.segments}
        data-transcript-scroll-container="true"
      >
        {displaySegments.map((seg) => {
          const isActive = seg.id === activeSegmentId;
          return (
            <TranscriptSegmentRow
              key={seg.id}
              mode={mode}
              segment={seg}
              hasTranslation={hasTranslation}
              isActive={isActive}
              activeTime={isActive ? currentTime : -1}
              segmentRefs={segmentRefs}
              onSeekSegment={onSeekSegment}
              onSeekWord={onSeekWord}
            />
          );
        })}

        {showRecordingEmpty && (
          <div className={`${styles.segment} ${styles.segmentEmpty}`}>
            <p className={styles.segmentText}>正在识别中，稍后会显示实时文字记录</p>
          </div>
        )}

        {mode === 'playback' && displaySegments.length === 0 && (
          <div className={`${styles.segment} ${styles.segmentEmpty}`}>
            <p className={styles.segmentText}>{playbackEmptyText || '暂无文字记录'}</p>
          </div>
        )}

      </div>
      {mode === 'recording' && (
        <div className={styles.panelBottomStatus} data-export-ignore="true">
          <div className={styles.panelLoadingBadge}>
            <span className={styles.panelLoadingText}>{recordingLoadingText}</span>
            <span className={styles.aiSummaryLoadingDots} aria-hidden="true">
              <span className={styles.aiSummaryLoadingDot} />
              <span className={styles.aiSummaryLoadingDot} />
              <span className={styles.aiSummaryLoadingDot} />
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
