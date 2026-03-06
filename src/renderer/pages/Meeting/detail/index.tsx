import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import styles from '../../common.module.scss';
import pageStyles from '../index.module.scss';
import type { RecordingState, RecordingActions } from '../hooks/useRecording';
import MeetingPanels from '../components/MeetingPanels';
import BottomBar from '../components/BottomBar';
import ExportDialog from '../components/ExportDialog';
import { getMeetingDetail, updateMeetingSummary } from '@/services/meeting';
import type { MeetingDetailResponse, MeetingSummary } from '@/services/meeting/types';
import { mapMeetingDetailToPlaybackData, parseSummaryTopics } from './utils';
import { useMeetingPlayback } from '../hooks/useMeetingPlayback';
import { useMeetingExport } from '../hooks/useMeetingExport';
import type { Segment, SummaryTopic } from './types';

// ─────────────────────────────────────────────────────────────────────────────
// 组件
// ─────────────────────────────────────────────────────────────────────────────
type AudioDetailPageProps = {
  meetingId?: string;
  onBack?: () => void;
  mode?: 'recording' | 'playback';
  hasTranslation?: boolean;
  onStopRecording?: () => void;
  recordingState?: RecordingState;
  recordingActions?: RecordingActions;
};

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function normalizeMeetingSummary(summary: MeetingSummary | undefined): MeetingSummary {
  if (!isObjectRecord(summary)) return {};
  const { summary: nestedSummary, ...rest } = summary as MeetingSummary & { summary?: unknown };
  if (!isObjectRecord(nestedSummary)) {
    return rest;
  }
  return {
    ...(nestedSummary as MeetingSummary),
    ...rest,
  };
}

const AudioDetailPage = ({
  meetingId,
  onBack,
  mode = 'playback',
  hasTranslation = true,
  onStopRecording,
  recordingState,
  recordingActions: recActions,
}: AudioDetailPageProps) => {
  const [isSummarySaving, setIsSummarySaving] = useState(false);
  const [summarySaveError, setSummarySaveError] = useState<string | null>(null);
  const [meetingDetail, setMeetingDetail] = useState<MeetingDetailResponse | null>(null);
  const [isDetailLoading, setIsDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const autoScrollRafRef = useRef<number | null>(null);
  const lastAutoScrollAtRef = useRef(0);
  const recordTime = recordingState?.recordTime ?? 0;
  const isRecordPaused = recordingState?.isRecordPaused ?? false;
  const liveTranscript = useMemo(() => {
    if (mode !== 'recording') return '';
    return String(recordingState?.transcript || '').trim();
  }, [mode, recordingState?.transcript]);
  const liveSummaryTopics = useMemo<SummaryTopic[]>(() => {
    if (mode !== 'recording') return [];
    return parseSummaryTopics(recordingState?.rawFormatResult, recordingState?.formattedText);
  }, [mode, recordingState?.rawFormatResult, recordingState?.formattedText]);
  const liveTranscriptLines = useMemo(() => {
    if (mode !== 'recording' || !liveTranscript) return [];
    return liveTranscript
      .split('\n')
      .map((x) => x.trim())
      .filter(Boolean);
  }, [mode, liveTranscript]);
  const liveTranscriptSegments = useMemo<Segment[]>(() => {
    if (mode !== 'recording') return [];
    return Array.isArray(recordingState?.liveTranscriptSegments)
      ? recordingState.liveTranscriptSegments
      : [];
  }, [mode, recordingState?.liveTranscriptSegments]);

  const segmentRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const transcriptPanelRef = useRef<HTMLDivElement>(null!);
  const summaryPanelRef = useRef<HTMLDivElement>(null!);
  const playbackData = useMemo(
    () => mapMeetingDetailToPlaybackData(meetingDetail),
    [meetingDetail],
  );
  const resolvedHasTranslation = useMemo(() => {
    if (mode !== 'playback') return hasTranslation;
    if (hasTranslation) return true;
    return playbackData.segments.some((segment) => Boolean(segment.translation?.trim()));
  }, [mode, hasTranslation, playbackData.segments]);

  useEffect(() => {
    setSummarySaveError(null);
    if (mode !== 'playback' || !meetingId) {
      setMeetingDetail(null);
      setDetailError(null);
      setIsDetailLoading(false);
      return;
    }

    let cancelled = false;
    setIsDetailLoading(true);
    setDetailError(null);
    void getMeetingDetail(meetingId)
      .then((resp) => {
        if (cancelled) return;
        if (resp.success) {
          console.group(resp.data);
          setMeetingDetail({
            ...resp.data,
            summary: normalizeMeetingSummary(resp.data.summary),
          });
          setDetailError(null);
          return;
        }
        setMeetingDetail(null);
        setDetailError(resp.error?.message || '会议详情加载失败');
      })
      .catch((error) => {
        if (cancelled) return;
        console.error('加载会议详情失败:', error);
        setMeetingDetail(null);
        setDetailError('会议详情加载失败，请稍后重试');
      })
      .finally(() => {
        if (cancelled) return;
        setIsDetailLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [mode, meetingId]);

  const handleSaveSummary = useCallback(async (topics: SummaryTopic[]) => {
    if (mode !== 'playback' || !meetingId) return;
    const normalizedTopics = topics
      .map((topic) => ({
        header: topic.header.trim() || '会议要点',
        items: topic.items.map((item) => item.trim()).filter(Boolean),
      }))
      .filter((topic) => topic.header || topic.items.length > 0);
    if (normalizedTopics.length === 0) {
      setSummarySaveError('会议总结内容为空，无法保存');
      return;
    }

    const baseSummary = normalizeMeetingSummary(meetingDetail?.summary);
    const nextSummary: MeetingSummary = {
      ...baseSummary,
      sections: normalizedTopics.map((topic) => ({
        heading: topic.header,
        items: topic.items,
      })),
    };

    setIsSummarySaving(true);
    setSummarySaveError(null);
    try {
      const resp = await updateMeetingSummary(meetingId, nextSummary);
      if (!resp.success) {
        throw new Error(resp.error?.message || '会议总结保存失败');
      }
      setMeetingDetail((prev) => (prev ? { ...prev, summary: nextSummary } : prev));
    } catch (error) {
      console.error('保存会议总结失败:', error);
      setSummarySaveError(error instanceof Error ? error.message : '会议总结保存失败，请稍后重试');
      throw error;
    } finally {
      setIsSummarySaving(false);
    }
  }, [mode, meetingId, meetingDetail?.summary]);

  const playbackTranscriptEmptyText = useMemo(() => {
    if (mode !== 'playback') return undefined;
    if (isDetailLoading) return '会议详情加载中...';
    if (detailError) return detailError;
    if (playbackData.segments.length === 0) return '暂无文字记录';
    return undefined;
  }, [mode, isDetailLoading, detailError, playbackData.segments.length]);

  const playbackSummaryEmptyText = useMemo(() => {
    if (mode !== 'playback') return undefined;
    if (isDetailLoading) return '会议总结加载中...';
    if (detailError) return '会议总结加载失败';
    if (playbackData.summaryTopics.length === 0) return '暂无会议总结';
    return undefined;
  }, [mode, isDetailLoading, detailError, playbackData.summaryTopics.length]);

  const playback = useMeetingPlayback({
    mode,
    duration: playbackData.duration,
    segments: playbackData.segments,
    audioUrl: mode === 'playback' ? meetingDetail?.audio_file_url : undefined,
  });
  const exporter = useMeetingExport({
    transcriptPanelRef,
    summaryPanelRef,
    transcriptSegments: playbackData.segments,
    audioUrl: mode === 'playback' ? meetingDetail?.audio_file_url : undefined,
    meetingTitle: mode === 'playback' ? meetingDetail?.title : undefined,
  });

  useEffect(() => {
    if (mode !== 'playback' || !playback.activeSegmentId) return;
    const targetSegment = segmentRefs.current[playback.activeSegmentId];
    const transcriptPanel = transcriptPanelRef.current;
    if (!targetSegment || !transcriptPanel) return;
    const segmentsContainer = transcriptPanel.querySelector<HTMLDivElement>(
      '[data-transcript-scroll-container="true"]',
    );
    if (!segmentsContainer) return;

    const containerRect = segmentsContainer.getBoundingClientRect();
    const targetRect = targetSegment.getBoundingClientRect();
    const margin = 16;
    const isTargetVisible =
      targetRect.top >= containerRect.top + margin &&
      targetRect.bottom <= containerRect.bottom - margin;
    if (isTargetVisible) return;

    const now = Date.now();
    if (now - lastAutoScrollAtRef.current < 250) return;
    lastAutoScrollAtRef.current = now;

    if (autoScrollRafRef.current !== null) {
      cancelAnimationFrame(autoScrollRafRef.current);
    }
    autoScrollRafRef.current = requestAnimationFrame(() => {
      targetSegment.scrollIntoView({
        behavior: playback.isPlaying ? 'auto' : 'smooth',
        block: 'center',
      });
      autoScrollRafRef.current = null;
    });
  }, [mode, playback.activeSegmentId, playback.isPlaying]);

  useEffect(
    () => () => {
      if (autoScrollRafRef.current !== null) {
        cancelAnimationFrame(autoScrollRafRef.current);
      }
    },
    [],
  );

  return (
    <div className={`${styles.page} ${pageStyles.audioDetail}`}>
      <div className={pageStyles.audioDetailContent}>
        <MeetingPanels
          mode={mode}
          onBack={onBack}
          hasTranslation={resolvedHasTranslation}
          segments={playbackData.segments}
          playbackTranscriptEmptyText={playbackTranscriptEmptyText}
          liveTranscriptLines={liveTranscriptLines}
          liveTranscriptSegments={liveTranscriptSegments}
          activeSegmentId={playback.activeSegmentId}
          currentTime={playback.currentTime}
          transcriptPanelRef={transcriptPanelRef}
          segmentRefs={segmentRefs}
          onSeekSegment={playback.seekToSegment}
          onSeekWord={playback.seekToWord}
          summaryPanelRef={summaryPanelRef}
          liveSummaryTopics={liveSummaryTopics}
          summaryTopics={playbackData.summaryTopics}
          playbackSummaryEmptyText={playbackSummaryEmptyText}
          onSaveSummary={mode === 'playback' ? handleSaveSummary : undefined}
          isSavingSummary={isSummarySaving}
          saveSummaryError={summarySaveError}
        />

        <BottomBar
          mode={mode}
          recordTime={recordTime}
          isRecordPaused={isRecordPaused}
          onStopRecording={onStopRecording}
          recordingActions={recActions}
          isPlaying={playback.isPlaying}
          speed={playback.speed}
          showSpeedMenu={playback.showSpeedMenu}
          speedOptions={[0.5, 1.0, 1.5, 2.0]}
          currentTime={playback.currentTime}
          duration={playback.duration}
          progress={playback.progress}
          onTogglePlay={playback.togglePlay}
          onToggleSpeedMenu={playback.toggleSpeedMenu}
          onSelectSpeed={playback.selectSpeed}
          onSeek={playback.seek}
          onSeekStart={() => playback.setIsPlaying(false)}
          onOpenExport={() => exporter.setShowExportDialog(true)}
        />
      </div>

      <ExportDialog
        visible={exporter.showExportDialog}
        isExporting={exporter.isExporting}
        audioFormat={exporter.audioFormat}
        transcriptFormat={exporter.transcriptFormat}
        summaryFormat={exporter.summaryFormat}
        audioOptions={exporter.audioOptions}
        transcriptOptions={exporter.transcriptOptions}
        summaryOptions={exporter.summaryOptions}
        onClose={() => exporter.setShowExportDialog(false)}
        onSetAudioFormat={exporter.setAudioFormat}
        onSetTranscriptFormat={exporter.setTranscriptFormat}
        onSetSummaryFormat={exporter.setSummaryFormat}
        onConfirm={exporter.handleConfirmExport}
      />
    </div>
  );
};

export default AudioDetailPage;
