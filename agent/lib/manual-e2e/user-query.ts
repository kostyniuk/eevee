export type UserQuery = {
  readonly text: string;
  readonly values: readonly [string];
};

export function findUserQuery(displayName: string): UserQuery {
  return {
    text: "SELECT id, display_name FROM users WHERE display_name = $1",
    values: [displayName],
  };
}
