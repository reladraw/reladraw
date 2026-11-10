/**
 * The Markdown a description is written in: paragraphs, lists (`-`, `*` or
 * `1.`), `**bold**`, `*italic*` or `_italic_`, `` `code` `` and
 * `[text](address)`. Anything else is shown as the characters written.
 *
 * Two readings of one text: HTML for the page's panel, and plain text for an
 * SVG's hover text, which can't show formatting.
 */

type Block = { kind: 'paragraph'; lines: string[] } | { kind: 'list'; ordered: boolean; items: string[] };

const BULLET = /^\s*[-*]\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;

function blocksOf(text: string): Block[] {
  const blocks: Block[] = [];
  let open: Block | undefined;
  for (const line of text.split('\n')) {
    if (line.trim() === '') {
      open = undefined;
      continue;
    }
    const bullet = line.match(BULLET);
    const numbered = bullet ? null : line.match(NUMBERED);
    const item = bullet ?? numbered;
    if (item) {
      const ordered = numbered !== null;
      if (open?.kind !== 'list' || open.ordered !== ordered) {
        open = { kind: 'list', ordered, items: [] };
        blocks.push(open);
      }
      open.items.push(item[1]!.trim());
    } else if (open?.kind === 'list' && /^\s/.test(line)) {
      // An indented line under an item continues it.
      open.items[open.items.length - 1] += ` ${line.trim()}`;
    } else if (open?.kind === 'paragraph') {
      open.lines.push(line.trim());
    } else {
      open = { kind: 'paragraph', lines: [line.trim()] };
      blocks.push(open);
    }
  }
  return blocks;
}

const LINK = /\[([^\]]+)\]\(([^)\s]+)\)/g;

/** The addresses a description may link to: the web, mail, or a path with no scheme. */
const SAFE_ADDRESS = /^(https?:|mailto:|[^:]*$)/i;

/** Every link address in a description that the page would refuse to follow. */
export function unsafeLinks(text: string): string[] {
  return [...text.matchAll(LINK)].map((match) => match[2]!).filter((href) => !SAFE_ADDRESS.test(href));
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** One line's marks as HTML. Code is set aside first, so nothing inside it is read as a mark. */
function inlineHtml(text: string): string {
  const codes: string[] = [];
  let out = text.replace(/`([^`]+)`/g, (_, code: string) => {
    codes.push(`<code>${escapeHtml(code)}</code>`);
    return `\u0000${codes.length - 1}\u0000`;
  });
  const links: string[] = [];
  out = out.replace(LINK, (_, label: string, href: string) => {
    const safe = SAFE_ADDRESS.test(href) ? href : '#';
    links.push(`<a href="${escapeHtml(safe)}" target="_blank" rel="noopener">${marks(escapeHtml(label))}</a>`);
    return `\u0001${links.length - 1}\u0001`;
  });
  out = marks(escapeHtml(out));
  return out
    .replace(/\u0001(\d+)\u0001/g, (_, index: string) => links[Number(index)]!)
    .replace(/\u0000(\d+)\u0000/g, (_, index: string) => codes[Number(index)]!);
}

function marks(html: string): string {
  return html
    .replace(/\*\*(?=\S)(.+?)(?<=\S)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*\w])\*(?=\S)(.+?)(?<=\S)\*(?![*\w])/g, '$1<em>$2</em>')
    .replace(/(^|[^_\w])_(?=\S)(.+?)(?<=\S)_(?![_\w])/g, '$1<em>$2</em>');
}

/** A description as HTML, for the page's panel. */
export function markdownHtml(text: string): string {
  return blocksOf(text)
    .map((block) => {
      if (block.kind === 'paragraph') return `<p>${block.lines.map(inlineHtml).join(' ')}</p>`;
      const tag = block.ordered ? 'ol' : 'ul';
      return `<${tag}>${block.items.map((item) => `<li>${inlineHtml(item)}</li>`).join('')}</${tag}>`;
    })
    .join('');
}

/** A description with its marks taken out, for an SVG's hover text. A link keeps its address after its text. */
export function markdownPlain(text: string): string {
  const inline = (line: string): string =>
    line
      .replace(LINK, (_, label: string, href: string) => `${label} (${href})`)
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\*\*(?=\S)(.+?)(?<=\S)\*\*/g, '$1')
      .replace(/(^|[^*\w])\*(?=\S)(.+?)(?<=\S)\*(?![*\w])/g, '$1$2')
      .replace(/(^|[^_\w])_(?=\S)(.+?)(?<=\S)_(?![_\w])/g, '$1$2');
  return blocksOf(text)
    .map((block) =>
      block.kind === 'paragraph'
        ? block.lines.map(inline).join(' ')
        : block.items.map((item, index) => `${block.ordered ? `${index + 1}.` : '•'} ${inline(item)}`).join('\n'),
    )
    .join('\n\n');
}
