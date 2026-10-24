import type { ReactNode } from 'react';
import { APP_URL, REPOSITORY_URL, WINDOWS_RELEASE } from '../config';
import { Coordinate, ExternalLink } from '../components/primitives';

const QUESTIONS: Array<{ q: string; a: ReactNode }> = [
  {
    q: 'Do I need to install anything?',
    a: <>No. Haven opens in your web browser at <a className="text-link" href={APP_URL}>haven-ea6.pages.dev</a>. The Windows app is optional and adds system-wide shortcuts, the tray and starting with Windows.</>,
  },
  {
    q: 'Is there an app for Mac, Linux or phones?',
    a: 'Not yet. Open Haven in your browser instead. Everything except the desktop extras, such as system-wide shortcuts, works there.',
  },
  ...(WINDOWS_RELEASE.signed ? [] : [{
    q: 'Why does Windows warn me about the installer?',
    a: <>The installer isn’t code-signed yet, so Microsoft SmartScreen doesn’t recognise it. Choose <strong>More info</strong>, then <strong>Run anyway</strong>. If you want to be sure the file is ours, compare it with the SHA-256 checksum in the download section.</>,
  }]),
  {
    q: 'Does push-to-talk work inside games?',
    a: 'The Windows app hears your push-to-talk key while another window has focus, without blocking the key from the game. Games running as administrator and some anti-cheat software can prevent that, so test your key in-game first. Browsers can only use push-to-talk while the Haven tab is focused.',
  },
  {
    q: 'How do I update the Windows app?',
    a: 'Download the newest installer and run it. It updates Haven in place and keeps your settings. The app doesn’t update itself yet.',
  },
  {
    q: 'How do I uninstall it?',
    a: <>Use <strong>Settings → Apps</strong> in Windows. Your settings are kept unless you choose to remove them when asked.</>,
  },
  {
    q: 'Can I run my own Haven server?',
    a: <>Yes. The source includes the server, and the Windows app can connect to a Haven host you choose. Start with the README on <ExternalLink href={REPOSITORY_URL}>GitHub</ExternalLink>.</>,
  },
];

export function Faq() {
  return (
    <section id="faq" className="station faq" aria-labelledby="faq-title">
      <div className="faq-inner">
        <div className="section-head faq-head" data-calm="0.7">
          <Coordinate index="05">Questions</Coordinate>
          <h2 id="faq-title" className="section-title reveal" data-arrival>
            Getting started, answered.
          </h2>
        </div>
        <div className="faq-list reveal" data-calm="0.8">
          {QUESTIONS.map(({ q, a }) => (
            <details key={q} className="faq-item">
              <summary>
                <span>{q}</span>
                <span className="faq-toggle" aria-hidden="true" />
              </summary>
              <div className="faq-answer"><p>{a}</p></div>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
