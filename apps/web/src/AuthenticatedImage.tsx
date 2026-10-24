import { useEffect, useRef, useState, type ImgHTMLAttributes } from 'react';
import { fetchResource, isApiResource, resolveApiUrl } from './api';
import { isHostedAuth } from './supabase';

type Resource = { references: number; promise: Promise<string> };
const resources = new Map<string, Resource>();

function acquire(source: string) {
  let resource = resources.get(source);
  if (!resource) {
    const entry: Resource = { references: 0, promise: Promise.resolve('') };
    entry.promise = fetchResource(source).then(response => response.blob()).then(blob => URL.createObjectURL(blob));
    resources.set(source, entry);
    resource = entry;
  }
  const entry = resource;
  entry.references++;
  return {
    promise: entry.promise,
    release() {
      if (--entry.references !== 0) return;
      resources.delete(source);
      void entry.promise.then(url => URL.revokeObjectURL(url), () => {});
    },
  };
}

// An <img> cannot attach a bearer token. Fetch protected images as blobs instead.
export function AuthenticatedImage({ src, onError, ...props }: Omit<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'onError'> & { src: string; onError?: () => void }) {
  const resolved = resolveApiUrl(src);
  const protectedImage = isHostedAuth() && isApiResource(resolved);
  const [image, setImage] = useState<{ source: string; url: string } | null>(null);
  const failure = useRef(onError);
  failure.current = onError;
  useEffect(() => {
    if (!protectedImage) return;
    let active = true;
    const resource = acquire(resolved);
    void resource.promise.then(url => { if (active) setImage({ source: resolved, url }); }, () => { if (active) failure.current?.(); });
    return () => { active = false; resource.release(); };
  }, [resolved, protectedImage]);
  return <img {...props} src={protectedImage ? (image?.source === resolved ? image.url : undefined) : resolved} onError={onError} />;
}
