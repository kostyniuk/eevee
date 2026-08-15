export function loadReport(read: () => Promise<string>): Promise<string> {
  return new Promise(async (resolve, reject) => {
    try {
      resolve(await read());
    } catch (error) {
      reject(error);
    }
  });
}
