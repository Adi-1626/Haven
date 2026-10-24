import { Download } from 'lucide-react';
import { downloadAvailable, WINDOWS_RELEASE } from '../config';
import { travelHandler } from '../cosmos/nav';

/**
 * The Windows call to action used outside the download panel. Before the approved installer is
 * published it leads to the download section (which explains the status) instead of a file.
 */
export function DownloadButton({ className = 'button button-quiet' }: { className?: string }) {
  if (downloadAvailable()) {
    return (
      <a className={className} href={WINDOWS_RELEASE.url} download>
        <Download aria-hidden="true" size={17} strokeWidth={1.75} />
        Download for Windows
      </a>
    );
  }
  return (
    <a className={className} href="#download" onClick={travelHandler('desktop', 'download')}>
      <Download aria-hidden="true" size={17} strokeWidth={1.75} />
      Windows app
      <span className="button-tag">coming soon</span>
    </a>
  );
}
