import type { NoteItem } from '@/services/notes/types';

export type NoteWithMeta = NoteItem & {
  title?: string;
  status?: string;
  created_at?: number | string;
  updated_at?: number | string;
};

export type NotesLayout = 'one' | 'two' | 'three';
