import { useState } from 'react';
import { Check, Link2, MessageCircle, Shield, Smile, UserRound, Users } from 'lucide-react';
import { Coordinate } from '../components/primitives';

const FEATURES = [
  { Icon: Users, title: 'Servers and channels', text: 'Text and voice channels under one roof, with your own name, icon and description.' },
  { Icon: Link2, title: 'Invite links', text: 'Share a link. People see a preview of your server and join in one step.' },
  { Icon: Shield, title: 'Roles that hold', text: 'Owners, admins and members. Moderation is enforced by the server, not just hidden in the interface.' },
  { Icon: Smile, title: 'Your own emoji', text: 'Up to 50 custom emoji per community, animated ones included, in messages and reactions.' },
  { Icon: UserRound, title: 'Profiles that stay current', text: 'A new name, bio or picture reaches everyone straight away, even mid-call.' },
  { Icon: MessageCircle, title: 'Friends and messages', text: 'Add friends and talk one-on-one or in small group conversations.' },
];

export function Communities() {
  const [joined, setJoined] = useState(false);

  return (
    <section id="communities" className="station communities" aria-labelledby="communities-title">
      <div className="split split-copy-left">
        <div className="split-copy" data-calm="0.7">
          <Coordinate index="02">Communities</Coordinate>
          <h2 id="communities-title" className="section-title reveal" data-arrival>
            Room for every group you’re part of.
          </h2>
          <p className="section-lede reveal">
            Make a server for your friends, your raid team or your studio. Shape it with channels, bring people in with a link and decide who can do what.
          </p>
          <ul className="spec-list reveal">
            {FEATURES.map(({ Icon, title, text }) => (
              <li key={title}>
                <Icon aria-hidden="true" size={18} strokeWidth={1.6} />
                <h3>{title}</h3>
                <p>{text}</p>
              </li>
            ))}
          </ul>
        </div>

        <aside className="invite-orbit reveal" aria-label="Sample invite">
          <div className="invite-card" data-calm="0.85">
            <p className="invite-eyebrow">You’ve been invited to join</p>
            <div className="invite-server">
              <span className="invite-icon" aria-hidden="true">NO</span>
              <span>
                <strong>Night Owls</strong>
                <small><span className="live-dot" aria-hidden="true" />3 online · 12 members</small>
              </span>
            </div>
            <div className="invite-channels" aria-hidden="true">
              <span># general</span><span># screenshots</span><span>🔊 Lounge</span>
            </div>
            <button type="button" className={`button ${joined ? 'button-emerald' : 'button-primary'} invite-join`} aria-pressed={joined} onClick={() => setJoined(j => !j)}>
              {joined ? <><Check size={16} strokeWidth={2} aria-hidden="true" />Joined</> : 'Accept invite'}
            </button>
            <p className="invite-note">Sample invite. Real ones arrive as a link.</p>
          </div>
        </aside>
      </div>
    </section>
  );
}
