export async function handleSopCreateNote(options: {
  payload: { action?: string; content?: string };
  sopHandledSet: Set<string>;
  createNote: (args: { content: string }) => Promise<any>;
  toast: (args: { visible: boolean; status: 'notice' | 'error'; message: string; autoHideMs: number }) => void;
}) {
  const { payload, sopHandledSet, createNote, toast } = options;
  const action = String(payload?.action || '').trim();
  const content = String(payload?.content || '').trim();
  if (!action || action !== 'create_note' || !content) return;

  const key = `${action}:${content}`;
  if (sopHandledSet.has(key)) return;
  sopHandledSet.add(key);

  try {
    const res = await createNote({ content });
    if (!res?.success) throw new Error(res?.error?.message || '创建笔记失败');
    toast({ visible: true, status: 'notice', message: '已创建笔记', autoHideMs: 1200 });
  } catch (e: any) {
    toast({
      visible: true,
      status: 'error',
      message: e?.message || '创建笔记失败',
      autoHideMs: 1600,
    });
  }
}
