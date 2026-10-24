// electron-builder configuration for the Windows installer.
// The application payload is the verified portable bundle from scripts/package-windows.mjs,
// passed as `prepackaged` by scripts/package-installer.mjs; electron-builder only wraps it in NSIS.
// Paths are relative to the repository root (electron-builder's projectDir).
module.exports = {
  // Electron's default AppUserModelID for app.setName('Haven'); shortcuts, taskbar grouping and
  // the login-item registry value all use it, so it must match the running app.
  appId: 'electron.app.Haven',
  productName: 'Haven',
  copyright: 'Copyright © 2026 Haven',
  publish: null,
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
    differentialPackage: false,
    packElevateHelper: false, // per-user install never elevates
    installerIcon: 'apps/web/public/haven.ico',
    uninstallerIcon: 'apps/web/public/haven.ico',
    installerHeaderIcon: 'apps/web/public/haven.ico',
    installerSidebar: 'apps/desktop/installer/sidebar.bmp',
    uninstallerSidebar: 'apps/desktop/installer/sidebar.bmp',
    include: 'apps/desktop/installer/installer.nsh',
  },
};
