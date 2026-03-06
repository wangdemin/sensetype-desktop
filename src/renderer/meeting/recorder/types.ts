export type MeetingRecorderStatus = 'idle' | 'starting' | 'recording' | 'processing' | 'error';

export type MeetingRecorderWord = {
  text: string;
  start: number;
  end: number;
};

export type MeetingRecorderLiveSegment = {
  id: string;
  speakerId: string;
  text: string;
  translation?: string;
  start: number;
  end: number;
  words: MeetingRecorderWord[];
};

export type MeetingRecorderDisplayMode = 'both' | 'source' | 'translated';

export type MeetingRecorderEvents = {
  onStatus?: (s: { status: MeetingRecorderStatus; message?: string }) => void;
  onToken?: (t: { content: string }) => void;
  onTranscriptDone?: (t: { text: string }) => void;
  onLiveSegments?: (t: { segments: MeetingRecorderLiveSegment[] }) => void;
  onFormatted?: (t: { formattedText: string; raw: unknown }) => void;
  onError?: (e: { message: string; raw?: unknown }) => void;
};

export type MeetingRecorderOptions = {
  /**
   * Capture system audio. If true, we will attempt to capture system audio via screen capture.
   * (Native WASAPI/SCK capture will be plugged in later; we keep this flag for UI control.)
   */
  enableSystemAudio?: boolean;
  /** Capture microphone audio. */
  enableMicrophone?: boolean;
  /** Translation target language for meeting-minutes WS; empty string disables translation. */
  targetLanguage?: string;
  /** Recording transcript display mode. */
  displayMode?: MeetingRecorderDisplayMode;
};
