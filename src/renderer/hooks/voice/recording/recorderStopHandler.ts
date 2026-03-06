import { useHistoryStore } from '@/renderer/store/useHistoryStore';
import { requestUserInfoRefresh } from '@/renderer/utils/refreshUserInfo';
import { requestCheckinCalendarRefreshOnFirstUseToday } from '@/renderer/utils/checkinCalendarRefresh';
import { track } from '@/utils/posthog';
import { normalizeRecognitionRoute } from './recognitionRoute';
import { finishLongRecordingWsOnStop } from './routes/longRecordingWsRoute';
import { runShortRecordingSseOnStop } from './routes/shortRecordingSseRoute';

export function createHandleRecorderStop(args: {
  ctx: any;
  windowFocusedAtStart: boolean;
  startCanInsertInThisWindow: boolean;
  externalSelP: Promise<string> | null;
}) {
  const {
    ctx,
    windowFocusedAtStart: _windowFocusedAtStart,
    startCanInsertInThisWindow: _startCanInsertInThisWindow,
    externalSelP: _externalSelP,
  } = args;

  const handleRecorderStop = async () => {
    ctx.finalStopRequestedRef.current = false;

    const cancelled = ctx.cancelRequestedRef.current;
    ctx.cancelRequestedRef.current = false;

    ctx.dlog('[useVoiceRecognition] recorder.onstop 触发，cancelled =', cancelled);
    ctx.dlog('[useVoiceRecognition] 录音数据块数量:', ctx.chunksRef.current.length);

    const endedAt = Date.now();
    const startedAt =
      ctx.sessionStartedAtRef.current || ctx.stopStartedAtSnapshotRef?.current || endedAt;
    if (ctx.stopStartedAtSnapshotRef) ctx.stopStartedAtSnapshotRef.current = 0;
    const durationMs = Math.max(0, endedAt - startedAt);

    // cancel：直接结束，不做后续处理
    if (cancelled) {
      ctx.dlog('[useVoiceRecognition] 检测到 cancel 标志，直接清理，不进行识别');
      ctx.setRecording(false);
      ctx.recordingRef.current = false;
      ctx.setProcessing(false);
      ctx.setSending(false);
      ctx.setRewriting(false);
      ctx.setIndicatorPreviewText?.('');
      ctx.cleanupStream();
      ctx.finalStopRequestedRef.current = false;
      return;
    }

    // 统计本次语音时长（ms）
    ctx.recordingDurationSumMsRef.current =
      (ctx.recordingDurationSumMsRef.current || 0) + Math.max(0, durationMs);

    // 录音结束埋点（只打一次）：接口请求完毕后调用
    const trackRecordEndOnce = () => {
      if (ctx.recordEndTrackedRef.current) return;
      ctx.recordEndTrackedRef.current = true;
      // 与录制结束埋点绑定：只触发一次
      track('sensetype_task_stt_execute');
      track('sensetype_record_end', {
        $x_time: Math.max(0, Math.round(ctx.recordingDurationSumMsRef.current || 0)),
      });
    };

    // STT 成功埋点（只打一次）：接口请求完毕且有最终文本时调用
    const trackSttSuccessOnce = (text: string) => {
      if (ctx.sttSuccessTrackedRef.current) return;
      const t = String(text || '').replace(/\s+/g, '');
      if (!t) return;
      ctx.sttSuccessTrackedRef.current = true;
      const ms = Math.max(1, Math.round(ctx.recordingDurationSumMsRef.current || 0));
      const speed = Math.round((t.length * 60000) / ms); // 字/分钟
      track('sensetype_stt_success', { $x_speed: speed });
    };

    const t0 = performance.now();
    let tConvertDone = 0;
    let tSendDone = 0;
    let tSelDone = 0;
    let tPasteDone = 0;
    let tRewriteDone = 0;
    let hasError = false;
    let recognitionRoute: 'sse' | 'ws' = normalizeRecognitionRoute(ctx.recognitionRouteRef?.current);

    ctx.setProcessing(true);
    ctx.sendFeedback({ type: 'recording-stopped' });
    ctx.setRecording(false);
    ctx.recordingRef.current = false;
    // 停止波形分析（避免在处理阶段还抖动）
    ctx.stopAudioAnalysis();
    try {
      // 检查是否有录音数据
      if (ctx.chunksRef.current.length === 0) {
        throw new Error('没有收集到任何录音数据，请检查麦克风是否正常工作');
      }

      const totalSize = ctx.chunksRef.current.reduce((sum, chunk) => sum + chunk.size, 0);
      if (totalSize === 0) {
        throw new Error('录音数据为空，请检查麦克风是否正常工作');
      }

      console.log(
        '[useVoiceRecognition] 准备处理录音数据，数据块数量:',
        ctx.chunksRef.current.length,
        '总大小:',
        totalSize,
        'bytes',
      );

      // 合并所有数据块为完整的音频 Blob
      const blob = new Blob(ctx.chunksRef.current, { type: 'audio/webm;codecs=opus' });

      console.log('[useVoiceRecognition] 音频 Blob 创建成功，大小:', blob.size, 'bytes');

      // 转换为 MP3 格式（附带预缓冲音频避免丢字）
      console.log('[useVoiceRecognition] 开始转换为 MP3 格式...');
      let mp3Blob: Blob;
      try {
        const _preBuf = ctx.preBufferSnapshotRef.current;
        ctx.preBufferSnapshotRef.current = null;
        mp3Blob = await ctx.convertToMp3(blob, {
          preBufferPcm: _preBuf || undefined,
        });
        console.log('[useVoiceRecognition] MP3 转换成功，大小:', mp3Blob.size, 'bytes');
        tConvertDone = performance.now();
      } catch (convertError: any) {
        console.error('[useVoiceRecognition] MP3 转换失败:', convertError);
        throw new Error(`音频格式转换失败: ${convertError?.message || '未知错误'}`);
      }

      // 开发模式：每次生成完 MP3 都在本地额外落盘一份（通过主进程 recordings handler 写入）
      try {
        if (import.meta.env.DEV && ctx.ipcRenderer?.invoke) {
          const ab = await mp3Blob.arrayBuffer();
          const res = (await ctx.ipcRenderer.invoke('recordings-save-mp3', {
            bytes: ab,
            fileBaseName: 'recording',
            meta: { trigger: ctx.sessionTriggerRef.current || 'unknown' },
          })) as any;
          if (res?.success && res?.filePath) {
            console.log('[useVoiceRecognition] recordings-save-mp3 saved:', res.filePath);
          }
        }
      } catch {
        // ignore
      }

      // 创建音频 URL 用于预览
      const url = URL.createObjectURL(mp3Blob);
      if (ctx.audioUrlRef.current) URL.revokeObjectURL(ctx.audioUrlRef.current);
      ctx.audioUrlRef.current = url;
      ctx.setAudioUrl(url);
      console.log('[useVoiceRecognition] 音频预览 URL 创建成功');

      // 发送到 API 进行语音识别
      console.log('[useVoiceRecognition] 开始发送音频到 API...');
      ctx.setSending(true);
      let result = '';
      let finalAsrText = '';
      let streamedInsertedInThisWindow = false;
      let shouldRecordOnly = false;
      let rewriteSelectedText = '';
      try {
        // 选中内容重写：以“缓存的选区”优先决定 record_only（避免 done 时选区丢失）
        rewriteSelectedText = ctx.validateRewriteSelectedText(
          String(ctx.pendingRewriteSelectedTextRef.current || '').trim(),
        );
        shouldRecordOnly = Boolean(rewriteSelectedText);
        if (!shouldRecordOnly && ctx.autoInsert) {
          // 兜底：如果还没缓存到（极端情况下），再尝试读取一次
          const selectedInThisWindow = ctx.validateRewriteSelectedText(
            ctx.getSelectedTextInThisWindow(),
          );
          if (selectedInThisWindow) {
            shouldRecordOnly = true;
            rewriteSelectedText = selectedInThisWindow;
            ctx.pendingRewriteSelectedTextRef.current = rewriteSelectedText;
          } else {
            let canInsertInThisWindow = false;
            if (document.hasFocus()) {
              const el = document.activeElement as any;
              const isTextInput =
                el instanceof HTMLInputElement ||
                el instanceof HTMLTextAreaElement ||
                (typeof el?.tagName === 'string' &&
                  (el.tagName.toLowerCase() === 'input' ||
                    el.tagName.toLowerCase() === 'textarea'));
              canInsertInThisWindow = Boolean(isTextInput || el?.isContentEditable);
            }
            // 关键修复：
            // 会话开始时若不在可输入态（常见于外部应用选中场景），即使中途焦点回到了 App，
            // 也继续尝试读取外部选区，避免“焦点态漂移”导致漏触发重写。
            const shouldCheckExternalSelected =
              !_windowFocusedAtStart && (!_startCanInsertInThisWindow || !canInsertInThisWindow);
            if (shouldCheckExternalSelected) {
              try {
                let externalSelected = '';
                if (_externalSelP) {
                  try {
                    externalSelected = ctx.validateRewriteSelectedText(
                      String((await _externalSelP) || '').trim(),
                    );
                  } catch {
                    externalSelected = '';
                  }
                }
                if (!externalSelected) {
                  externalSelected = ctx.validateRewriteSelectedText(
                    String((await ctx.ipcRenderer?.invoke?.('get-selected-text')) || '').trim(),
                  );
                }
                if (externalSelected) {
                  shouldRecordOnly = true;
                  rewriteSelectedText = externalSelected;
                  ctx.pendingRewriteSelectedTextRef.current = rewriteSelectedText;
                }
              } catch {
                // ignore
              }
            }
          }
        }

        ctx.abortAllRef.current = false;
        recognitionRoute = normalizeRecognitionRoute(ctx.recognitionRouteRef?.current);
        if (recognitionRoute === 'ws') {
          // WS 路由（非长按组合键）不支持“选中内容重写”，停止后统一直接输出识别文本。
          shouldRecordOnly = false;
          rewriteSelectedText = '';
          ctx.pendingRewriteSelectedTextRef.current = '';
        }
        if (recognitionRoute === 'ws') {
          result = await finishLongRecordingWsOnStop(ctx);
        } else {
          // 单键/短录音（SSE 路由）：只走 SSE。
          const sseResult = await runShortRecordingSseOnStop({
            ctx,
            mp3Blob,
            shouldRecordOnly,
          });
          result = sseResult.result;
          streamedInsertedInThisWindow = sseResult.streamedInsertedInThisWindow;
        }

        // 流式返回内容为空：提示“未识别到内容”（与“无网络连接”同样走语音波动条提示 + 自动消失）
        if (!result || !String(result).trim()) {
          requestUserInfoRefresh({ reason: 'asr-empty' });
          throw new Error('未识别到内容');
        }
        console.log('[useVoiceRecognition] 识别成功，识别结果:', result);
        finalAsrText = String(result || '');
        ctx.setApiResult(finalAsrText);
        tSendDone = performance.now();
        // 语音识别完成：刷新积分
        requestUserInfoRefresh({ reason: 'asr-stream-done' });
        requestCheckinCalendarRefreshOnFirstUseToday();
      } catch (apiError: any) {
        try {
          ctx.voiceWsClientRef.current?.close();
        } catch {
          // ignore
        }
        ctx.voiceWsClientRef.current = null;
        ctx.voiceWsConnectPromiseRef.current = null;
        console.error('[useVoiceRecognition] 语音识别请求失败:', apiError);
        throw new Error(`语音识别失败: ${apiError?.message || '未知错误'}`);
      }

      // 根据配置自动插入识别结果
      // 落库规则：
      // - 如果走“重写”流程：记录重写后的文本
      // - 否则：记录识别文本
      let storedText = finalAsrText;
      let storedMode: 'asr' | 'rewrite' = 'asr';
      let storedRaw: unknown = result;
      let storedRewriteMeta: any = undefined;

      if (finalAsrText) {
        // 选中内容重写：只要本次请求确实走了 record_only=true，就必须在 done 后调用重写接口
        // （不依赖 ctx.autoInsert，也不依赖“当前是否还能读到选区”）。
        let cachedSelected = ctx.validateRewriteSelectedText(
          shouldRecordOnly
            ? String(rewriteSelectedText || '').trim()
            : String(ctx.pendingRewriteSelectedTextRef.current || '').trim(),
        );
        if (shouldRecordOnly && !cachedSelected) {
          // 兜底：若缓存丢失，再尝试读一次（本窗口优先，其次跨应用）
          try {
            const selInWin = ctx.validateRewriteSelectedText(ctx.getSelectedTextInThisWindow());
            if (selInWin) cachedSelected = selInWin;
          } catch {
            //
          }
          if (!cachedSelected && !_windowFocusedAtStart) {
            try {
              const externalSelected = ctx.validateRewriteSelectedText(
                String((await ctx.ipcRenderer?.invoke?.('get-selected-text')) || '').trim(),
              );
              if (externalSelected) cachedSelected = externalSelected;
            } catch {
              //
            }
          }
          // 把兜底结果也写回缓存，保证后续流程一致
          if (cachedSelected) ctx.pendingRewriteSelectedTextRef.current = cachedSelected;
        }

        if (shouldRecordOnly && cachedSelected && recognitionRoute !== 'ws') {
          try {
            console.info('[useVoiceRecognition][rewrite] trigger', {
              selectedLen: cachedSelected.length,
              instructionLen: finalAsrText.length,
            });
            ctx.setRewriting(true);
            ctx.sendFeedback({ type: 'rewrite-started' });
            ctx.ipcRenderer?.send?.('renderer-log', {
              tag: 'recorderStopHandler',
              message: 1123123123,
            });

            const data = await ctx.rewriteTextRequest(cachedSelected, finalAsrText);

            const rewrittenRaw = String(data?.result?.rewritten_text?.trim?.() || '');
            const rewritten = rewrittenRaw;

            ctx.ipcRenderer?.send?.('renderer-log', {
              tag: 'recorderStopHandler',
              message: data,
            });
            ctx.ipcRenderer?.send?.('renderer-log', {
              tag: 'recorderStopHandler',
              message: rewritten,
            });

            if (rewritten) {
              storedText = rewritten;
              storedMode = 'rewrite';
              storedRaw = { asr: finalAsrText, rewrite: data };
              storedRewriteMeta = {
                selectedText: cachedSelected,
                instruction: finalAsrText,
                rawResponse: data,
              };
              // 成功重写后继续走统一收口（埋点/落库），不要提前 return。
              // 系统级悬浮窗展示（不在 App 内）
              await ctx.tryShowRewriteOverlay(rewritten, finalAsrText);
              // 重写接口成功返回且有内容：只记录一次
              if (!ctx.rewriteExecuteTrackedRef.current) {
                ctx.rewriteExecuteTrackedRef.current = true;
                track('sensetype_task_rewrite_execute');
              }
              ctx.sendFeedback({ type: 'rewrite-done' });
              tRewriteDone = performance.now();
              // 重写完成：刷新积分
              requestUserInfoRefresh({ reason: 'rewrite-done' });
              requestCheckinCalendarRefreshOnFirstUseToday();
            } else {
              const msg = '重写接口未返回内容';
              ctx.setError(msg);
              ctx.toastErrorOnIndicator(msg);
              ctx.sendFeedback({ type: 'recognition-error', message: msg });
            }
          } catch (e: any) {
            const msg = e?.message || '重写失败，请重试。';
            ctx.setError(msg);
            ctx.toastErrorOnIndicator(msg);
            ctx.sendFeedback({
              type: 'recognition-error',
              message: msg,
            });
          } finally {
            ctx.setRewriting(false);
            // 本轮已消费缓存选区，避免影响下一轮
            ctx.pendingRewriteSelectedTextRef.current = '';
          }
        } else if (!shouldRecordOnly && ctx.autoInsert) {
          // App 内：如果用户在输入框中选中了一段文本，再说话应走“重写→弹窗”，而不是直接替换选区
          const selectedInThisWindow = ctx.validateRewriteSelectedText(
            ctx.getSelectedTextInFocusedTextInputInThisWindow(),
          );
          if (selectedInThisWindow && recognitionRoute !== 'ws') {
            try {
              ctx.setRewriting(true);
              ctx.sendFeedback({ type: 'rewrite-started' });
              const data = await ctx.rewriteTextRequest(selectedInThisWindow, finalAsrText);
              const rewritten = data?.result?.rewritten_text?.trim?.() || '';
              if (rewritten) {
                storedText = rewritten;
                storedMode = 'rewrite';
                storedRaw = { asr: finalAsrText, rewrite: data };
                storedRewriteMeta = {
                  selectedText: selectedInThisWindow,
                  instruction: finalAsrText,
                  rawResponse: data,
                };
                await ctx.tryShowRewriteOverlay(rewritten, finalAsrText);
                // 重写接口成功返回且有内容：只记录一次
                if (!ctx.rewriteExecuteTrackedRef.current) {
                  ctx.rewriteExecuteTrackedRef.current = true;
                  track('sensetype_task_rewrite_execute');
                }
                ctx.sendFeedback({ type: 'rewrite-done' });
                tRewriteDone = performance.now();
                requestUserInfoRefresh({ reason: 'rewrite-done' });
                requestCheckinCalendarRefreshOnFirstUseToday();
              } else {
                const msg = '重写接口未返回内容';
                ctx.setError(msg);
                ctx.toastErrorOnIndicator(msg);
                ctx.sendFeedback({ type: 'recognition-error', message: msg });
              }
            } catch (e: any) {
              const msg = e?.message || '重写失败，请重试。';
              ctx.setError(msg);
              ctx.toastErrorOnIndicator(msg);
              ctx.sendFeedback({
                type: 'recognition-error',
                message: msg,
              });
            } finally {
              ctx.setRewriting(false);
            }
          } else {
            // 没有选区：先尝试在当前窗口的输入框中插入
            const inserted = streamedInsertedInThisWindow
              ? true
              : ctx.insertIntoFocusedEditableInThisWindow(finalAsrText);
            if (!inserted) {
              // 读取“当前前台应用”选中文本：
              // - 有选区：将语音识别结果当作“重写指令”，调用重写接口，并在系统级悬浮窗展示结果
              // - 无选区：保持原逻辑，直接粘贴语音识别结果
              let selectedText = '';
              if (!_windowFocusedAtStart) {
                try {
                  selectedText = ctx.validateRewriteSelectedText(
                    String((await ctx.ipcRenderer?.invoke?.('get-selected-text')) || '').trim(),
                  );
                  tSelDone = performance.now();
                } catch {
                  selectedText = '';
                  tSelDone = performance.now();
                }
              } else {
                tSelDone = performance.now();
              }

              if (selectedText && recognitionRoute !== 'ws') {
                try {
                  ctx.setRewriting(true);
                  ctx.sendFeedback({ type: 'rewrite-started' });
                  const data = await ctx.rewriteTextRequest(selectedText, finalAsrText);
                  const rewritten = data?.result?.rewritten_text?.trim?.() || '';
                  if (rewritten) {
                    storedText = rewritten;
                    storedMode = 'rewrite';
                    storedRaw = { asr: finalAsrText, rewrite: data };
                    storedRewriteMeta = {
                      selectedText,
                      instruction: finalAsrText,
                      rawResponse: data,
                    };
                    await ctx.tryShowRewriteOverlay(rewritten, finalAsrText);
                    // 重写接口成功返回且有内容：只记录一次
                    if (!ctx.rewriteExecuteTrackedRef.current) {
                      ctx.rewriteExecuteTrackedRef.current = true;
                      track('sensetype_task_rewrite_execute');
                    }
                    ctx.sendFeedback({ type: 'rewrite-done' });
                    tRewriteDone = performance.now();
                    // 重写完成：刷新积分
                    requestUserInfoRefresh({ reason: 'rewrite-done' });
                    requestCheckinCalendarRefreshOnFirstUseToday();
                  } else {
                    const msg = '重写接口未返回内容';
                    ctx.setError(msg);
                    ctx.toastErrorOnIndicator(msg);
                    ctx.sendFeedback({
                      type: 'recognition-error',
                      message: msg,
                    });
                  }
                } catch (e: any) {
                  const msg = e?.message || '重写失败，请重试。';
                  ctx.setError(msg);
                  ctx.toastErrorOnIndicator(msg);
                  ctx.sendFeedback({
                    type: 'recognition-error',
                    message: msg,
                  });
                } finally {
                  ctx.setRewriting(false);
                }
              } else {
                // 如果当前窗口没有可插入的输入框，则通过 IPC 粘贴到外部应用
                const externalText =
                  String(finalAsrText || '');
                try {
                  if (!ctx.externalTokenPastedRef.current) {
                    if (recognitionRoute === 'ws') {
                      // 长录音：按用户诉求改为一次性输出，避免逐字注入观感。
                      await ctx.ipcRenderer?.invoke('paste-text', externalText);
                    } else {
                      await ctx.ipcRenderer?.invoke('inject-text', externalText);
                    }
                    tPasteDone = performance.now();
                  }
                } catch (e: any) {
                  if (!ctx.isWin) {
                    // macOS fallback
                    try {
                      await ctx.ipcRenderer?.invoke('paste-text', externalText);
                      tPasteDone = performance.now();
                      return;
                    } catch {
                      // ignore
                    }
                  }
                  ctx.setError(
                    e?.message ||
                      (ctx.isWin
                        ? '无法注入到外部应用（未使用剪贴板回退）。'
                        : '无法粘贴到外部应用，请检查权限（mac 需要辅助功能权限）。'),
                  );
                  ctx.sendFeedback({
                    type: 'recognition-error',
                    message:
                      e?.message ||
                      (ctx.isWin
                        ? '无法注入到外部应用（未使用剪贴板回退）。'
                        : '无法粘贴到外部应用，请检查权限（mac 需要辅助功能权限）。'),
                  });
                }
              }
            }
          }
        }
      }

      // 落库：识别成功 / 重写成功（按上面的规则决定存哪一份文本）
      try {
        useHistoryStore.getState().addRecord({
          createdAt: endedAt,
          startedAt,
          endedAt,
          durationMs: durationMs,
          status: 'done',
          text: storedText,
          meta: {
            trigger: ctx.sessionTriggerRef.current,
            recognitionRoute,
            mode: storedMode,
            audio: {
              mimeType: mp3Blob?.type,
              sizeBytes: mp3Blob?.size,
            },
            rawResponse: storedRaw,
            rewrite: storedRewriteMeta,
          },
        });
      } catch {
        // ignore history failures
      }
      // Perf log (only when enabled): helps compare Win vs Mac and pinpoint slow step.
      if (ctx.VOICE_DEBUG) {
        const tEnd = performance.now();
        const ms = (v: number) => (v ? Math.round(v - t0) : 0);
        console.log('[voice-perf] total(ms)=', Math.round(tEnd - t0), {
          convert: ms(tConvertDone),
          send: ms(tSendDone) - ms(tConvertDone),
          getSelected: ms(tSelDone) ? ms(tSelDone) - ms(tSendDone) : 0,
          rewrite: ms(tRewriteDone) ? ms(tRewriteDone) - ms(tSelDone || tSendDone) : 0,
          paste: ms(tPasteDone) ? ms(tPasteDone) - ms(tSelDone || tSendDone) : 0,
        });
      }
      // 接口请求完毕：打埋点（重写流程成功）
      trackSttSuccessOnce(storedText);
      trackRecordEndOnce();
    } catch (err: any) {
      // 用户主动取消：不提示错误、不落库
      const isAbort =
        ctx.abortAllRef.current ||
        err?.name === 'AbortError' ||
        /aborted|abort/i.test(String(err?.message || ''));
      if (isAbort) {
        hasError = false;
        ctx.setSending(false);
        ctx.setRewriting(false);
        ctx.setProcessing(false);
        ctx.setIndicatorPreviewText?.('');
        ctx.cleanupStream();
        return;
      }

      // 接口请求完毕（失败/空识别等）：打埋点
      trackRecordEndOnce();

      hasError = true;
      const rawMsg = err?.message || '录音处理失败，请重试。';
      ctx.setError(rawMsg);

      // 系统级提示：接口无响应/报错时，弹一条文案后自动消失
      try {
        const msg = String(rawMsg || '');
        const isEmptyRecognition = /未识别到内容/.test(msg);
        const isOffline =
          typeof navigator !== 'undefined' && typeof navigator.onLine === 'boolean'
            ? navigator.onLine === false
            : false;
        const isNetworkError =
          isOffline ||
          /Network Error|网络错误|无网络|offline|ERR_NETWORK|Failed to fetch|Load failed|net::|ECONN|ENOTFOUND|EAI_AGAIN|socket hang up/i.test(
            msg,
          );
        const isInsufficientPoints = /积分不足/.test(msg);
        const toast = isEmptyRecognition
          ? '未识别到内容'
          : isInsufficientPoints
            ? '积分不足'
            : isNetworkError
              ? '无网络连接'
              : '语音识别失败，请重试';
        if (ctx.sendIndicatorSet) {
          ctx.sendIndicatorSet({
            visible: true,
            status: isNetworkError || isInsufficientPoints ? 'error' : 'notice',
            message: toast,
            autoHideMs: 1600,
          });
        } else {
          ctx.ipcRenderer?.send?.('voice-indicator-set', {
            visible: true,
            status: isNetworkError || isInsufficientPoints ? 'error' : 'notice',
            message: toast,
            autoHideMs: 1600,
          });
        }
      } catch {
        //
      }
      ctx.sendFeedback({
        type: 'recognition-error',
        message: rawMsg,
      });

      // 落库：识别失败（保留时长等信息，便于排查）
      try {
        useHistoryStore.getState().addRecord({
          createdAt: endedAt,
          startedAt,
          endedAt,
          durationMs,
          status: 'error',
          text: '',
          errorMessage: err?.message || '录音处理失败，请重试。',
          meta: {
            trigger: ctx.sessionTriggerRef.current,
            recognitionRoute,
          },
        });
      } catch {
        // ignore history failures
      }
    } finally {
      // 先同步清空状态
      ctx.setSending(false);
      ctx.setRewriting(false);
      ctx.setProcessing(false);
      ctx.setIndicatorPreviewText?.('');
      ctx.cleanupStream();

      // 录音结束后后台 warm 一次麦克风，避免“隔一会儿再按又要等”
      try {
        setTimeout(() => {
          void ctx.ensureWarmMicStream('after-stop');
        }, 600);
      } catch {
        // ignore warm-up failures
      }

      // 延迟一点点发出 feedback，确保 React 状态更新和指示器隐藏消息先发出去
      setTimeout(() => {
        if (cancelled) return; // 如果已经取消了就不发了
        if (hasError) {
          // 错误已经在 catch 里处理过 ctx.sendFeedback 了
        } else {
          ctx.sendFeedback({ type: 'recognition-done' });
        }
      }, 50);
    }
  };
  return handleRecorderStop;
}
