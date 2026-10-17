/**
 * Unified, reliable clipboard utility for Haven.
 * Supports:
 * 1. Electron native clipboard via secure IPC bridge (window.haven.writeClipboard).
 * 2. Modern browser Clipboard API (navigator.clipboard.writeText) in secure contexts.
 * 3. Graceful fallback using document.execCommand('copy') in insecure contexts/older webviews.
 */

export async function writeTextToClipboard(text: string): Promise<boolean> {
  if (typeof text !== 'string') {
    return false;
  }

  // 1. Electron desktop bridge (narrowly scoped and secure)
  if (typeof window !== 'undefined' && window.haven?.writeClipboard) {
    try {
      const result = await window.haven.writeClipboard(text);
      if (result) return true;
    } catch {
      // Fall through to browser methods if desktop bridge fails
    }
  }

  // 2. Standard navigator.clipboard API in secure contexts
  if (
    typeof navigator !== 'undefined' &&
    navigator.clipboard &&
    typeof navigator.clipboard.writeText === 'function'
  ) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to execCommand fallback
    }
  }

  // 3. Fallback for insecure contexts or when Clipboard API is denied
  if (typeof document !== 'undefined') {
    try {
      const activeElement = document.activeElement as HTMLElement | null;
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.setAttribute('readonly', '');
      textarea.style.position = 'fixed';
      textarea.style.top = '-9999px';
      textarea.style.left = '-9999px';
      textarea.style.opacity = '0';
      textarea.style.pointerEvents = 'none';

      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();

      const successful = document.execCommand('copy');
      document.body.removeChild(textarea);

      // Restore previously focused element
      if (activeElement && typeof activeElement.focus === 'function') {
        activeElement.focus();
      }

      if (successful) return true;
    } catch {
      // execCommand failed
    }
  }

  return false;
}

export async function copyWithFeedback(
  text: string,
  label: string,
  notify?: (message: string) => void,
  onSuccess?: () => void,
  onError?: (message: string) => void,
): Promise<boolean> {
  const success = await writeTextToClipboard(text);
  if (success) {
    const successMsg = label ? `${label} copied!` : 'Copied!';
    notify?.(successMsg);
    onSuccess?.();
    return true;
  } else {
    const errorMsg = label
      ? `Could not copy ${label.toLowerCase()}. Clipboard access was denied.`
      : 'Could not copy to clipboard. Clipboard access was denied.';
    notify?.(errorMsg);
    onError?.(errorMsg);
    return false;
  }
}
