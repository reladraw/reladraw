import { SourceError } from './errors.js';

export interface Token {
  text: string;
  /** True when the token came from a quoted string, so `foo:` inside it is literal. */
  quoted: boolean;
}

/**
 * Split one line into tokens. Whitespace separates; double quotes group, with
 * `\"` and `\\` as the only escapes. A `//` outside quotes starts a comment and
 * runs to the end of the line, so a comment may trail a statement.
 *
 * A lone `/` is an ordinary character, which keeps a path or a ratio writable
 * unquoted. `#` is ordinary too: it opens a hex color, which is why comments
 * are spelled `//` rather than the `#` an earlier version used.
 *
 * Parentheses group the modifiers on a placement — `left of hub (gap: wide)` —
 * and are tokens in their own right so that `(gap:` does not read as one word
 * ending in a colon. They are deliberately *not* punctuation everywhere: an
 * opening bracket counts only where a token starts, and a closing one only
 * while a group is open, so an unquoted `rgb(20,20,20)` stays a single token.
 *
 * Returns an empty array for a blank or comment-only line.
 */
export function tokenizeLine(line: string, lineNumber: number): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  let depth = 0;

  while (i < line.length) {
    const ch = line[i]!;

    if (ch === ' ' || ch === '\t') {
      i += 1;
      continue;
    }

    if (ch === '/' && line[i + 1] === '/') break;

    if (ch === '(') {
      depth += 1;
      tokens.push({ text: '(', quoted: false });
      i += 1;
      continue;
    }

    if (ch === ')' && depth > 0) {
      depth -= 1;
      tokens.push({ text: ')', quoted: false });
      i += 1;
      continue;
    }

    if (ch === '"') {
      let text = '';
      i += 1;
      let closed = false;
      while (i < line.length) {
        const c = line[i]!;
        if (c === '\\' && i + 1 < line.length) {
          const next = line[i + 1]!;
          // `\/` is the one escape that must survive tokenizing. The line break
          // it escapes is not resolved until `splitLines`, long after this, so
          // collapsing it to a bare `/` here would lose the fact that the
          // author asked for a literal. Every other escape resolves now.
          text += next === '/' ? '\\/' : next;
          i += 2;
          continue;
        }
        if (c === '"') {
          closed = true;
          i += 1;
          break;
        }
        text += c;
        i += 1;
      }
      if (!closed) throw new SourceError('unterminated string', lineNumber);
      tokens.push({ text, quoted: true });
      continue;
    }

    let text = '';
    while (i < line.length) {
      const c = line[i]!;
      if (c === ' ' || c === '\t' || c === '"') break;
      if (c === '/' && line[i + 1] === '/') break;
      if (c === ')' && depth > 0) break;
      text += c;
      i += 1;
    }
    tokens.push({ text, quoted: false });
  }

  return tokens;
}

/** A bare token ending in `:` opens the attribute section of a statement. */
export function isAttrKey(token: Token): boolean {
  return !token.quoted && token.text.length > 1 && token.text.endsWith(':');
}
