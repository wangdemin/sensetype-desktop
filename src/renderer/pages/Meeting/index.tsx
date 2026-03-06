import { useState, useEffect } from 'react';
import styles from '../common.module.scss';
import pageStyles from './index.module.scss';
import PageHeader from '../../components/PageHeader';
import MeetingList from './list';
import AudioDetailPage from './detail';
import RecordingFlowPage from './recording';
import RecordConfigDialog from './components/RecordConfigDialog';
import BatchDeleteDialog from './components/BatchDeleteDialog';
import StopRecordingConfirmDialog from './components/StopRecordingConfirmDialog';
import { useRecording, type MicOption } from './hooks/useRecording';
import { useMeetingRecords } from './hooks/useMeetingRecords';
import { useMeetingStore } from '@/renderer/store/useMeetingSubPageStore';
import { requestUserInfoRefresh } from '@/renderer/utils/refreshUserInfo';
import { message } from '@/renderer/components/Message';
import RecordIcon from '@/assets/icons/record.svg?react';
import BatchSelectIcon from '@/assets/icons/meeting/batch-select.svg?react';
import TrashIcon from '@/assets/icons/meeting/trash.svg?react';

const MeetingPage = () => {
  const [showConfigDialog, setShowConfigDialog] = useState(false);
  const [isBatchMode, setIsBatchMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showBatchDeleteDialog, setShowBatchDeleteDialog] = useState(false);
  const [showStopConfirmDialog, setShowStopConfirmDialog] = useState(false);
  const [isStoppingRecording, setIsStoppingRecording] = useState(false);
  const [subPage, setSubPage] = useState<'list' | 'detail' | 'recording'>('list');
  const [detailMode, setDetailMode] = useState<'recording' | 'playback'>('playback');
  const [detailHasTranslation, setDetailHasTranslation] = useState(false);
  const [currentDetailMeetingId, setCurrentDetailMeetingId] = useState<string>();
  const [isStartingRecording, setIsStartingRecording] = useState(false);

  const [recording, recordingActions] = useRecording();
  const isRecording =
    recording.status === 'recording' ||
    recording.status === 'starting' ||
    recording.status === 'processing';

  const {
    meetings,
    total,
    isLoading,
    hasMore,
    loadMeetings,
    handleSearchChange,
    handleLoadMore,
    handleRename,
    handleDelete,
    handleBatchDelete,
    refreshList,
  } = useMeetingRecords();

  const setMeetingSubPageStore = useMeetingStore((s) => s.setSubPage);
  const setMeetingRecordingGuard = useMeetingStore((s) => s.setRecordingGuard);
  const clearMeetingRecordingGuard = useMeetingStore((s) => s.clearRecordingGuard);

  useEffect(() => {
    setMeetingSubPageStore(subPage);
  }, [subPage, setMeetingSubPageStore]);

  useEffect(() => {
    setMeetingRecordingGuard({
      isRecordingActive: isRecording,
      requestStopConfirm: isRecording ? requestStopRecording : null,
    });
  }, [isRecording, setMeetingRecordingGuard]);

  useEffect(() => {
    return () => {
      clearMeetingRecordingGuard();
    };
  }, [clearMeetingRecordingGuard]);

  useEffect(() => {
    loadMeetings(1, '');
  }, []);

  async function handleStopRecording() {
    setIsStoppingRecording(true);
    try {
      await recordingActions.stopRecording();
      refreshList();
      // 录制结束：刷新用户信息（主要是积分）
      requestUserInfoRefresh({ reason: 'meeting-recording-stopped' });
    } finally {
      setIsStoppingRecording(false);
      setShowStopConfirmDialog(false);
      setSubPage('list');
    }
  }

  function requestStopRecording() {
    setShowStopConfirmDialog(true);
  }

  if (subPage === 'recording') {
    return (
      <>
        <RecordingFlowPage
          onBack={() => {
            if (isRecording) {
              requestStopRecording();
              return;
            }
            setSubPage('list');
          }}
          hasTranslation={detailHasTranslation}
          onStopRecording={requestStopRecording}
          recordingState={recording}
          recordingActions={recordingActions}
        />
        {showStopConfirmDialog && (
          <StopRecordingConfirmDialog
            onConfirm={handleStopRecording}
            onCancel={() => setShowStopConfirmDialog(false)}
            isStopping={isStoppingRecording}
          />
        )}
      </>
    );
  }

  if (subPage === 'detail') {
    return (
      <>
        <AudioDetailPage
          meetingId={currentDetailMeetingId}
          onBack={() => {
            if (isRecording) {
              requestStopRecording();
              return;
            }
            setSubPage('list');
          }}
          mode={detailMode}
          hasTranslation={detailHasTranslation}
          onStopRecording={requestStopRecording}
          recordingState={recording}
          recordingActions={recordingActions}
        />
        {showStopConfirmDialog && (
          <StopRecordingConfirmDialog
            onConfirm={handleStopRecording}
            onCancel={() => setShowStopConfirmDialog(false)}
            isStopping={isStoppingRecording}
          />
        )}
      </>
    );
  }

  const handleToggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleEnterBatchMode = () => {
    setIsBatchMode(true);
    setSelectedIds(new Set());
  };

  const handleExitBatchMode = () => {
    setIsBatchMode(false);
    setSelectedIds(new Set());
  };

  const handleConfirmBatchDelete = async () => {
    const success = await handleBatchDelete(selectedIds);
    if (success) {
      setSelectedIds(new Set());
      setIsBatchMode(false);
      setShowBatchDeleteDialog(false);
    }
  };

  const handleStartRecording = async (config: {
    micOption: MicOption;
    hasTranslation: boolean;
    targetLanguage: string;
  }) => {
    setIsStartingRecording(true);

    const success = await recordingActions.checkPermissionsAndStart(
      config.micOption,
      config.hasTranslation ? config.targetLanguage : '',
      config.hasTranslation ? 'both' : 'source',
    );

    setIsStartingRecording(false);

    if (success) {
      setShowConfigDialog(false);
      setDetailHasTranslation(config.hasTranslation);
      setSubPage('recording');
    } else {
      message.error(recording.error || '启动录制失败，请检查麦克风和屏幕录制权限后重试');
    }
  };

  return (
    <div
      className={styles.page}
      style={{
        padding: '40px 100px 0px',
      }}
    >
      <div className={pageStyles.meetingHeader}>
        <PageHeader title="会议纪要" subtitle="高效语音转写，自动生成会议总结。" />
        <div className={pageStyles.headerActions}>
          {isBatchMode ? (
            <>
              <button
                className={`${pageStyles.btnDanger} ${selectedIds.size === 0 ? pageStyles.btnDangerDisabled : ''}`}
                disabled={selectedIds.size === 0}
                onClick={() => setShowBatchDeleteDialog(true)}
              >
                <TrashIcon />
                删除{selectedIds.size > 0 ? ` (${selectedIds.size})` : ''}
              </button>
              <button className={pageStyles.btnSecondary} onClick={handleExitBatchMode}>
                取消
              </button>
            </>
          ) : (
            <>
              <button
                className={pageStyles.btnPrimary}
                disabled={isRecording}
                onClick={() => setShowConfigDialog(true)}
              >
                <RecordIcon />
                {isRecording ? '录制中…' : '开始录制'}
              </button>
              <button className={pageStyles.btnSecondary} onClick={handleEnterBatchMode}>
                <BatchSelectIcon />
                批量选择
              </button>
            </>
          )}
        </div>
      </div>

      <MeetingList
        meetings={meetings}
        onRename={handleRename}
        onDelete={handleDelete}
        isBatchMode={isBatchMode}
        selectedIds={selectedIds}
        onToggleSelect={handleToggleSelect}
        onNavigateToDetail={(id) => {
          setCurrentDetailMeetingId(id);
          setDetailMode('playback');
          setDetailHasTranslation(false);
          setSubPage('detail');
        }}
        onLoadMore={handleLoadMore}
        hasMore={hasMore}
        isLoading={isLoading}
        total={total}
        onSearchChange={handleSearchChange}
      />

      {recording.error && !showConfigDialog && (
        <div className={pageStyles.recordingErrorBanner}>
          {recording.error}
          {recording.isScreenRecordingErr && (
            <button
              className={pageStyles.permissionBtn}
              onClick={recordingActions.openScreenRecordingSettings}
            >
              打开系统设置
            </button>
          )}
        </div>
      )}

      {showConfigDialog && (
        <RecordConfigDialog
          onCancel={() => {
            setShowConfigDialog(false);
          }}
          onConfirm={handleStartRecording}
          isStarting={isStartingRecording}
        />
      )}

      {showBatchDeleteDialog && (
        <BatchDeleteDialog
          count={selectedIds.size}
          onConfirm={handleConfirmBatchDelete}
          onCancel={() => setShowBatchDeleteDialog(false)}
        />
      )}
    </div>
  );
};

export default MeetingPage;
