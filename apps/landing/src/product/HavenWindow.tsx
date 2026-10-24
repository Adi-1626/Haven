import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react';
import {
  Hash,
  HeadphoneOff,
  Headphones,
  Maximize2,
  Mic,
  MicOff,
  Minimize2,
  MonitorUp,
  PhoneOff,
  Plus,
  SendHorizontal,
  Smile,
  Volume2,
} from 'lucide-react';
import { SharedScreen } from './SharedScreen';

export type Scene = 'chat' | 'voice' | 'share';

type PersonId = 'mia' | 'theo' | 'jun' | 'you';
const PEOPLE: Record<PersonId, { name: string; tone: string }> = {
  mia: { name: 'Mia', tone: 'lavender' },
  theo: { name: 'Theo', tone: 'emerald' },
  jun: { name: 'Jun', tone: 'peach' },
  you: { name: 'You', tone: 'sky' },
};

interface Reaction {
  emoji: string;
  label: string;
  count: number;
  mine: boolean;
}

interface Message {
  id: number;
  author: PersonId | null;
  time: string;
  text: string;
  reactions: Reaction[];
}

const INITIAL_MESSAGES: Message[] = [
  { id: 1, author: 'mia', time: '21:04', text: 'Playtest tonight? I pushed the new lighting pass.', reactions: [{ emoji: '🔥', label: 'fire', count: 2, mine: false }] },
  { id: 2, author: 'theo', time: '21:05', text: 'In. Give me ten minutes to grab food.', reactions: [] },
  { id: 3, author: 'jun', time: '21:06', text: 'Hop in Lounge whenever, Mia and I are already there.', reactions: [{ emoji: '👍', label: 'thumbs up', count: 1, mine: false }] },
];

function Avatar({ person, speaking = false, size = 'md' }: { person: PersonId; speaking?: boolean; size?: 'sm' | 'md' | 'lg' }) {
  const { name, tone } = PEOPLE[person];
  return (
    <span className={`hw-avatar hw-avatar-${size} tone-${tone}${speaking ? ' is-speaking' : ''}`} aria-hidden="true">
      {name.slice(0, 1)}
    </span>
  );
}

// The sample evening carries on from the seeded messages rather than using the visitor's clock.
let sampleMinute = 21 * 60 + 7;
const clock = () => {
  const minute = sampleMinute++;
  return `${String(Math.floor(minute / 60) % 24).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
};

/**
 * A local, interactive replica of Haven's main window. Nothing here is connected: messages, voice and
 * the shared screen are sample state that lives in this component.
 */
export function HavenWindow({ scene, onSceneChange, active }: { scene: Scene; onSceneChange(scene: Scene): void; active: boolean }) {
  const [messages, setMessages] = useState(INITIAL_MESSAGES);
  const [draft, setDraft] = useState('');
  const [muted, setMuted] = useState(false);
  const [deafened, setDeafened] = useState(false);
  const [focus, setFocus] = useState(false);
  const [speaker, setSpeaker] = useState<PersonId | null>('jun');
  const [typing, setTyping] = useState<PersonId | null>(null);
  const [theoInVoice, setTheoInVoice] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const nextId = useRef(100);
  const timers = useRef<number[]>([]);
  const replied = useRef(false);
  const logRef = useRef<HTMLDivElement>(null);
  const inputId = useId();
  const inVoice = scene !== 'chat';
  const sharing = scene === 'share';

  const later = useCallback((fn: () => void, ms: number) => {
    timers.current.push(window.setTimeout(fn, ms));
  }, []);
  useEffect(() => () => timers.current.forEach(timer => window.clearTimeout(timer)), []);

  const post = useCallback((author: PersonId | null, text: string) => {
    setMessages(list => [...list.slice(-11), { id: nextId.current++, author, time: clock(), text, reactions: [] }]);
  }, []);

  // React to scene changes the way the real app would: system lines, someone joining, a reply.
  const previous = useRef<Scene>(scene);
  useEffect(() => {
    const before = previous.current;
    previous.current = scene;
    if (before === scene) return;
    if (before === 'chat' && scene !== 'chat') {
      post(null, 'You joined Lounge');
      setAnnouncement('Joined the Lounge voice room. Sample only, no microphone is used.');
      if (!theoInVoice) later(() => { setTheoInVoice(true); post(null, 'Theo joined Lounge'); }, 2200);
    }
    if (scene === 'chat' && before !== 'chat') {
      post(null, 'You left Lounge');
      setAnnouncement('Left the voice room.');
      setFocus(false);
    }
    if (scene === 'share') {
      post(null, 'You started sharing “Level 03 — blockout”');
      setAnnouncement('Sharing a sample screen with the voice room.');
      if (!replied.current) {
        replied.current = true;
        later(() => setTyping('theo'), 1300);
        later(() => {
          setTyping(null);
          post('theo', 'oh the fog reads so much better now');
        }, 3200);
      }
    }
    if (before === 'share' && scene !== 'share') {
      post(null, 'You stopped sharing');
      setFocus(false);
    }
  }, [scene, post, later, theoInVoice]);

  // Gentle, scripted conversation in the room while it's on screen. No audio, no microphone.
  useEffect(() => {
    if (!inVoice || !active || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const order: Array<PersonId | null> = ['jun', null, 'mia', 'mia', null, 'theo', 'jun', null];
    let step = 0;
    const timer = window.setInterval(() => {
      step = (step + 1) % order.length;
      const next = order[step];
      setSpeaker(next === 'theo' && !theoInVoice ? null : next);
    }, 1150);
    return () => window.clearInterval(timer);
  }, [inVoice, active, theoInVoice]);

  useEffect(() => {
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [messages, typing, scene]);

  const send = (event: FormEvent) => {
    event.preventDefault();
    const text = draft.trim().slice(0, 240);
    if (!text) return;
    post('you', text);
    setDraft('');
  };

  const toggleReaction = (id: number, emoji: string) => {
    setMessages(list => list.map(message => message.id !== id ? message : {
      ...message,
      reactions: message.reactions.map(r => r.emoji !== emoji ? r : { ...r, mine: !r.mine, count: r.count + (r.mine ? -1 : 1) }),
    }));
  };

  const addReaction = (id: number) => {
    setMessages(list => list.map(message => {
      if (message.id !== id) return message;
      const existing = message.reactions.find(r => r.emoji === '💜');
      if (existing) return message;
      return { ...message, reactions: [...message.reactions, { emoji: '💜', label: 'purple heart', count: 1, mine: true }] };
    }));
  };

  const roster: PersonId[] = ['mia', 'jun', ...(theoInVoice ? ['theo' as const] : []), ...(inVoice ? ['you' as const] : [])];
  const speaking = (person: PersonId) => inVoice && !deafened && speaker === person;
  const youMuted = muted || deafened;

  return (
    <div className={`haven-window scene-${scene}${focus ? ' is-focus' : ''}`}>
      <p className="sr-only" aria-live="polite">{announcement}</p>
      <div className="hw-rail" aria-hidden="true">
        <img className="hw-rail-logo" src="/brand/mark.webp" srcSet="/brand/mark.webp 1x, /brand/mark@2x.webp 2x" alt="" width="28" height="28" />
        <span className="hw-rail-sep" />
        <span className="hw-server is-active">NO</span>
        <span className="hw-server">🎨</span>
        <span className="hw-server">⚡</span>
        <span className="hw-server hw-server-add"><Plus size={16} strokeWidth={1.75} /></span>
      </div>

      <aside className="hw-sidebar" aria-label="Sample server channels">
        <p className="hw-server-name">Night Owls</p>
        <p className="hw-group">Text channels</p>
        <ul className="hw-channels">
          <li><span className="hw-channel is-active"><Hash size={15} strokeWidth={1.75} aria-hidden="true" />general</span></li>
          <li><span className="hw-channel"><Hash size={15} strokeWidth={1.75} aria-hidden="true" />screenshots</span></li>
          <li><span className="hw-channel"><Hash size={15} strokeWidth={1.75} aria-hidden="true" />plans</span></li>
        </ul>
        <p className="hw-group">Voice channels</p>
        <ul className="hw-channels">
          <li>
            <button
              type="button"
              className={`hw-channel hw-voice-channel${inVoice ? ' is-joined' : ''}`}
              aria-pressed={inVoice}
              onClick={() => onSceneChange(inVoice ? 'chat' : 'voice')}
            >
              <Volume2 size={15} strokeWidth={1.75} aria-hidden="true" />
              Lounge
              <span className="hw-channel-meta">{inVoice ? 'Connected' : 'Join'}</span>
            </button>
            <ul className="hw-roster" aria-label="In Lounge">
              {roster.map(person => (
                <li key={person} className={speaking(person) ? 'is-speaking' : undefined}>
                  <Avatar person={person} size="sm" speaking={speaking(person)} />
                  {PEOPLE[person].name}
                  {person === 'you' && sharing && <span className="hw-live">Live</span>}
                  {person === 'you' && youMuted && <MicOff className="hw-roster-icon" size={13} strokeWidth={1.75} aria-label="muted" />}
                </li>
              ))}
            </ul>
          </li>
          <li><span className="hw-channel"><Volume2 size={15} strokeWidth={1.75} aria-hidden="true" />Game night</span></li>
        </ul>
        <div className="hw-user">
          <Avatar person="you" size="sm" />
          <span className="hw-user-name">You<small>{inVoice ? 'In Lounge' : 'Online'}</small></span>
        </div>
      </aside>

      <div className="hw-main">
        <div className="hw-topbar">
          <span className="hw-topbar-title"><Hash size={17} strokeWidth={1.75} aria-hidden="true" />general</span>
          {inVoice && (
            <span className="hw-topbar-voice">
              <span className="live-dot" aria-hidden="true" />
              Lounge · {roster.length} in voice
            </span>
          )}
        </div>

        <div className="hw-body">
          <section className="hw-stage" aria-label="Voice room" hidden={!inVoice}>
            {sharing && (
              <figure className="hw-share">
                <figcaption className="hw-share-bar">
                  <span><span className="hw-rec" aria-hidden="true" />Your screen · Level 03 — blockout</span>
                  <button type="button" className="hw-chip-button" aria-pressed={focus} onClick={() => setFocus(f => !f)}>
                    {focus ? <Minimize2 size={14} strokeWidth={1.75} aria-hidden="true" /> : <Maximize2 size={14} strokeWidth={1.75} aria-hidden="true" />}
                    {focus ? 'Show people' : 'Focus'}
                  </button>
                </figcaption>
                <div className="hw-share-frame"><SharedScreen /></div>
              </figure>
            )}
            <ul className="hw-tiles" aria-label="Participants">
              {roster.map(person => (
                <li key={person} className={`hw-tile${speaking(person) ? ' is-speaking' : ''}`}>
                  <Avatar person={person} size="lg" speaking={speaking(person)} />
                  <span className="hw-tile-name">
                    {PEOPLE[person].name}
                    {person === 'you' && youMuted && <MicOff size={12} strokeWidth={2} aria-label="muted" />}
                  </span>
                  {speaking(person) && <span className="sr-only">speaking</span>}
                </li>
              ))}
            </ul>
            <div className="hw-dock" role="toolbar" aria-label="Voice controls (sample)">
              <span className="hw-dock-status">
                <span className="live-dot" aria-hidden="true" />
                <span><strong>Lounge</strong><small>Voice connected</small></span>
              </span>
              <button type="button" className={`hw-icon-button${muted ? ' is-off' : ''}`} aria-pressed={muted} onClick={() => setMuted(m => !m)}>
                {muted ? <MicOff size={17} strokeWidth={1.75} aria-hidden="true" /> : <Mic size={17} strokeWidth={1.75} aria-hidden="true" />}
                <span className="sr-only">Mute microphone</span>
              </button>
              <button type="button" className={`hw-icon-button${deafened ? ' is-off' : ''}`} aria-pressed={deafened} onClick={() => setDeafened(d => !d)}>
                {deafened ? <HeadphoneOff size={17} strokeWidth={1.75} aria-hidden="true" /> : <Headphones size={17} strokeWidth={1.75} aria-hidden="true" />}
                <span className="sr-only">Deafen</span>
              </button>
              <button type="button" className={`hw-icon-button${sharing ? ' is-on' : ''}`} aria-pressed={sharing} onClick={() => onSceneChange(sharing ? 'voice' : 'share')}>
                <MonitorUp size={17} strokeWidth={1.75} aria-hidden="true" />
                <span className="sr-only">Share your screen</span>
              </button>
              <button type="button" className="hw-icon-button hw-leave" onClick={() => onSceneChange('chat')}>
                <PhoneOff size={17} strokeWidth={1.75} aria-hidden="true" />
                <span className="sr-only">Leave voice</span>
              </button>
            </div>
          </section>

          <section className="hw-chat" aria-label="#general messages">
            <div className="hw-log" ref={logRef} tabIndex={0} aria-label="Message history (sample)">
              <ol>
                {messages.map(message => message.author === null ? (
                  <li key={message.id} className="hw-system">{message.text}</li>
                ) : (
                  <li key={message.id} className="hw-message">
                    <Avatar person={message.author} />
                    <div className="hw-message-body">
                      <p className="hw-message-meta"><strong>{PEOPLE[message.author].name}</strong><time>{message.time}</time></p>
                      <p className="hw-message-text">{message.text}</p>
                      <div className="hw-reactions">
                        {message.reactions.map(reaction => (
                          <button
                            key={reaction.emoji}
                            type="button"
                            className={`hw-reaction${reaction.mine ? ' is-mine' : ''}`}
                            aria-pressed={reaction.mine}
                            aria-label={`${reaction.label}, ${reaction.count}`}
                            onClick={() => toggleReaction(message.id, reaction.emoji)}
                          >
                            <span aria-hidden="true">{reaction.emoji}</span> {reaction.count}
                          </button>
                        ))}
                        {!message.reactions.some(r => r.emoji === '💜') && (
                          <button type="button" className="hw-reaction hw-reaction-add" onClick={() => addReaction(message.id)}>
                            <Smile size={14} strokeWidth={1.75} aria-hidden="true" />
                            <span className="sr-only">React to {PEOPLE[message.author].name}'s message with a purple heart</span>
                          </button>
                        )}
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
              {typing && <p className="hw-typing"><span aria-hidden="true" className="hw-typing-dots"><i /><i /><i /></span>{PEOPLE[typing].name} is typing…</p>}
            </div>
            <form className="hw-composer" onSubmit={send}>
              <label className="sr-only" htmlFor={inputId}>Message #general (sample, stays in your browser)</label>
              <input
                id={inputId}
                value={draft}
                maxLength={240}
                autoComplete="off"
                placeholder="Message #general"
                onChange={event => setDraft(event.target.value)}
              />
              <button type="submit" className="hw-send" disabled={!draft.trim()}>
                <SendHorizontal size={16} strokeWidth={1.75} aria-hidden="true" />
                <span className="sr-only">Send</span>
              </button>
            </form>
          </section>
        </div>
      </div>
    </div>
  );
}
