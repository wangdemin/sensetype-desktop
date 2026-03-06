import styles from './index.module.scss';

type Block =
  | { type: 'heading'; level?: number; content?: unknown }
  | { type: 'list'; style?: unknown; items?: unknown }
  | { type: 'table'; headers?: unknown; rows?: unknown }
  | { type: string; [k: string]: unknown };

type NodeKind = 'heading' | 'text' | 'table';

type TreeNode = {
  id: string;
  depth: number;
  kind: NodeKind;
  headingLevel?: number;
  content: string;
  table?: { headers: string[]; rows: string[][] };
  isListItem?: boolean;
};

function safeString(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function getBlocks(raw: unknown): Block[] {
  const r = raw as any;
  const blocks =
    r?.result?.structured_content?.blocks ??
    r?.structured_content?.blocks ??
    r?.result?.blocks ??
    r?.blocks;
  return Array.isArray(blocks) ? (blocks as Block[]) : [];
}

function parseTable(block: any): { headers: string[]; rows: string[][] } | null {
  const headers = Array.isArray(block?.headers)
    ? block.headers.map((h: any) => safeString(h?.content || h)).filter(Boolean)
    : [];
  const rows = Array.isArray(block?.rows)
    ? block.rows.map((row: any[]) =>
        Array.isArray(row) ? row.map((c: any) => safeString(c?.content || c)) : [],
      )
    : [];
  if (!headers.length && !rows.length) return null;
  return { headers, rows };
}

function pushListItems(
  out: TreeNode[],
  items: any[],
  depth: number,
  parentId: string,
  prefix: string,
) {
  items.forEach((it, idx) => {
    const id = `${parentId}${prefix}${idx}`;
    const content = safeString(it?.content || it?.text || it).trim();
    if (content) {
      out.push({ id, depth, kind: 'text', content, isListItem: true });
    }
    const children = Array.isArray(it?.children) ? it.children : [];
    if (children.length) pushListItems(out, children, depth + 1, id, '-');
  });
}

function buildTreeNodes(blocks: Block[]): TreeNode[] {
  const out: TreeNode[] = [];
  const headingStack: Array<{ level: number; id: string; depth: number }> = [];

  const getParent = (level: number) => {
    while (headingStack.length && headingStack[headingStack.length - 1]!.level >= level) {
      headingStack.pop();
    }
    return headingStack[headingStack.length - 1] ?? null;
  };

  blocks.forEach((b, i) => {
    const type = safeString((b as any)?.type);
    if (type === 'heading') {
      const level = Number((b as any)?.level || 1) || 1;
      const content = safeString((b as any)?.content).trim();
      if (!content) return;
      const parent = getParent(level);
      const depth = parent ? parent.depth + 1 : 0;
      const id = `h-${i}-${level}`;
      out.push({ id, depth, kind: 'heading', headingLevel: level, content });
      headingStack.push({ level, id, depth });
      return;
    }

    const parent = headingStack[headingStack.length - 1] ?? null;
    const baseDepth = parent ? parent.depth + 1 : 0;
    const baseId = parent ? parent.id : 'root';

    if (type === 'list') {
      const items = Array.isArray((b as any)?.items) ? (b as any).items : [];
      if (!items.length) return;
      pushListItems(out, items, baseDepth, `l-${i}-${baseId}`, '.');
      return;
    }

    if (type === 'table') {
      const t = parseTable(b);
      if (!t) return;
      out.push({
        id: `t-${i}-${baseId}`,
        depth: baseDepth,
        kind: 'table',
        content: '表格',
        table: t,
      });
      return;
    }

    // fallback: show any plain content field
    const content = safeString((b as any)?.content).trim();
    if (content) out.push({ id: `x-${i}-${baseId}`, depth: baseDepth, kind: 'text', content });
  });

  return out;
}

export default function StructuredMinutesView(props: { raw?: unknown; fallbackText?: string }) {
  const blocks = getBlocks(props.raw);
  const nodes = blocks.length ? buildTreeNodes(blocks) : [];

  if (!nodes.length) {
    return <div className={styles.muted}>{props.fallbackText || '暂无结构化内容'}</div>;
  }

  return (
    <div className={styles.container}>
      {nodes.map((n) => {
        // Simple indentation logic: 20px per depth level
        const pad = Math.min(8, Math.max(0, n.depth)) * 20;
        const heading = n.kind === 'heading';

        let headingClass = '';
        if (heading) {
          const lvl = n.headingLevel ?? 1;
          if (lvl === 1) headingClass = styles.h1;
          else if (lvl === 2) headingClass = styles.h2;
          else if (lvl === 3) headingClass = styles.h3;
          else headingClass = styles.h4;
        }

        return (
          <div key={n.id} className={styles.nodeRow} data-kind={n.kind} data-depth={n.depth}>
            <div className={styles.indent} style={{ width: pad }} aria-hidden="true" />
            <div className={styles.content}>
              {heading ? (
                <div className={`${styles.heading} ${headingClass}`}>{n.content}</div>
              ) : (
                <div className={`${styles.bodyText} ${n.isListItem ? styles.listItem : ''}`}>
                  {n.content}
                </div>
              )}
              {n.kind === 'table' && n.table ? (
                <div style={{ overflowX: 'auto' }}>
                  <table className={styles.table}>
                    {n.table.headers.length ? (
                      <thead>
                        <tr>
                          {n.table.headers.map((h, idx) => (
                            <th key={idx}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                    ) : null}
                    <tbody>
                      {n.table.rows.map((row, r) => (
                        <tr key={r}>
                          {row.map((c, cidx) => (
                            <td key={cidx}>{c}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}
