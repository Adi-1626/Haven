function liveWindowContents(window) {
  if (!window || window.isDestroyed()) return null;
  const contents = window.webContents;
  return contents && !contents.isDestroyed() ? contents : null;
}

function trustedClientEvent(event, trusted, mainWindow, mainOnly = false) {
  try {
    const sender = event.sender;
    if (!sender || sender.isDestroyed() || !trusted(sender)) return false;
    if (mainOnly && sender !== liveWindowContents(mainWindow)) return false;
    return Boolean(event.senderFrame && event.senderFrame === sender.mainFrame);
  } catch { return false; }
}

module.exports = { liveWindowContents, trustedClientEvent };
