/**
 * Match one `<url>; rel="name"` entry of a GitHub `Link` header.
 *
 * The header is a comma-separated list, but a URL may itself contain a comma
 * and a relation name may appear inside an unrelated URL. Matching the
 * bracketed URL together with the quoted relation avoids both traps, because
 * the relation can then be compared exactly instead of searched for as a
 * substring of the whole entry.
 */
const linkEntry = /<([^>]+)>\s*;\s*rel="([^"]+)"/gu;

/**
 * Read the URL of the next page out of a GitHub `Link` response header.
 *
 * GitHub paginates list endpoints with a header such as
 * `<https://api.github.com/repos/o/r/pulls?page=2>; rel="next",
 * <https://api.github.com/repos/o/r/pulls?page=9>; rel="last"`.
 */
export function nextPageUrl(linkHeader: string | null): string | null {
  if (!linkHeader) return null;
  const entry = findEntry(linkHeader, "next");
  return entry ? readUrl(entry) : null;
}

/** Return the whole `Link` entry whose relation matches exactly. */
function findEntry(linkHeader: string, rel: string): string | null {
  for (const match of linkHeader.matchAll(linkEntry)) {
    if (match[2] === rel) return match[0];
  }
  return null;
}

/** Pull the bracketed URL out of one `Link` entry. */
function readUrl(entry: string): string {
  return entry.slice(entry.indexOf("<") + 1, entry.indexOf(">"));
}
