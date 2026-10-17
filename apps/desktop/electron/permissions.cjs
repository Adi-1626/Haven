const supportedPermissions = new Set(['media', 'display-capture', 'notifications', 'fullscreen', 'speaker-selection']);
function permissionAllowed(trustedClient, permission, requestingOrigin, expectedOrigin, isMainFrame = true) {
  if (!trustedClient || !supportedPermissions.has(permission) || isMainFrame === false) return false;
  try { return new URL(requestingOrigin).origin === expectedOrigin; } catch { return false; }
}
module.exports = { permissionAllowed };
