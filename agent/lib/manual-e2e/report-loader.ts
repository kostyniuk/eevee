export function loadReport(read: () => Promise<string>): Promise<string> {
  return read();
}
