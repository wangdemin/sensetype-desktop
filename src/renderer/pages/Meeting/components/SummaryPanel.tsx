import {
  memo,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from 'react';
import { AiMeetingIcon } from './MeetingDetailIcons';
import styles from './MeetingPanels.module.scss';
import type { SummaryTopic } from '../detail/types';

type SummaryPanelProps = {
  mode: 'recording' | 'playback';
  summaryPanelRef: RefObject<HTMLDivElement>;
  liveSummaryTopics: SummaryTopic[];
  summaryTopics: SummaryTopic[];
  emptyText?: string;
  onSaveSummary?: (topics: SummaryTopic[]) => Promise<void>;
  isSavingSummary?: boolean;
  saveSummaryError?: string | null;
};

const SUMMARY_RECORDING_LOADING_STEPS = ['正在提炼关键信息', '正在生成会议总结'];

function buildSummaryMarkdown(topics: SummaryTopic[]): string {
  return topics
    .map((topic) => {
      const header = topic.header.trim();
      const items = topic.items.map((item) => item.trim()).filter(Boolean);
      const lines = [header ? `## ${header}` : '## 会议要点', ...items.map((item) => `- ${item}`)];
      return lines.join('\n');
    })
    .join('\n\n')
    .trim();
}

function parseDraftToTopics(text: string): SummaryTopic[] {
  const lines = text.split('\n');
  const topics: SummaryTopic[] = [];
  let current: SummaryTopic | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    const headingMatch = line.match(/^##\s*(.+)$/);
    if (headingMatch) {
      const nextTopic: SummaryTopic = {
        header: headingMatch[1].trim() || '会议要点',
        items: [],
      };
      topics.push(nextTopic);
      current = nextTopic;
      continue;
    }

    const bullet = line.match(/^[-*•]\s*(.+)$/);
    const numbered = line.match(/^\d+[.、]\s*(.+)$/);
    const markerOnly = /^[-*•]$/.test(line) || /^\d+[.、]$/.test(line);
    if (markerOnly) {
      continue;
    }
    const itemText = (bullet?.[1] || numbered?.[1] || line).trim();
    if (!itemText) continue;

    if (!current) {
      current = { header: '会议要点', items: [] };
      topics.push(current);
    }
    current.items.push(itemText);
  }

  return topics.filter((topic) => topic.header || topic.items.length > 0);
}

function SummaryPanel({
  mode,
  summaryPanelRef,
  liveSummaryTopics,
  summaryTopics,
  emptyText,
  onSaveSummary,
  isSavingSummary = false,
  saveSummaryError,
}: SummaryPanelProps) {
  const topics = mode === 'recording' ? liveSummaryTopics : summaryTopics;
  const statusText = mode === 'playback' ? emptyText : '';
  const editable = mode === 'playback' && Boolean(onSaveSummary);
  const [isEditing, setIsEditing] = useState(false);
  const [draftText, setDraftText] = useState('');
  const sourceMarkdown = useMemo(() => buildSummaryMarkdown(summaryTopics), [summaryTopics]);
  const trimmedDraft = draftText.trim();
  const parsedDraftTopics = useMemo(() => parseDraftToTopics(trimmedDraft), [trimmedDraft]);
  const canSave = !isSavingSummary && parsedDraftTopics.length > 0;
  const [loadingStep, setLoadingStep] = useState(0);
  const showRecordingLoading = mode === 'recording';
  const recordingLoadingText = SUMMARY_RECORDING_LOADING_STEPS[loadingStep];
  const summaryTreeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isEditing) {
      setDraftText(sourceMarkdown);
    }
  }, [sourceMarkdown, isEditing]);

  useEffect(() => {
    if (!showRecordingLoading) {
      setLoadingStep(0);
      return;
    }
    const timer = window.setInterval(() => {
      setLoadingStep((prev) => (prev + 1) % SUMMARY_RECORDING_LOADING_STEPS.length);
    }, 1600);
    return () => window.clearInterval(timer);
  }, [showRecordingLoading]);

  useLayoutEffect(() => {
    if (mode !== 'recording' || isEditing) return;
    const container = summaryTreeRef.current;
    if (!container) return;
    if (container.scrollHeight <= container.clientHeight) return;
    container.scrollTop = container.scrollHeight;
  }, [topics, isEditing, mode]);

  const handleStartEdit = () => {
    setDraftText(sourceMarkdown);
    setIsEditing(true);
  };

  const handleCancelEdit = () => {
    setDraftText(sourceMarkdown);
    setIsEditing(false);
  };

  const handleSave = async () => {
    if (!onSaveSummary || !canSave) return;
    await onSaveSummary(parsedDraftTopics);
    setIsEditing(false);
  };

  const handleEditorKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey) return;
    const textarea = event.currentTarget;
    const { selectionStart, selectionEnd, value } = textarea;
    if (selectionStart !== selectionEnd) return;

    const lineStart = value.lastIndexOf('\n', Math.max(0, selectionStart - 1)) + 1;
    const lineEndIndex = value.indexOf('\n', selectionStart);
    const lineEnd = lineEndIndex === -1 ? value.length : lineEndIndex;
    if (selectionStart !== lineEnd) return;

    const currentLine = value.slice(lineStart, lineEnd);
    const bulletPrefix = currentLine.match(/^(\s*[-*•]\s+)/)?.[1];
    if (!bulletPrefix) return;

    event.preventDefault();
    const insertion = `\n${bulletPrefix}`;
    const nextValue = value.slice(0, selectionStart) + insertion + value.slice(selectionEnd);
    const nextCursor = selectionStart + insertion.length;
    setDraftText(nextValue);

    requestAnimationFrame(() => {
      textarea.selectionStart = nextCursor;
      textarea.selectionEnd = nextCursor;
    });
  };

  return (
    <div className={styles.summaryPanel} ref={summaryPanelRef}>
      <div className={styles.panelHeader}>
        <div className={styles.panelTitleGroup}>
          <AiMeetingIcon />
          <span className={styles.panelTitle}>会议总结</span>
        </div>
        {editable && (
          <div className={styles.summaryActions} data-export-ignore="true">
            {isEditing ? (
              <>
                <button
                  type="button"
                  className={styles.summaryActionSecondary}
                  onClick={handleCancelEdit}
                  disabled={isSavingSummary}
                >
                  取消
                </button>
                <button
                  type="button"
                  className={styles.summaryActionPrimary}
                  onClick={() => void handleSave()}
                  disabled={!canSave}
                >
                  {isSavingSummary ? '保存中...' : '保存'}
                </button>
              </>
            ) : (
              <button
                type="button"
                className={styles.summaryActionPrimary}
                onClick={handleStartEdit}
              >
                编辑
              </button>
            )}
          </div>
        )}
      </div>

      {isEditing ? (
        <div className={styles.summaryEditorWrap}>
          <textarea
            className={styles.summaryEditor}
            value={draftText}
            onChange={(event) => setDraftText(event.target.value)}
            onKeyDown={handleEditorKeyDown}
            placeholder="请输入会议总结（支持 ## 标题 与 - 要点）"
            disabled={isSavingSummary}
          />
          {saveSummaryError ? (
            <div className={styles.summarySaveError}>{saveSummaryError}</div>
          ) : null}
        </div>
      ) : topics.length === 0 ? (
        mode === 'recording' ? (
          <>
            <div className={styles.summaryTree} ref={summaryTreeRef}>
              <div className={styles.aiSummaryLoading}>
                <span>会议总结生成中，稍后显示内容</span>
              </div>
            </div>
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
          </>
        ) : (
          <div className={styles.aiSummaryLoading}>
            <span>{statusText}</span>
          </div>
        )
      ) : (
        <>
          <div className={styles.summaryTree} ref={summaryTreeRef}>
            {topics.map((topic, ti) => {
              const isMuted = Boolean(topic.isMuted);
              return (
                <div
                  key={ti}
                  className={`${styles.summaryTopicGroup} ${isMuted ? styles.summaryTopicGroupMuted : ''}`}
                >
                  <div className={styles.summaryTopicHeaderRow}>
                    <div className={styles.summaryBulletDot} />
                    <div className={styles.summaryTopicHeader}>{topic.header}</div>
                  </div>
                  <div className={styles.summaryTopicItems}>
                    {topic.items.map((item, ii) => (
                      <div key={ii} className={styles.summaryTopicItem}>
                        {item}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
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
        </>
      )}
    </div>
  );
}

const MemoizedSummaryPanel = memo(SummaryPanel);
MemoizedSummaryPanel.displayName = 'SummaryPanel';

export default MemoizedSummaryPanel;
