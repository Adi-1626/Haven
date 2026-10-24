import { useState } from 'react';
import { LogOut, Settings } from 'lucide-react';
import type { Conversation } from '@haven/shared/types';
import { Modal } from './components';
import { api } from './api';
import { ConfirmDialog } from './ZenithDialog';

export default function ConversationOptions({ conversation, onChanged, onLeft }: { conversation: Conversation; onChanged: () => void; onLeft: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(conversation.name);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);

  async function run(operation: () => Promise<void>) {
    setBusy(true); setError('');
    try { await operation(); } catch (failure) { setError((failure as Error).message); }
    finally { setBusy(false); }
  }

  return <>
    <button className="icon-button" title="Conversation settings" aria-label="Conversation settings" onClick={() => { setOpen(true); setName(conversation.name); }}><Settings size={19} /></button>
    {open && <Modal title="Conversation settings" onClose={() => setOpen(false)}>
      <form className="simple-form" onSubmit={event => { event.preventDefault(); void run(async () => { await api(`/conversations/${conversation.id}`, 'PATCH', { name }); onChanged(); setOpen(false); }); }}>
        <p className="quiet">{conversation.memberIds.length} people in this conversation.</p>
        <label>CONVERSATION NAME<input name="name" value={name} maxLength={80} required onChange={event => setName(event.target.value)} /></label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="form-actions">
          <button
            className="secondary danger"
            type="button"
            disabled={busy}
            onClick={() => setShowLeaveConfirm(true)}
          >
            <LogOut size={14} />Leave
          </button>
          <button className="primary" disabled={busy}>Save name</button>
        </div>
      </form>
    </Modal>}

    {showLeaveConfirm && (
      <ConfirmDialog
        open={true}
        title="Leave conversation"
        message="Are you sure you want to leave this conversation? You will lose access to its message history."
        confirmLabel="Leave conversation"
        variant="danger"
        icon={<LogOut size={20} />}
        onCancel={() => setShowLeaveConfirm(false)}
        onConfirm={async () => {
          await api(`/conversations/${conversation.id}/members/me`, 'DELETE');
          setShowLeaveConfirm(false);
          setOpen(false);
          onLeft();
        }}
      />
    )}
  </>;
}
