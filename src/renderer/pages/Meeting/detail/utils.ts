import type {
  MeetingDetailResponse,
  MeetingRawSentence,
  MeetingSummary,
  MeetingWord,
} from '@/services/meeting/types';
import type { Segment, SummaryTopic, Word } from './types';

const MIN_DURATION_SECONDS = 0.01;

type AnyRecord = Record<string, unknown>;

export function formatTime(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function isRecord(value: unknown): value is AnyRecord {
  return typeof value === 'object' && value !== null;
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function toString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function normalizeRange(start: number, end: number): { start: number; end: number } {
  const safeStart = Number.isFinite(start) ? Math.max(0, start) : 0;
  const safeEnd = Number.isFinite(end) ? Math.max(0, end) : safeStart + MIN_DURATION_SECONDS;
  if (safeEnd <= safeStart) {
    return { start: safeStart, end: safeStart + MIN_DURATION_SECONDS };
  }
  return { start: safeStart, end: safeEnd };
}

function splitChars(text: string): string[] {
  return Array.from(text);
}

function splitByWordLike(text: string): string[] {
  const safeText = String(text || '');
  if (!safeText) return [];

  try {
    const SegmenterCtor = (Intl as any)?.Segmenter;
    if (SegmenterCtor) {
      const segmenter = new SegmenterCtor('zh-Hans', { granularity: 'word' });
      const tokens = Array.from(segmenter.segment(safeText) as Iterable<{ segment: string }>)
        .map((item) => item.segment)
        .map((item) => item.trim())
        .filter(Boolean);
      if (tokens.length > 0) return tokens;
    }
  } catch {
    // ignore and fallback to regex
  }

  const tokens = safeText.match(/[A-Za-z0-9]+|[\u4e00-\u9fff]{1,3}|[^\s]/g);
  return tokens || [];
}

function isSingleCharTokens(tokens: string[]): boolean {
  if (tokens.length <= 1) return false;
  return tokens.every((token) => splitChars(token).length === 1);
}

function buildWordsByTokens(tokens: string[], start: number, end: number): Word[] {
  const filtered = tokens.filter((token) => token.length > 0);
  if (filtered.length === 0) return [];
  const range = normalizeRange(start, end);
  const duration = range.end - range.start;
  return filtered.map((text, index) => ({
    text,
    start: range.start + (duration * index) / filtered.length,
    end: range.start + (duration * (index + 1)) / filtered.length,
  }));
}

function buildWordsByChars(text: string, start: number, end: number): Word[] {
  return buildWordsByTokens(splitChars(text), start, end);
}

function getFirstFinite(record: AnyRecord, keys: string[]): number | null {
  for (const key of keys) {
    const num = toFiniteNumber(record[key]);
    if (num !== null) return num;
  }
  return null;
}

function getWordsFromUnknown(input: unknown): AnyRecord[] {
  if (!Array.isArray(input)) return [];
  return input.filter(isRecord);
}

function adaptWords(rawWords: unknown, text: string, start: number, end: number, divider: number): Word[] {
  if (Array.isArray(rawWords)) {
    const stringTokens = rawWords.filter((item): item is string => typeof item === 'string' && item.length > 0);
    if (stringTokens.length > 0) {
      if (isSingleCharTokens(stringTokens) && text) {
        const mergedTokens = splitByWordLike(text);
        if (mergedTokens.length > 0 && mergedTokens.length < stringTokens.length) {
          return buildWordsByTokens(mergedTokens, start, end);
        }
      }
      return buildWordsByTokens(stringTokens, start, end);
    }
  }

  const wordRecords = getWordsFromUnknown(rawWords);
  if (wordRecords.length === 0) {
    return buildWordsByChars(text, start, end);
  }

  const parsed = wordRecords.map((word) => {
    const wordText = toString(word.word) || toString(word.text);
    const startRaw = getFirstFinite(word, ['start_time', 'timestamp_start', 'start_at', 'start']);
    const endRaw = getFirstFinite(word, ['end_time', 'timestamp_end', 'end_at', 'end']);
    return {
      text: wordText,
      start: startRaw === null ? null : startRaw / divider,
      end: endRaw === null ? null : endRaw / divider,
    };
  });

  const validTokens = parsed.map((item) => item.text).filter((item) => item.length > 0);
  if (validTokens.length === 0) {
    return buildWordsByChars(text, start, end);
  }

  const allHaveTime = parsed.every((item) => item.start !== null && item.end !== null);
  if (!allHaveTime) {
    if (isSingleCharTokens(validTokens) && text) {
      const mergedTokens = splitByWordLike(text);
      if (mergedTokens.length > 0 && mergedTokens.length < validTokens.length) {
        return buildWordsByTokens(mergedTokens, start, end);
      }
    }
    return buildWordsByTokens(validTokens, start, end);
  }

  let cursor = start;
  return parsed.map((item) => {
    const rawStart = item.start ?? cursor;
    const rawEnd = item.end ?? rawStart + MIN_DURATION_SECONDS;
    const range = normalizeRange(rawStart, rawEnd);
    const clampedStart = Math.max(start, range.start);
    const clampedEnd = Math.min(end, Math.max(range.end, clampedStart + MIN_DURATION_SECONDS));
    cursor = clampedEnd;
    return {
      text: item.text || '',
      start: clampedStart,
      end: clampedEnd,
    };
  });
}

function extractLegacySegments(raw: unknown): AnyRecord[] {
  if (Array.isArray(raw)) return raw.filter(isRecord);
  if (!isRecord(raw)) return [];

  const nestedArrayKeys = ['segments', 'list', 'items', 'data'];
  for (const key of nestedArrayKeys) {
    const value = raw[key];
    if (Array.isArray(value)) {
      return value.filter(isRecord);
    }
  }

  if (isRecord(raw.result)) {
    return extractLegacySegments(raw.result);
  }

  return [raw];
}

function estimateDurationByText(text: string): number {
  const length = splitChars(text).length;
  if (length <= 0) return 1;
  return Math.min(8, Math.max(1, length * 0.2));
}

function toSegment(raw: AnyRecord, index: number, divider: number, previousEnd: number): Segment {
  const text = toString(raw.text) || toString(raw.sentence) || toString(raw.transcript);
  const startRaw = getFirstFinite(raw, ['start_at', 'timestamp_start', 'start_time', 'start']);
  const endRaw = getFirstFinite(raw, ['end_at', 'timestamp_end', 'end_time', 'end']);

  let start = startRaw === null ? previousEnd : startRaw / divider;
  let end = endRaw === null ? start + estimateDurationByText(text) : endRaw / divider;

  if (startRaw === null && endRaw !== null) {
    start = end - estimateDurationByText(text);
  }
  if (startRaw !== null && endRaw === null) {
    end = start + estimateDurationByText(text);
  }

  const range = normalizeRange(start, end);
  const words = adaptWords(raw.words, text, range.start, range.end, divider);
  const mergedText = text || words.map((word) => word.text).join('');

  return {
    id: toString(raw.id) || `segment-${index + 1}`,
    speakerId: toString(raw.speaker_id) || toString(raw.speakerId) || 'A',
    text: mergedText,
    translation: toString(raw.translation) || undefined,
    start: range.start,
    end: range.end,
    words: words.length > 0 ? words : buildWordsByChars(mergedText, range.start, range.end),
  };
}

function getSummaryRawSentences(summary: MeetingSummary | undefined): MeetingRawSentence[] {
  if (!summary?.raw_sentences || !Array.isArray(summary.raw_sentences)) return [];
  return summary.raw_sentences;
}

function segmentsFromSummaryRawSentences(
  rawSentences: MeetingRawSentence[],
  divider: number,
  startAt = 0,
): Segment[] {
  let cursor = startAt;
  return rawSentences.map((sentence, index) => {
    const words = sentence.words || [];
    const firstWord = words[0];
    const lastWord = words[words.length - 1];
    const start = firstWord ? firstWord.start_time / divider : cursor;
    const end = lastWord ? lastWord.end_time / divider : start + estimateDurationByText(sentence.text || '');
    const range = normalizeRange(start, end);
    const wordList = adaptWords(words, sentence.text || '', range.start, range.end, divider);
    const text = sentence.text || wordList.map((word) => word.text).join('');
    cursor = range.end;
    return {
      id: `summary-raw-${index + 1}`,
      speakerId: 'A',
      text,
      start: range.start,
      end: range.end,
      words: wordList.length > 0 ? wordList : buildWordsByChars(text, range.start, range.end),
    };
  });
}

function mergeMissingTranslations(baseSegments: Segment[], translationSourceSegments: Segment[]): Segment[] {
  if (baseSegments.length === 0 || translationSourceSegments.length === 0) return baseSegments;

  const usableTranslations = translationSourceSegments.filter((segment) =>
    Boolean(segment.translation && segment.translation.trim()),
  );
  if (usableTranslations.length === 0) return baseSegments;

  return baseSegments.map((segment, index) => {
    if (segment.translation && segment.translation.trim()) return segment;

    const byIndex = usableTranslations[index]?.translation?.trim();
    if (byIndex) {
      return { ...segment, translation: byIndex };
    }

    const byTime = usableTranslations.find(
      (candidate) =>
        Math.abs(candidate.start - segment.start) <= 1 && Math.abs(candidate.end - segment.end) <= 1,
    );
    if (byTime?.translation && byTime.translation.trim()) {
      return { ...segment, translation: byTime.translation.trim() };
    }

    return segment;
  });
}

function inferTimestampDivider(detail: MeetingDetailResponse): number {
  const duration = toFiniteNumber(detail.duration) ?? 0;
  const allCandidates: number[] = [];

  (detail.segments || []).forEach((segment) => {
    const rawSegment = segment as unknown as AnyRecord;
    const segStart = getFirstFinite(rawSegment, ['start_at', 'timestamp_start', 'start_time', 'start']);
    const segEnd = getFirstFinite(rawSegment, ['end_at', 'timestamp_end', 'end_time', 'end']);
    if (segStart !== null) allCandidates.push(segStart);
    if (segEnd !== null) allCandidates.push(segEnd);
    getWordsFromUnknown(rawSegment.words).forEach((word) => {
      const wordStart = getFirstFinite(word, ['start_time', 'timestamp_start', 'start_at', 'start']);
      const wordEnd = getFirstFinite(word, ['end_time', 'timestamp_end', 'end_at', 'end']);
      if (wordStart !== null) allCandidates.push(wordStart);
      if (wordEnd !== null) allCandidates.push(wordEnd);
    });
  });

  getSummaryRawSentences(detail.summary).forEach((sentence) => {
    (sentence.words || []).forEach((word: MeetingWord) => {
      allCandidates.push(word.start_time, word.end_time);
    });
  });

  extractLegacySegments(detail.result_final).forEach((segment) => {
    const segStart = getFirstFinite(segment, ['start_at', 'timestamp_start', 'start_time', 'start']);
    const segEnd = getFirstFinite(segment, ['end_at', 'timestamp_end', 'end_time', 'end']);
    if (segStart !== null) allCandidates.push(segStart);
    if (segEnd !== null) allCandidates.push(segEnd);
  });

  const maxCandidate = allCandidates.reduce((max, current) => Math.max(max, current), 0);
  if (maxCandidate <= 0) return 1;
  if (duration > 0) {
    return maxCandidate > duration * 5 ? 1000 : 1;
  }
  return maxCandidate > 1000 ? 1000 : 1;
}

function toSummaryTopics(summary?: MeetingSummary): SummaryTopic[] {
  if (!summary) return [];
  const fromSections = parseSummaryTopics(
    {
      result: {
        sections: summary.sections,
      },
    },
    summary.content,
  );
  if (fromSections.length > 0) return fromSections;

  const plainLines = String(summary.content || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  if (plainLines.length > 0) {
    return [{ header: summary.title || '会议总结', items: plainLines }];
  }
  if (summary.title) {
    return [{ header: summary.title, items: [] }];
  }
  return [];
}

export function parseSummaryTopics(raw: unknown, formattedText?: string): SummaryTopic[] {
  const sections = (raw as any)?.result?.sections;
  if (Array.isArray(sections) && sections.length) {
    const fromSections = sections
      .map((sec: any) => ({
        header: typeof sec?.heading === 'string' ? sec.heading : '',
        items: Array.isArray(sec?.items) ? sec.items.filter((x: unknown) => typeof x === 'string') : [],
      }))
      .filter((x: SummaryTopic) => x.header || x.items.length > 0);
    if (fromSections.length) return fromSections;
  }

  const text = String(formattedText || '').trim();
  if (!text) return [];
  const lines = text
    .split('\n')
    .map((x) => x.trim())
    .filter(Boolean);
  const topics: SummaryTopic[] = [];
  let current: SummaryTopic | null = null;
  for (const line of lines) {
    if (line.startsWith('## ')) {
      if (current) topics.push(current);
      current = { header: line.slice(3).trim(), items: [] };
      continue;
    }
    if (line.startsWith('- ')) {
      const item = line.slice(2).trim();
      if (!current) current = { header: '会议要点', items: [] };
      if (item) current.items.push(item);
      continue;
    }
  }
  if (current) topics.push(current);
  return topics;
}

export type MeetingDetailPlaybackData = {
  segments: Segment[];
  summaryTopics: SummaryTopic[];
  duration: number;
};

export function mapMeetingDetailToPlaybackData(
  detail: MeetingDetailResponse | null | undefined,
): MeetingDetailPlaybackData {
  if (!detail) {
    return { segments: [], summaryTopics: [], duration: 0 };
  }

  const divider = inferTimestampDivider(detail);
  const segmentsRaw = Array.isArray(detail.segments) ? detail.segments : [];
  const summaryRawSentences = getSummaryRawSentences(detail.summary);
  const legacySegments = extractLegacySegments(detail.result_final);

  let legacyPreviousEnd = 0;
  const adaptedLegacySegments: Segment[] = [];
  if (legacySegments.length > 0) {
    legacySegments.forEach((segment, index) => {
      const adapted = toSegment(segment, index, divider, legacyPreviousEnd);
      adaptedLegacySegments.push(adapted);
      legacyPreviousEnd = adapted.end;
    });
  }

  let previousEnd = 0;
  const adaptedSegments: Segment[] = [];

  if (segmentsRaw.length > 0) {
    segmentsRaw.forEach((segment, index) => {
      const adapted = toSegment(segment as unknown as AnyRecord, index, divider, previousEnd);
      adaptedSegments.push(adapted);
      previousEnd = adapted.end;
    });
    const merged = mergeMissingTranslations(adaptedSegments, adaptedLegacySegments);
    adaptedSegments.splice(0, adaptedSegments.length, ...merged);
  } else if (adaptedLegacySegments.length > 0) {
    adaptedSegments.push(...adaptedLegacySegments);
    previousEnd =
      adaptedLegacySegments.length > 0
        ? adaptedLegacySegments[adaptedLegacySegments.length - 1].end
        : previousEnd;
  } else if (summaryRawSentences.length > 0) {
    const fromSummary = segmentsFromSummaryRawSentences(summaryRawSentences, divider, previousEnd);
    adaptedSegments.push(...fromSummary);
    previousEnd = fromSummary.length > 0 ? fromSummary[fromSummary.length - 1].end : previousEnd;
  }

  const sortedSegments = adaptedSegments
    .filter((segment) => segment.text || segment.words.length > 0)
    .sort((a, b) => a.start - b.start)
    .map((segment, index) => ({
      ...segment,
      id: segment.id || `segment-${index + 1}`,
    }));

  const maxSegmentEnd = sortedSegments.reduce((max, segment) => Math.max(max, segment.end), 0);
  const apiDuration = toFiniteNumber(detail.duration) ?? 0;
  const duration = Math.max(apiDuration, maxSegmentEnd, 0);

  return {
    segments: sortedSegments,
    summaryTopics: toSummaryTopics(detail.summary),
    duration,
  };
}
