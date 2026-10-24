import { useEffect, useRef, useState } from 'react';
import { normalizeLocalShortcut, shortcutFromKeyboard } from './shortcuts';

const modifierNames = ['Control', 'Alt', 'Shift', 'Meta'];

/**
 * Records a physical-key shortcut. `requireModifier` is for OS hotkeys (mute/deafen); without it a bare key
 * or a lone modifier key (for example Right Control) is accepted, which push-to-talk supports.
 */
export function ShortcutRecorder({ label, value, onChange, disabled, global = false, requireModifier = false }: { label: string; value: string; onChange: (shortcut: string) => void; disabled?: boolean; global?: boolean; requireModifier?: boolean }) {
  const [recording, setRecording] = useState(false);
  const [display, setDisplay] = useState('');
  const [error, setError] = useState('');
  const cleanup = useRef<() => void>(() => {});
  const generation = useRef(0);
  useEffect(() => () => { generation.current++; cleanup.current(); }, []);
  const start = async () => {
    if (recording || disabled) return;
    cleanup.current();
    const current = ++generation.current;
    let active = true;
    let candidate = '';
    let candidateCode = '';
    let keyReleased = false;
    let usedKey = false;
    const modifiersSeen = new Set<string>();
    const finish = () => {
      if (!active) return;
      active = false;
      generation.current++;
      window.removeEventListener('keydown', keydown, true);
      window.removeEventListener('keyup', keyup, true);
      window.removeEventListener('blur', finish);
      window.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('haven:shortcut-recording-start', superseded);
      window.dispatchEvent(new CustomEvent('haven:shortcut-recording', { detail: { active: false } }));
      void window.haven?.setShortcutRecording(false).catch(() => {});
      setRecording(false);
    };
    const superseded = () => finish();
    const outside = (event: PointerEvent) => { if (!(event.target instanceof Element) || !event.target.closest('[data-shortcut-recorder]')) finish(); };
    const keydown = (event: KeyboardEvent) => {
      event.preventDefault(); event.stopImmediatePropagation();
      if (event.repeat) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        (window as unknown as { __havenShortcutCancelledAt?: number }).__havenShortcutCancelledAt = Date.now();
        finish();
        return;
      }
      if (candidate) return;
      setError('');
      setDisplay([event.ctrlKey && 'Control', event.altKey && 'Alt', event.shiftKey && 'Shift'].filter(Boolean).join('+'));
      if (modifierNames.includes(event.key)) { modifiersSeen.add(event.code); return; }
      usedKey = true;
      try {
        const shortcut = shortcutFromKeyboard(event);
        if (!shortcut) return;
        const normalized = normalizeLocalShortcut(shortcut, { modifierOnly: !requireModifier });
        if (requireModifier && !event.ctrlKey && !event.altKey && !event.shiftKey) throw new Error('Global mute and deafen shortcuts need Control, Alt or Shift and one other key');
        candidate = global ? normalized.replace(/Arrow(Up|Down|Left|Right)$/, '$1') : normalized;
        candidateCode = event.code;
        setDisplay(`${candidate} — release keys to finish`);
      } catch (caught) { setError(caught instanceof Error ? caught.message : 'Unsupported shortcut'); }
    };
    const keyup = (event: KeyboardEvent) => {
      event.preventDefault(); event.stopImmediatePropagation();
      if (!candidate && modifierNames.includes(event.key)) {
        // Pressing and releasing exactly one modifier, with no other key, selects that modifier key.
        if (!requireModifier && !usedKey && modifiersSeen.size === 1 && modifiersSeen.has(event.code) && event.key !== 'Meta') {
          try { candidate = normalizeLocalShortcut(event.code); } catch (caught) { setError(caught instanceof Error ? caught.message : 'Unsupported shortcut'); }
          if (candidate && !event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey) { onChange(candidate); finish(); return; }
        }
        if (!event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey) { modifiersSeen.clear(); setDisplay('Press a key combination…'); }
        return;
      }
      if (event.code === candidateCode) keyReleased = true;
      if (candidate && keyReleased && !event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey) { onChange(candidate); finish(); }
    };
    cleanup.current = finish;
    window.dispatchEvent(new Event('haven:shortcut-recording-start'));
    window.addEventListener('haven:shortcut-recording-start', superseded);
    window.addEventListener('blur', finish);
    window.addEventListener('pointerdown', outside, true);
    window.dispatchEvent(new CustomEvent('haven:shortcut-recording', { detail: { active: true } }));
    setRecording(true); setError(''); setDisplay('Preparing recorder…');
    try {
      await window.haven?.setShortcutRecording(true);
      if (!active || current !== generation.current) return;
      setDisplay('Press a key combination…');
      window.addEventListener('keydown', keydown, true);
      window.addEventListener('keyup', keyup, true);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not pause shortcuts'); finish(); }
  };
  return <div className="shortcut-field" data-shortcut-recorder="true">
    <span>{label}</span>
    <div className="shortcut-controls"><button type="button" aria-label={label} aria-pressed={recording} disabled={disabled} onClick={() => recording ? cleanup.current() : void start()}>{recording ? display : value || 'Not set — click to record'}</button><button type="button" aria-label={`Clear ${label.toLowerCase()}`} disabled={disabled || recording || !value} onClick={() => onChange('')}>Clear</button></div>
    {recording && <small role="status">Recording. Release every key to finish{requireModifier ? '' : '; pressing a single modifier on its own records that modifier key'}. Escape cancels; clicking again or leaving this window cancels.</small>}
    {error && <p className="error" role="alert">{error}</p>}
  </div>;
}
