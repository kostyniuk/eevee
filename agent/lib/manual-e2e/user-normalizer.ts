type User = { name: string; score: number };

export function normalizeUsers(users: User[]): User[] {
  users.sort((left, right) => right.score - left.score);
  for (const user of users) {
    user.name = user.name.trim();
  }
  return users;
}
