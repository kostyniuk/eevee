type User = { readonly name: string; readonly score: number };

export function normalizeUsers(users: readonly User[]): User[] {
  return users
    .map((user) => ({ ...user, name: user.name.trim() }))
    .sort((left, right) => right.score - left.score);
}
