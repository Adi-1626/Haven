export const usernameCharacters = '[A-Za-z0-9_.\\-]+';
export const usernameExpression = new RegExp(`^${usernameCharacters}$`);

export function normalizeLoginUsername(username: string) {
  return username.trim().replace(/^@/, '').trim();
}
