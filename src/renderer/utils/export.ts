import { Document, Packer, Paragraph, TextRun } from 'docx';

/** 会议纪要 JSON 中单个 segment 的结构（与接口/存储一致） */
type MeetingSegment = {
  segment_id?: number;
  text?: string;
  translation?: string;
  start_at?: number;
  start?: number;
  [key: string]: unknown;
};

type MeetingPayload = {
  title?: string;
  segments?: MeetingSegment[];
  [key: string]: unknown;
};

function formatTimestamp(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return [h, m, s].map((n) => String(n).padStart(2, '0')).join(':');
}

export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * 将字符串内容导出为 txt 文件并触发下载。
 * @param filename 文件名（可含扩展名，如 `词典导出.txt`）
 * @param content 文件内容（字符串）
 */
export function exportTxt(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  downloadBlob(filename, blob);
}

/**
 * 将字符串内容导出为 markdown 文件并触发下载。
 * @param filename 文件名（可含扩展名，如 `会议纪要.md`）
 * @param content 文件内容（字符串）
 */
export function exportMarkdown(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
  downloadBlob(filename, blob);
}

/**
 * 将会议纪要 JSON 导出为无样式的 Word 文档并触发下载。
 * 每条为：时间戳、中文正文、英文译文（若有）。
 * @param filename 文件名（建议带 .docx，如 `会议纪要.docx`）
 * @param content 会议纪要 JSON 字符串
 */
export async function exportMeetingToDocx(filename: string, content: string): Promise<void> {
  let data: MeetingPayload;
  try {
    data = JSON.parse(content) as MeetingPayload;
  } catch {
    throw new Error('会议数据格式无效');
  }

  const segments = Array.isArray(data.segments) ? data.segments : [];
  const title = typeof data.title === 'string' ? data.title : '会议纪要';

  const children: Paragraph[] = [];
  children.push(
    new Paragraph({
      children: [new TextRun({ text: title })],
    }),
  );
  children.push(new Paragraph({ children: [] }));

  for (const seg of segments) {
    const text = typeof seg.text === 'string' ? seg.text : '';
    const translation = typeof seg.translation === 'string' ? seg.translation : '';
    const startMs =
      typeof seg.start_at === 'number'
        ? seg.start_at
        : typeof seg.start === 'number'
          ? seg.start * 1000
          : 0;
    const timeStr = formatTimestamp(startMs);

    if (!text && !translation) continue;

    children.push(
      new Paragraph({
        children: [new TextRun({ text: timeStr })],
      }),
    );
    if (text) {
      children.push(
        new Paragraph({
          children: [new TextRun({ text })],
        }),
      );
    }
    if (translation) {
      children.push(
        new Paragraph({
          children: [new TextRun({ text: translation })],
        }),
      );
    }
    children.push(new Paragraph({ children: [] }));
  }

  const doc = new Document({
    sections: [
      {
        properties: {},
        children,
      },
    ],
  });

  const blob = await Packer.toBlob(doc);
  const finalName = filename.endsWith('.docx') ? filename : `${filename}.docx`;
  downloadBlob(finalName, blob);
}

/**
 * 通过 wav 文件 URL 下载音频文件。
 * @param filename 文件名（可不带扩展名）
 * @param wavUrl wav 格式音频链接
 */
export async function exportWavByUrl(filename: string, wavUrl: string): Promise<void> {
  const resp = await fetch(wavUrl);
  if (!resp.ok) {
    throw new Error('音频下载失败');
  }

  const blob = await resp.blob();
  const finalName = filename.toLowerCase().endsWith('.wav') ? filename : `${filename}.wav`;
  downloadBlob(finalName, blob);
}

/**
 * 通过音频 URL 下载 MP3 文件。
 * @param filename 文件名（可不带扩展名）
 * @param audioUrl 音频文件链接
 */
export async function exportMp3ByUrl(filename: string, audioUrl: string): Promise<void> {
  const resp = await fetch(audioUrl);
  if (!resp.ok) {
    throw new Error('音频下载失败');
  }

  const blob = await resp.blob();
  const finalName = filename.toLowerCase().endsWith('.mp3') ? filename : `${filename}.mp3`;
  downloadBlob(finalName, blob);
}
