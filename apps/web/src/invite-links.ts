export function inviteCodeFromPath(pathname: string) {
  return /^\/invite\/([a-zA-Z0-9_-]{6,128})\/?$/.exec(pathname)?.[1] || null;
}

export function parseInvitation(input: string, origin: string) {
  const value = input.trim();
  if (/^[a-zA-Z0-9_-]{6,128}$/.test(value)) return { code: value, origin, url: `${origin}/invite/${value}` };
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('Enter an invite code or a complete Haven invitation link.'); }
  if (url.username || url.password || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) throw new Error('Invitation links require HTTPS, or HTTP on this computer’s localhost.');
  const code = inviteCodeFromPath(url.pathname);
  if (!code) throw new Error('That is not a community invitation. Ask for an invitation link or code.');
  return { code, origin: url.origin, url: `${url.origin}/invite/${code}` };
}

export const isLoopback = (origin: string) => ['localhost', '127.0.0.1', '[::1]'].includes(new URL(origin).hostname);

export function isCurrentInvitation(origin: string, frontendOrigin: string, apiOrigin: string) {
  return origin === new URL(frontendOrigin).origin || origin === new URL(apiOrigin || frontendOrigin).origin;
}

export function invitationHost(frontendOrigin: string, configuredPublicUrl?: string) {
  return (configuredPublicUrl || frontendOrigin).replace(/\/+$/, '');
}
