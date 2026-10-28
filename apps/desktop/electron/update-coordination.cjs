const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { createHash } = require('node:crypto');

// Every installed Haven window of this Windows user shares one updater cache (%LOCALAPPDATA%\haven-monorepo-updater),
// whatever profile or mode it runs in. electron-updater assumes it is alone there: a second download empties
// pending\ and replaces Haven-Setup.exe under the first. Downloads and installs therefore take a per-user lock,
// and an install leaves a marker that keeps other windows away while the installer runs after Haven has quit.
const INSTALL_GRACE = 10 * 60 * 1000;

const processAlive = pid => { try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; } };

// Only one process can listen on a named pipe, and Windows removes it when that process exits or crashes,
// so a lock is never left behind by a Haven that died mid-download.
function lockName(dir) {
  return `\\\\.\\pipe\\haven-update-${createHash('sha256').update(path.resolve(dir).toLowerCase()).digest('hex').slice(0, 24)}`;
}

function listenExclusive(name) {
  return new Promise(resolve => {
    const server = net.createServer(socket => socket.destroy());
    // Any failure (normally EADDRINUSE) counts as busy: never touch the cache without the lock.
    server.once('error', () => resolve(null));
    server.listen(name, () => { server.removeAllListeners('error'); server.on('error', () => {}); resolve(() => new Promise(done => server.close(() => done()))); });
  });
}

function createUpdateCoordinator({ dir, version, pid = process.pid, files = fs, now = Date.now, alive = processAlive, acquire = listenExclusive }) {
  const name = lockName(dir);
  const markerFile = path.join(dir, 'installing.json');
  const instancesDir = path.join(dir, 'instances');
  const instanceFile = path.join(instancesDir, `${pid}.json`);
  const read = file => { try { return JSON.parse(files.readFileSync(file, 'utf8')); } catch { return null; } };
  const remove = file => { try { files.unlinkSync(file); } catch {} };
  const write = (file, value) => { files.mkdirSync(path.dirname(file), { recursive: true }); files.writeFileSync(file, JSON.stringify(value)); };

  // Another window's installer may still be running after that window quit. The relaunched new version clears it.
  const installing = () => {
    const marker = read(markerFile);
    if (!marker) return false;
    const finished = typeof marker.at !== 'number' || now() - marker.at > INSTALL_GRACE || (!alive(marker.pid) && marker.version === version);
    if (finished) { remove(markerFile); return false; }
    return marker.pid !== pid;
  };

  return {
    register() {
      installing();
      try { write(instanceFile, { pid, version, startedAt: now() }); } catch {}
    },
    unregister: () => remove(instanceFile),
    // Installed Haven windows other than this one; the silent installer closes all of them.
    others() {
      let names = [];
      try { names = files.readdirSync(instancesDir); } catch {}
      const pids = [];
      for (const entry of names) {
        const other = /^(\d+)\.json$/.exec(entry) && Number(entry.slice(0, -5));
        if (!other || other === pid) continue;
        if (alive(other)) pids.push(other); else remove(path.join(instancesDir, entry));
      }
      return pids;
    },
    // Resolves to a release function, or null while another window downloads or installs.
    async lock() {
      const release = await acquire(name);
      if (!release) return null;
      if (installing()) { await release(); return null; }
      return release;
    },
    markInstalling: target => write(markerFile, { pid, version: target, at: now() }),
    clearInstalling: () => { if (read(markerFile)?.pid === pid) remove(markerFile); },
  };
}

module.exports = { createUpdateCoordinator, lockName, listenExclusive, processAlive, INSTALL_GRACE };
