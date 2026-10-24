import { useEffect, useState } from 'react';
import { Check, Copy, Download, Globe } from 'lucide-react';
import { APP_URL, downloadAvailable, RELEASES_URL, WINDOWS_RELEASE } from '../config';
import { ExternalLink } from '../components/primitives';

type Platform = 'windows' | 'mac' | 'linux' | 'mobile' | 'unknown';

function detectPlatform(): Platform {
  const agent = navigator.userAgent;
  const hinted = (navigator as Navigator & { userAgentData?: { platform?: string; mobile?: boolean } }).userAgentData;
  if (hinted?.mobile || /Android|iPhone|iPad|iPod/i.test(agent)) return 'mobile';
  const platform = (hinted?.platform || agent).toLowerCase();
  if (platform.includes('win')) return 'windows';
  if (platform.includes('mac')) return 'mac';
  if (platform.includes('linux') || platform.includes('cros')) return 'linux';
  return 'unknown';
}

const PLATFORM_NOTE: Record<Exclude<Platform, 'windows' | 'unknown'>, string> = {
  mac: 'You’re on a Mac. The desktop app is Windows-only for now, but everything else works in your browser.',
  linux: 'You’re on Linux. The desktop app is Windows-only for now, but everything else works in your browser.',
  mobile: 'You’re on a phone or tablet. The desktop app is for Windows PCs; Haven also opens in your mobile browser.',
};

export function DownloadPanel() {
  const available = downloadAvailable();
  const [platform, setPlatform] = useState<Platform>('unknown');
  const [started, setStarted] = useState(false);
  const [copied, setCopied] = useState(false);
  useEffect(() => setPlatform(detectPlatform()), []);

  const verify = WINDOWS_RELEASE.sha256
    ? `(Get-FileHash "$env:USERPROFILE\\Downloads\\${WINDOWS_RELEASE.fileName}" -Algorithm SHA256).Hash -eq "${WINDOWS_RELEASE.sha256.toUpperCase()}"`
    : null;

  const copy = async () => {
    if (!verify) return;
    try {
      await navigator.clipboard.writeText(verify);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  const steps = [
    { title: `Run ${WINDOWS_RELEASE.fileName}`, text: 'Installs just for you. No administrator prompt.' },
    ...(WINDOWS_RELEASE.signed ? [] : [{ title: 'If SmartScreen appears', text: 'The installer isn’t code-signed yet, so choose More info, then Run anyway.' }]),
    { title: 'Pick a folder, or keep the default', text: 'Haven adds a Start menu shortcut and an optional desktop one.' },
    { title: 'Launch and sign in', text: 'Use the same account as in your browser.' },
  ];

  return (
    <div id="download" className="download-panel" data-calm="0.9" data-state={available ? 'available' : 'pending'} tabIndex={-1}>
      <div className="download-head">
        <div>
          <p className="download-kicker">Haven for Windows</p>
          <p className="download-status">
            {available
              ? <><span className="status-dot is-live" aria-hidden="true" />Available{WINDOWS_RELEASE.version ? ` · Version ${WINDOWS_RELEASE.version}` : ''}</>
              : <><span className="status-dot is-pending" aria-hidden="true" />Installer coming soon</>}
          </p>
        </div>
        <p className="download-specs">Windows 10 or 11 · 64-bit{WINDOWS_RELEASE.size ? ` · ${WINDOWS_RELEASE.size}` : ''}</p>
      </div>

      {platform !== 'windows' && platform !== 'unknown' && <p className="download-platform">{PLATFORM_NOTE[platform]}</p>}

      <div className="download-actions">
        {available ? (
          <a className="button button-primary button-large" href={WINDOWS_RELEASE.url} download onClick={() => setStarted(true)}>
            <Download size={18} strokeWidth={1.75} aria-hidden="true" />
            Download {WINDOWS_RELEASE.fileName}
          </a>
        ) : (
          <button className="button button-large" type="button" disabled aria-describedby="download-pending">
            <Download size={18} strokeWidth={1.75} aria-hidden="true" />
            Download {WINDOWS_RELEASE.fileName}
          </button>
        )}
        <a className={`button ${available ? 'button-quiet' : 'button-primary'} button-large`} href={APP_URL}>
          <Globe size={18} strokeWidth={1.75} aria-hidden="true" />
          Use Haven in your browser
        </a>
      </div>
      {!available && (
        <p id="download-pending" className="download-pending">
          We’re finishing the official installer. It will be published on GitHub Releases and linked right here. Until then, Haven works fully in your browser.
        </p>
      )}
      {started && (
        <p className="download-started" role="status">
          <Check size={16} strokeWidth={2} aria-hidden="true" />
          Your download should begin shortly. Then follow the steps below.
        </p>
      )}

      <ol className="install-steps" aria-label="Installing Haven">
        {steps.map((step, index) => (
          <li key={step.title}>
            <span className="install-index" aria-hidden="true">{index + 1}</span>
            <span><strong>{step.title}</strong>{step.text}</span>
          </li>
        ))}
      </ol>

      {verify && (
        <div className="checksum">
          <p className="checksum-label">Verify your download (PowerShell)</p>
          <div className="checksum-row">
            <code>{verify}</code>
            <button type="button" className="icon-button" onClick={copy}>
              {copied ? <Check size={16} strokeWidth={2} aria-hidden="true" /> : <Copy size={16} strokeWidth={1.75} aria-hidden="true" />}
              <span className="sr-only">{copied ? 'Copied' : 'Copy command'}</span>
            </button>
          </div>
          <p className="checksum-note">Prints True when the file matches the published SHA-256.</p>
        </div>
      )}

      <div className="download-links">
        {available && <ExternalLink href={WINDOWS_RELEASE.notesUrl}>Release notes</ExternalLink>}
        <ExternalLink href={RELEASES_URL}>All releases on GitHub</ExternalLink>
      </div>
    </div>
  );
}
