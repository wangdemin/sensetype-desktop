export type Word = { text: string; start: number; end: number };

export type Segment = {
  id: string;
  speakerId: string;
  text: string;
  translation?: string;
  start: number;
  end: number;
  words: Word[];
};

export type SummaryTopic = { header: string; items: string[]; isMuted?: boolean };
