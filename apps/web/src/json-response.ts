export class BackendUnavailableError extends Error {
  constructor() { super('Haven is starting or temporarily unavailable. Please try again shortly.'); }
}

export async function readApiJson(response: Response): Promise<Record<string, any>> {
  const contentType = response.headers.get('content-type') || '';
  if (!/\bapplication\/(?:[\w.-]+\+)?json\b/i.test(contentType)) throw new BackendUnavailableError();
  let data: unknown;
  try { data = await response.json(); } catch { throw new BackendUnavailableError(); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new BackendUnavailableError();
  const result = data as Record<string, any>;
  if (!response.ok) {
    if ([502, 503, 504].includes(response.status)) throw new BackendUnavailableError();
    throw new Error(typeof result.error === 'string' ? result.error : `Request failed (${response.status})`);
  }
  return result;
}
