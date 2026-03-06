import { useState, type RefObject } from 'react';
import { Document, Packer, Paragraph, TextRun } from 'docx';
import html2canvas from 'html2canvas';
import JSZip from 'jszip';
import type { Segment } from '../detail/types';
import { downloadBlob } from '@/renderer/utils/export';
import { message } from '@/renderer/components/Message';

function toSafeFilename(raw: string): string {
  return raw.replace(/[\\/:*?"<>|]/g, '_');
}

function formatTimestamp(seconds: number): string {
  const totalSec = Math.max(0, Math.floor(seconds));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return [h, m, s].map((n) => String(n).padStart(2, '0')).join(':');
}

function getErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

function buildTranscriptTxt(segments: Segment[]): string {
  return segments
    .map((seg) => {
      const time = `[${formatTimestamp(seg.start)}]`;
      const text = seg.text?.trim() || '';
      const translation = seg.translation?.trim() || '';
      return [time, text, translation].filter(Boolean).join('\n');
    })
    .filter(Boolean)
    .join('\n\n');
}

async function buildTranscriptDocxBlob(segments: Segment[]): Promise<Blob> {
  const validSegments = segments.filter((seg) => (seg.text?.trim() || seg.translation?.trim()));
  if (validSegments.length === 0) {
    throw new Error('暂无文字记录可导出');
  }

  const children: Paragraph[] = [new Paragraph({ children: [new TextRun({ text: '文字记录' })] }), new Paragraph({ children: [] })];
  validSegments.forEach((seg) => {
    const time = formatTimestamp(seg.start);
    const text = seg.text?.trim();
    const translation = seg.translation?.trim();
    children.push(new Paragraph({ children: [new TextRun({ text: time })] }));
    if (text) {
      children.push(new Paragraph({ children: [new TextRun({ text })] }));
    }
    if (translation) {
      children.push(new Paragraph({ children: [new TextRun({ text: `译文：${translation}` })] }));
    }
    children.push(new Paragraph({ children: [] }));
  });

  const doc = new Document({
    sections: [
      {
        properties: {},
        children,
      },
    ],
  });

  return Packer.toBlob(doc);
}

const PDF_MAX_CANVAS_SIDE = 16000;
const PDF_MAX_CANVAS_PIXELS = 24_000_000;
const PDF_DEFAULT_SCALE = 2;
const PDF_MIN_SCALE = 0.5;

function resolvePdfCaptureScale(width: number, height: number): number {
  const safeWidth = Math.max(1, Math.floor(width));
  const safeHeight = Math.max(1, Math.floor(height));
  const bySide = Math.min(PDF_MAX_CANVAS_SIDE / safeWidth, PDF_MAX_CANVAS_SIDE / safeHeight);
  const byArea = Math.sqrt(PDF_MAX_CANVAS_PIXELS / (safeWidth * safeHeight));
  const scale = Math.min(PDF_DEFAULT_SCALE, bySide, byArea);
  if (!Number.isFinite(scale) || scale <= 0) {
    throw new Error('PDF 导出失败：内容尺寸异常');
  }
  if (scale < PDF_MIN_SCALE) {
    throw new Error('PDF 导出失败：内容过长，请缩小导出范围后重试');
  }
  return scale;
}

function isCreatePatternZeroCanvasError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const msg = error.message || '';
  return msg.includes('createPattern') && msg.includes('width or height of 0');
}

function buildCaptureResetCss(simplified: boolean): string {
  const baseCss = `
    [data-export-capture='true'] * {
      -webkit-mask-image: none !important;
      mask-image: none !important;
    }
    [data-export-capture='true'] *::before,
    [data-export-capture='true'] *::after {
      -webkit-mask-image: none !important;
      mask-image: none !important;
      background-image: none !important;
    }
    [data-export-capture='true'] [data-export-highlight='true'] {
      color: inherit !important;
      font-weight: 400 !important;
      background: transparent !important;
    }
    [data-export-capture='true'] [data-export-highlight='true']::before {
      opacity: 0 !important;
      content: none !important;
    }
  `;
  if (!simplified) {
    return baseCss;
  }
  return `
    ${baseCss}
    [data-export-capture='true'] *,
    [data-export-capture='true'] *::before,
    [data-export-capture='true'] *::after {
      background-image: none !important;
      border-image: none !important;
      box-shadow: none !important;
      filter: none !important;
      backdrop-filter: none !important;
      text-shadow: none !important;
    }
    [data-export-capture='true'] *::before,
    [data-export-capture='true'] *::after {
      content: none !important;
    }
  `;
}

async function captureElementAsCanvas(
  target: HTMLElement,
  options?: { simplified?: boolean },
): Promise<HTMLCanvasElement> {
  const simplified = Boolean(options?.simplified);
  const wrapper = document.createElement('div');
  const resetStyle = document.createElement('style');
  const clone = target.cloneNode(true) as HTMLElement;

  wrapper.style.position = 'fixed';
  wrapper.style.left = '-100000px';
  wrapper.style.top = '0';
  wrapper.style.background = '#fff';
  wrapper.style.zIndex = '-1';
  resetStyle.textContent = buildCaptureResetCss(simplified);
  clone.dataset.exportCapture = 'true';
  wrapper.appendChild(resetStyle);
  wrapper.appendChild(clone);
  document.body.appendChild(wrapper);

  clone.style.height = 'auto';
  clone.style.maxHeight = 'none';
  clone.style.overflow = 'visible';
  clone.style.width = `${Math.max(target.scrollWidth, target.clientWidth)}px`;

  clone.querySelectorAll<HTMLElement>('*').forEach((el) => {
    if (el.scrollHeight > el.clientHeight) {
      el.style.height = 'auto';
      el.style.maxHeight = 'none';
      el.style.overflow = 'visible';
    }
  });
  clone.querySelectorAll<HTMLCanvasElement>('canvas').forEach((canvasEl) => {
    if (canvasEl.width <= 0 || canvasEl.height <= 0) {
      canvasEl.remove();
    }
  });
  clone.querySelectorAll<HTMLElement>('[data-export-ignore="true"]').forEach((el) => {
    el.remove();
  });

  try {
    const captureWidth = Math.max(clone.scrollWidth, clone.clientWidth);
    const captureHeight = Math.max(clone.scrollHeight, clone.clientHeight);
    if (captureWidth <= 0 || captureHeight <= 0) {
      throw new Error('PDF 导出失败：面板内容尚未渲染完成');
    }

    const captureScale = resolvePdfCaptureScale(captureWidth, captureHeight);
    console.info('[meeting-export] pdf capture size:', { captureWidth, captureHeight, captureScale });
    const canvas = await html2canvas(clone, {
      scale: captureScale,
      backgroundColor: '#ffffff',
      useCORS: true,
      logging: false,
      width: captureWidth,
      height: captureHeight,
      ignoreElements: (element) => {
        if (
          element instanceof HTMLElement &&
          element.closest('[data-export-ignore="true"]')
        ) {
          return true;
        }
        return element instanceof HTMLCanvasElement && (element.width <= 0 || element.height <= 0);
      },
    });
    return canvas;
  } catch (error) {
    if (!simplified && isCreatePatternZeroCanvasError(error)) {
      console.warn('[meeting-export] capture retry with simplified styles');
      return captureElementAsCanvas(target, { simplified: true });
    }
    throw error;
  } finally {
    if (wrapper.parentNode) {
      wrapper.parentNode.removeChild(wrapper);
    }
  }
}

function canvasToBlob(canvas: HTMLCanvasElement, mimeType: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('导出失败：无法生成图像数据'));
        return;
      }
      resolve(blob);
    }, mimeType, quality);
  });
}

async function exportAsPngBlob(target: HTMLElement): Promise<Blob> {
  const canvas = await captureElementAsCanvas(target);
  return canvasToBlob(canvas, 'image/png');
}

async function exportAsJpegBlob(target: HTMLElement): Promise<Blob> {
  const canvas = await captureElementAsCanvas(target);
  return canvasToBlob(canvas, 'image/jpeg', 0.92);
}

export const AUDIO_EXPORT_OPTIONS = ['MP3'] as const;
export const TRANSCRIPT_EXPORT_OPTIONS = ['DOCX', 'TXT'] as const;
export const SUMMARY_EXPORT_OPTIONS = ['JPEG', 'PNG'] as const;
type AudioExportFormat = (typeof AUDIO_EXPORT_OPTIONS)[number];
type TranscriptExportFormat = (typeof TRANSCRIPT_EXPORT_OPTIONS)[number];
type SummaryExportFormat = (typeof SUMMARY_EXPORT_OPTIONS)[number];

export function useMeetingExport({
  transcriptPanelRef,
  summaryPanelRef,
  transcriptSegments,
  audioUrl,
  meetingTitle,
}: {
  transcriptPanelRef: RefObject<HTMLDivElement>;
  summaryPanelRef: RefObject<HTMLDivElement>;
  transcriptSegments: Segment[];
  audioUrl?: string;
  meetingTitle?: string;
}) {
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [audioFormat, setAudioFormatState] = useState<AudioExportFormat | null>(null);
  const [transcriptFormat, setTranscriptFormatState] = useState<TranscriptExportFormat | null>(null);
  const [summaryFormat, setSummaryFormatState] = useState<SummaryExportFormat | null>(null);

  const setAudioFormat = (format: AudioExportFormat) => {
    setAudioFormatState((prev) => (prev === format ? null : format));
  };
  const setTranscriptFormat = (format: TranscriptExportFormat) => {
    setTranscriptFormatState((prev) => (prev === format ? null : format));
  };
  const setSummaryFormat = (format: SummaryExportFormat) => {
    setSummaryFormatState((prev) => (prev === format ? null : format));
  };

  const handleConfirmExport = async () => {
    if (!audioFormat && !transcriptFormat && !summaryFormat) {
      message.warning('请至少选择一个导出格式');
      return;
    }

    const timestamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
    const title = String(meetingTitle || '会议纪要').trim() || '会议纪要';
    const baseName = `${toSafeFilename(title)}_${timestamp}`;

    const zip = new JSZip();
    const successSteps: string[] = [];
    const failedSteps: string[] = [];
    const runExportStep = async (
      step: string,
      filename: string,
      task: () => Promise<Blob>,
    ): Promise<void> => {
      try {
        console.info('[meeting-export] start step:', step);
        const blob = await task();
        zip.file(toSafeFilename(filename), blob);
        console.info('[meeting-export] success step:', step);
        successSteps.push(step);
      } catch (err) {
        const detail = getErrorMessage(err, `${step} 导出失败`);
        console.error(`[meeting-export] ${step} export failed:`, err);
        failedSteps.push(`${step}：${detail}`);
      }
    };

    try {
      setIsExporting(true);

      if (audioFormat === 'MP3') {
        await runExportStep('音频 MP3', `${baseName}_音频.mp3`, async () => {
          if (!audioUrl) {
            throw new Error('未获取到音频地址');
          }
          const resp = await fetch(audioUrl);
          if (!resp.ok) {
            throw new Error('音频下载失败');
          }
          return resp.blob();
        });
      }

      if (transcriptFormat === 'DOCX') {
        await runExportStep('文字记录 DOCX', `${baseName}_文字记录.docx`, async () => {
          return buildTranscriptDocxBlob(transcriptSegments);
        });
      } else if (transcriptFormat === 'TXT') {
        await runExportStep('文字记录 TXT', `${baseName}_文字记录.txt`, async () => {
          const content = buildTranscriptTxt(transcriptSegments);
          if (!content) {
            throw new Error('暂无文字记录可导出');
          }
          return new Blob([content], { type: 'text/plain;charset=utf-8' });
        });
      }

      if (summaryFormat === 'JPEG') {
        await runExportStep('会议总结 JPEG', `${baseName}_会议总结.jpeg`, async () => {
          if (!summaryPanelRef.current) {
            throw new Error('会议总结区域未就绪');
          }
          return exportAsJpegBlob(summaryPanelRef.current);
        });
      } else if (summaryFormat === 'PNG') {
        await runExportStep('会议总结 PNG', `${baseName}_会议总结.png`, async () => {
          if (!summaryPanelRef.current) {
            throw new Error('会议总结区域未就绪');
          }
          return exportAsPngBlob(summaryPanelRef.current);
        });
      }

      if (successSteps.length > 0) {
        const zipBlob = await zip.generateAsync({ type: 'blob' });
        downloadBlob(`${baseName}.zip`, zipBlob);
      }

      if (failedSteps.length === 0 && successSteps.length > 0) {
        message.success('导出成功，已打包为 zip');
        setShowExportDialog(false);
      } else if (successSteps.length > 0) {
        message.warning(`已导出 zip（部分失败）：${failedSteps.join('；')}`);
      } else {
        message.error(`导出失败：${failedSteps.join('；')}`);
      }
    } finally {
      setIsExporting(false);
    }
  };

  return {
    showExportDialog,
    setShowExportDialog,
    isExporting,
    audioFormat,
    setAudioFormat,
    transcriptFormat,
    setTranscriptFormat,
    summaryFormat,
    setSummaryFormat,
    handleConfirmExport,
    audioOptions: AUDIO_EXPORT_OPTIONS,
    transcriptOptions: TRANSCRIPT_EXPORT_OPTIONS,
    summaryOptions: SUMMARY_EXPORT_OPTIONS,
  };
}
