// electron-builder configuration for the Windows installer.
// The application payload is the verified portable bundle from scripts/package-windows.mjs,
// passed as `prepackaged` by scripts/package-installer.mjs; electron-builder only wraps it in NSIS.
// Paths are relative to the repository root (electron-builder's projectDir).
const { updateFeed } = require('../electron/update-config.cjs');

module.exports = {
  // Electron's default AppUserModelID for app.setName('Haven'); shortcuts, taskbar grouping and
  // the login-item registry value all use it, so it must match the running app.
  appId: 'electron.app.Haven',
  productName: 'Haven',
  copyright: 'Copyright © 2026 Haven',
  // Describes the update feed so electron-builder writes latest.yml beside the installer.
  // package-installer.mjs builds with publish: 'never'; uploading a release is always a manual step.
  publish: [{ provider: updateFeed.provider, owner: updateFeed.owner, repo: updateFeed.repo, releaseType: updateFeed.releaseType }],
  win: {
    target: [{ target: 'nsis', arch: ['x64'] }],
    icon: 'apps/web/public/haven.ico',
    // Haven.exe is already branded by package-windows.mjs and the build is unsigned.
    signAndEditExecutable: false,
  },
  nsis: {
    artifactName: 'Haven-Setup.exe',
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: false, // offered as an opt-in checkbox on the finish page (installer.nsh)
    createStartMenuShortcut: true,
    shortcutName: 'Haven',
    uninstallDisplayName: 'Haven',
    deleteAppDataOnUninstall: false,
    // Writes Haven-Setup.exe.blockmap so later updates download only changed blocks.
    differentialPackage: true,
    packElevateHelper: false, // per-user install never elevates
    installerIcon: 'apps/web/public/haven.ico',
    uninstallerIcon: 'apps/web/public/haven.ico',
    installerHeaderIcon: 'apps/web/public/haven.ico',
    installerSidebar: 'apps/desktop/installer/sidebar.bmp',
    uninstallerSidebar: 'apps/desktop/installer/sidebar.bmp',
    include: 'apps/desktop/installer/installer.nsh',
  },
};
