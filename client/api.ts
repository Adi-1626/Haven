export async function api<Type = Record<string, unknown>>(path: string, method = 'GET', body?: unknown): Promise<Type> {
  const response = await fetch(`/api${path}`, { method, credentials: 'include', headers: body instanceof FormData ? undefined : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body) });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || `Request failed (${response.status})`);
  return result as Type;
}
