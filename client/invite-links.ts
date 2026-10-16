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
  if (!code) throw new Error('That is a host address, not a community invitation. Use “Connect to a Haven host”, or ask for a link containing /invite/.');
  return { code, origin: url.origin, url: `${url.origin}/invite/${code}` };
}

export const isLoopback = (origin: string) => ['localhost', '127.0.0.1', '[::1]'].includes(new URL(origin).hostname);
