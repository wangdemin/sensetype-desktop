import type { MutableRefObject, RefObject } from 'react';
import TranscriptPanel from './TranscriptPanel';
import SummaryPanel from './SummaryPanel';
import styles from './MeetingPanels.module.scss';
import type { Segment, SummaryTopic, Word } from '../detail/types';

type MeetingPanelsProps = {
  mode: 'recording' | 'playback';
  onBack?: () => void;
  hasTranslation: boolean;
  segments: Segment[];
  playbackTranscriptEmptyText?: string;
  liveTranscriptLines: string[];
  liveTranscriptSegments: Segment[];
  activeSegmentId: string | null;
  currentTime: number;
  transcriptPanelRef: RefObject<HTMLDivElement>;
  segmentRefs: MutableRefObject<Record<string, HTMLDivElement | null>>;
  onSeekSegment: (start: number) => void;
  onSeekWord: (word: Word) => void;
  summaryPanelRef: RefObject<HTMLDivElement>;
  liveSummaryTopics: SummaryTopic[];
  summaryTopics: SummaryTopic[];
  playbackSummaryEmptyText?: string;
  onSaveSummary?: (topics: SummaryTopic[]) => Promise<void>;
  isSavingSummary?: boolean;
  saveSummaryError?: string | null;
};

export default function MeetingPanels({
  mode,
  onBack,
  hasTranslation,
  segments,
  playbackTranscriptEmptyText,
  liveTranscriptLines,
  liveTranscriptSegments,
  activeSegmentId,
  currentTime,
  transcriptPanelRef,
  segmentRefs,
  onSeekSegment,
  onSeekWord,
  summaryPanelRef,
  liveSummaryTopics,
  summaryTopics,
  playbackSummaryEmptyText,
  onSaveSummary,
  isSavingSummary,
  saveSummaryError,
}: MeetingPanelsProps) {
  return (
    <div className={styles.body}>
      <TranscriptPanel
        mode={mode}
        onBack={onBack}
        hasTranslation={hasTranslation}
        segments={segments}
        playbackEmptyText={playbackTranscriptEmptyText}
        liveTranscriptLines={liveTranscriptLines}
        liveTranscriptSegments={liveTranscriptSegments}
        activeSegmentId={activeSegmentId}
        currentTime={currentTime}
        transcriptPanelRef={transcriptPanelRef}
        segmentRefs={segmentRefs}
        onSeekSegment={onSeekSegment}
        onSeekWord={onSeekWord}
      />
      <SummaryPanel
        mode={mode}
        summaryPanelRef={summaryPanelRef}
        liveSummaryTopics={liveSummaryTopics}
        summaryTopics={summaryTopics}
        emptyText={playbackSummaryEmptyText}
        onSaveSummary={onSaveSummary}
        isSavingSummary={isSavingSummary}
        saveSummaryError={saveSummaryError}
      />
    </div>
  );
}
