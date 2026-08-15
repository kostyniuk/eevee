/** Build the log line recorded for an outbound API request. */
export function requestLogLine(url: string, apiKey: string): string {
  return `POST ${url} (key=${apiKey})`;
}
