export type RewritePipelineSuccess = {
  ok: true;
  rewritten: string;
  rawResponse: any;
};

export type RewritePipelineFailure = {
  ok: false;
  errorMessage: string;
};

export type RewritePipelineResult = RewritePipelineSuccess | RewritePipelineFailure;

export async function runRewritePipeline(options: {
  selectedText: string;
  instruction: string;
  rewriteTextRequest: (selectedText: string, instruction: string) => Promise<any>;
  normalizeText: (text: string) => string;
  showOverlay: (text: string, questionText?: string) => Promise<boolean>;
}): Promise<RewritePipelineResult> {
  const { selectedText, instruction, rewriteTextRequest, normalizeText, showOverlay } = options;
  try {
    const data = await rewriteTextRequest(selectedText, instruction);
    const rewritten = normalizeText(String(data?.result?.rewritten_text?.trim?.() || ''));
    if (!rewritten) {
      return { ok: false, errorMessage: '重写接口未返回内容' };
    }
    await showOverlay(rewritten, instruction);
    return {
      ok: true,
      rewritten,
      rawResponse: data,
    };
  } catch (e: any) {
    return {
      ok: false,
      errorMessage: e?.message || '重写失败，请重试。',
    };
  }
}
