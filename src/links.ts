/**
 * A node's or a line's links. `url:` takes one address or several, each with
 * an optional name and badge: `url: "https://github.com/…" (name: "GitHub",
 * icon: "GH" (fill: #24292f, text: white))`. The parser keeps the first
 * address under `url`, so everything that follows a single link follows the
 * first of several, and the whole list under `url.links` when there is more
 * to say than one bare address.
 */

import type { Attrs } from './ast.js';

export const LINKS_KEY = 'url.links';

/** A link's badge: letters in a small circle, or a picture reladraw knows. */
export type LinkIcon = { letters: string; fill?: string; text?: string } | { picture: string };

export interface Link {
  href: string;
  name?: string;
  icon?: LinkIcon;
}

/** Every link a thing carries, in the order the source writes them. */
export function linksOf(attrs: Attrs): Link[] | undefined {
  const listed = attrs[LINKS_KEY];
  if (listed !== undefined) return JSON.parse(listed) as Link[];
  const url = attrs['url'];
  return url === undefined ? undefined : [{ href: url }];
}

/**
 * What a reader is shown for a link: its name, or its site's address without
 * the path. Two unnamed links to one site would read the same, so among
 * `others` that share its site a link shows its whole address after the scheme.
 */
export function linkLabel(link: Link, others: readonly Link[] = []): string {
  if (link.name !== undefined) return link.name;
  const host = hostOf(link.href);
  if (host === undefined) return link.href;
  const shared = others.some((other) => other !== link && other.name === undefined && hostOf(other.href) === host);
  return shared ? link.href.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '') : host;
}

function hostOf(href: string): string | undefined {
  return href.match(/^[a-z][a-z0-9+.-]*:\/\/([^/?#]+)/i)?.[1];
}
