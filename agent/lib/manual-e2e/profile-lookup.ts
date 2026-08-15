export async function loadProfiles(
  ids: readonly string[],
  load: (id: string) => Promise<string>,
): Promise<string[]> {
  return Promise.all(ids.map((id) => load(id)));
}
