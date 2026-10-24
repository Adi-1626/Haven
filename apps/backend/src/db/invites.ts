import type { InviteRow } from './types.js';

export class InviteUnavailableError extends Error {
  constructor(public status: 404 | 410, message: string) { super(message); }
}

// Call inside the membership transaction, after acquiring its write/row lock.
export function assertActiveInvite(invite: InviteRow | undefined): asserts invite is InviteRow {
  if (!invite || invite.revokedAt !== null) {
    throw new InviteUnavailableError(404, 'Invite is invalid or has been revoked');
  }
  if (invite.expiresAt !== null && invite.expiresAt <= Date.now()) {
    throw new InviteUnavailableError(410, 'This invite has expired. Ask for a new invitation.');
  }
}
