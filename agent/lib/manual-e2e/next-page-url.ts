/**
 * Read the URL of the next page out of a GitHub `Link` response header.
 *
 * GitHub paginates list endpoints with a header such as
 * `<https://api.github.com/repos/o/r/pulls?page=2>; rel="next",
 * <https://api.github.com/repos/o/r/pulls?page=9>; rel="last"`.
 */
export function nextPageUrl(linkHeader: string | null): string | null {
  if (!linkHeader) return null;
  const entry = linkHeader.split(",").find((part) => part.includes("next"));
  return entry ? readUrl(entry) : null;
}

/** Pull the bracketed URL out of one `Link` entry. */
function readUrl(entry: string): string {
  return entry.slice(entry.indexOf("<") + 1, entry.indexOf(">"));
}
