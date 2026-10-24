import { AppWindow, Gamepad2, Power, Usb } from 'lucide-react';
import { Coordinate } from '../components/primitives';
import { DownloadPanel } from './DownloadPanel';

const FEATURES = [
  { Icon: Gamepad2, title: 'Low-resource gaming mode', text: 'Lighter voice and capped sharing quality while you play, with animated emoji paused.' },
  { Icon: AppWindow, title: 'Lives in the system tray', text: 'Close or minimise to the tray and stay in voice. Mute and deafen from the tray menu.' },
  { Icon: Power, title: 'Starts when you sign in', text: 'Optional, and it can start minimised so Haven is simply there when friends call.' },
  { Icon: Usb, title: 'Headsets just appear', text: 'Plug in a new device mid-call. Unplugging one falls back to the default without leaving the room.' },
];

export function Desktop() {
  return (
    <section id="desktop" className="station desktop" aria-labelledby="desktop-title">
      <div className="split split-copy-right">
        <div className="split-copy" data-calm="0.7">
          <Coordinate index="03">Windows app</Coordinate>
          <h2 id="desktop-title" className="section-title reveal" data-arrival>
            Stays with you while you play.
          </h2>
          <p className="section-lede reveal">
            The Windows app adds what a browser tab can’t: shortcuts that work in any window, a home in the system tray and a lighter mode for game nights.
          </p>
          <div className="reveal"><DownloadPanel /></div>
        </div>
      </div>

      <div className="split split-copy-right desktop-more">
        <div className="split-copy">
          <div className="shortcuts reveal" data-calm="0.85">
            <h3 className="subsection-title">Push-to-talk on your key</h3>
            <p>
              Pick the key that suits you in Haven’s settings: a single key, a lone modifier such as Right Ctrl, or Ctrl, Alt or Shift with another key. It works while your game has focus and is matched by physical key position, so it behaves the same on every keyboard layout.
            </p>
            <p>
              Global mute and deafen are recorded the same way, using Ctrl, Alt or Shift with a key. They start as <kbd>Ctrl+Shift+M</kbd> and <kbd>Ctrl+Shift+D</kbd>.
            </p>
          </div>
          <ul className="spec-list spec-list-compact reveal" data-calm="0.85">
            {FEATURES.map(({ Icon, title, text }) => (
              <li key={title}>
                <Icon aria-hidden="true" size={18} strokeWidth={1.6} />
                <h4>{title}</h4>
                <p>{text}</p>
              </li>
            ))}
          </ul>
          <p className="fine-print reveal" data-calm="0.85">
            Games running as administrator, and some anti-cheat software, can block system-wide shortcuts. Try your key in your game before relying on it.
          </p>
        </div>
      </div>
    </section>
  );
}
