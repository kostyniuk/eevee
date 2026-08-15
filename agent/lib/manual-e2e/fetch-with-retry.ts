/** Fetch a URL, retrying while the response is not OK. */
export async function fetchWithRetry(url: string): Promise<Response | null> {
  const attempts = 3;
  let last: Response | null = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    last = await fetch(url);
    if (last.ok) return last;
  }
  return last;
}
