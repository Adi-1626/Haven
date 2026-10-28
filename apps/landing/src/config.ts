export const APP_URL = 'https://haven-ea6.pages.dev';
export const REPOSITORY_URL = 'https://github.com/Adi-1626/Haven';
export const RELEASES_URL = `${REPOSITORY_URL}/releases`;

export interface WindowsRelease {
  /**
   * 'pending' until the approved installer is attached to a published GitHub release.
   * Flip to 'available' (and fill in the details below) to turn on direct downloads everywhere.
   */
  status: 'pending' | 'available';
  fileName: string;
  /** Direct link to this version's release asset. */
  url: string;
  version: string | null;
  /** Human-readable size, e.g. "98 MB". */
  size: string | null;
  /** SHA-256 of the published Haven-Setup.exe, shown so people can verify their download. */
  sha256: string | null;
  /** Release notes page for this version. */
  notesUrl: string;
  /** Code-signed installers do not trigger the SmartScreen "unrecognised app" prompt. */
  signed: boolean;
}

export const WINDOWS_RELEASE: WindowsRelease = {
  status: 'available',
  fileName: 'Haven-Setup.exe',
  url: `${RELEASES_URL}/download/v1.0.1/Haven-Setup.exe`,
  version: '1.0.1',
  size: '138 MB',
  sha256: '731e0bf15e07a4b245411d4b4b43f0534c531a7ca51c70fe594ad5ad5b50179d',
  notesUrl: `${RELEASES_URL}/tag/v1.0.1`,
  signed: false,
};

export const downloadAvailable = () => WINDOWS_RELEASE.status === 'available';
