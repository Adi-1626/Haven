export const usernameCharacters = '[A-Za-z0-9_.\\-]+';
export const usernameExpression = new RegExp(`^${usernameCharacters}$`);

export function normalizeLoginUsername(username: string) {
  return username.trim().replace(/^@/, '').trim();
}

const reservedUsernames = new Set(['admin', 'administrator', 'haven', 'support', 'system', 'root', 'moderator', 'staff', 'everyone', 'here', 'null', 'undefined']);

/** Returns a user-facing problem with a chosen profile username, or null when it is acceptable. */
export function usernameProblem(value: string): string | null {
  const username = value.trim();
  if (username.length < 3) return 'Use at least 3 characters';
  if (username.length > 32) return 'Use 32 characters or fewer';
  if (!usernameExpression.test(username)) return 'Use letters, numbers, underscores, dots or hyphens';
  if (reservedUsernames.has(username.toLowerCase())) return 'That username is reserved';
  return null;
}

/** Hosted accounts start with a neutral placeholder identity until the person completes onboarding. */
export const placeholderUsername = /^user_[a-f0-9]{10}$/;
export function placeholderIdentity(userId: string) {
  return `user_${userId.replace(/[^a-f0-9]/gi, '').toLowerCase().padEnd(10, '0').slice(0, 10)}`;
}
