import { useEffect, useRef } from 'react';
import styles from '../../common.module.scss';
import pageStyles from '../index.module.scss';
import panelStyles from '../components/MeetingPanels.module.scss';
import MeetingPanels from '../components/MeetingPanels';
import BottomBar from '../components/BottomBar';
import type { RecordingActions, RecordingState } from '../hooks/useRecording';
import { parseSummaryTopics } from '../detail/utils';

type RecordingFlowPageProps = {
  onBack: () => void;
  onStopRecording: () => void;
  hasTranslation: boolean;
  recordingState: RecordingState;
  recordingActions: RecordingActions;
};

const RecordingFlowPage = ({
  onBack,
  onStopRecording,
  hasTranslation,
  recordingState,
  recordingActions,
}: RecordingFlowPageProps) => {
  const liveTranscript = String(recordingState?.transcript || '').trim();
  const liveTranscriptLines = liveTranscript
    ? liveTranscript
        .split('\n')
        .map((x) => x.trim())
        .filter(Boolean)
    : [];
  const liveTranscriptSegments = Array.isArray(recordingState?.liveTranscriptSegments)
    ? recordingState.liveTranscriptSegments
    : [];
  const liveSummaryTopics = parseSummaryTopics(
    recordingState?.rawFormatResult,
    recordingState?.formattedText,
  );

  const transcriptPanelRef = useRef<HTMLDivElement>(null!);
  const summaryPanelRef = useRef<HTMLDivElement>(null!);
  const segmentRefs = useRef<Record<string, HTMLDivElement | null>>({});

  useEffect(() => {
    const transcriptPanel = transcriptPanelRef.current;
    if (!transcriptPanel) return;

    const segmentsEl = transcriptPanel.querySelector<HTMLDivElement>(`.${panelStyles.segments}`);
    if (!segmentsEl) return;

    segmentsEl.scrollTop = segmentsEl.scrollHeight;
  }, [liveTranscript]);

  return (
    <div className={`${styles.page} ${pageStyles.audioDetail}`}>
      <div className={pageStyles.audioDetailContent}>
        <MeetingPanels
          mode="recording"
          onBack={onBack}
          hasTranslation={hasTranslation}
          segments={[]}
          liveTranscriptLines={liveTranscriptLines}
          liveTranscriptSegments={liveTranscriptSegments}
          activeSegmentId={null}
          currentTime={0}
          transcriptPanelRef={transcriptPanelRef}
          segmentRefs={segmentRefs}
          onSeekSegment={() => undefined}
          onSeekWord={() => undefined}
          summaryPanelRef={summaryPanelRef}
          liveSummaryTopics={liveSummaryTopics}
          summaryTopics={[]}
        />

        <BottomBar
          mode="recording"
          recordTime={recordingState?.recordTime ?? 0}
          isRecordPaused={recordingState?.isRecordPaused ?? false}
          onStopRecording={onStopRecording}
          recordingActions={recordingActions}
          isPlaying={false}
          speed={1}
          showSpeedMenu={false}
          speedOptions={[0.5, 1, 1.5, 2]}
          currentTime={0}
          duration={1}
          progress={0}
          onTogglePlay={() => undefined}
          onToggleSpeedMenu={() => undefined}
          onSelectSpeed={() => undefined}
          onSeek={() => undefined}
          onSeekStart={() => undefined}
          onOpenExport={() => undefined}
        />
      </div>
    </div>
  );
};

export default RecordingFlowPage;
