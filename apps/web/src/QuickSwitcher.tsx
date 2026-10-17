import { useState } from 'react';
import { Hash, MessageCircle, Search } from 'lucide-react';
import type { Bootstrap } from '@haven/shared/types';
import { Modal } from './components';

export default function QuickSwitcher({ data, onSelect, onClose }: { data: Bootstrap; onSelect: (selection: { channelId: string } | { conversationId: string }, serverId: string | null) => void; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const users = Object.fromEntries(data.users.map(user => [user.id, user]));
  const choices = [
    ...data.channels.filter(channel => channel.type === 'text').map(channel => ({ id: channel.id, name: channel.name, detail: data.servers.find(server => server.id === channel.serverId)?.name || '', selection: { channelId: channel.id }, serverId: channel.serverId })),
    ...data.conversations.map(conversation => ({ id: conversation.id, name: conversation.name || conversation.memberIds.filter(id => id !== data.user.id).map(id => users[id]?.displayName || users[id]?.username || 'Unknown user').join(', '), detail: 'Direct message', selection: { conversationId: conversation.id }, serverId: null })),
  ].filter(item => `${item.name} ${item.detail}`.toLowerCase().includes(query.toLowerCase()));
  const select = (item: typeof choices[number]) => { onSelect(item.selection, item.serverId); onClose(); };
  return <Modal title="Jump to a conversation" onClose={onClose}>
    <div className="quick-search"><Search size={18} /><input aria-label="Find a conversation" autoFocus placeholder="Search channels and conversations…" value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && choices[0]) select(choices[0]); }} /></div>
    <div className="quick-results">{choices.length ? choices.slice(0, 30).map(item => <button key={item.id} onClick={() => select(item)}>{'channelId' in item.selection ? <Hash size={19} /> : <MessageCircle size={19} />}<span>{item.name}<small>{item.detail}</small></span></button>) : <p className="quiet">No conversations found. Create a server or message a friend to get started.</p>}</div>
  </Modal>;
}
