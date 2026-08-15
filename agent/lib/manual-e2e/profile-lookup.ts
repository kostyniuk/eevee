export async function loadProfiles(
  ids: readonly string[],
  load: (id: string) => Promise<string>,
): Promise<string[]> {
  const profiles: string[] = [];
  for (const id of ids) {
    profiles.push(await load(id));
  }
  return profiles;
}
