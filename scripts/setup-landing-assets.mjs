import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';

const root = 'c:\\Users\\adity\\OneDrive\\Desktop\\space';
const landingPublic = path.join(root, 'apps', 'landing', 'public');
const webPublic = path.join(root, 'apps', 'web', 'public');

if (!fs.existsSync(landingPublic)) {
  fs.mkdirSync(landingPublic, { recursive: true });
}

// Copy existing brand assets
for (const file of ['favicon.ico', 'haven-mark.png', 'haven_newlogo.png', 'apple-touch-icon.png']) {
  const src = path.join(webPublic, file);
  const dest = path.join(landingPublic, file);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dest);
    console.log(`Copied ${file}`);
  }
}

function downloadUrl(url, dest) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return downloadUrl(res.headers.location, dest).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        reject(new Error(`Failed to download ${url}: status ${res.statusCode}`));
        return;
      }
      const stream = fs.createWriteStream(dest);
      res.pipe(stream);
      stream.on('finish', () => {
        stream.close();
        console.log(`Downloaded ${path.basename(dest)} (${fs.statSync(dest).size} bytes)`);
        resolve();
      });
      stream.on('error', reject);
    }).on('error', reject);
  });
}

const images = [
  {
    name: 'ue5-viewport.jpg',
    url: 'https://lh3.googleusercontent.com/aida-public/AB6AXuB-qb6RUd9uiqFYa1K1UvwY5rSafMvph9_Az4pu4Tug7eOI7RLHP-0USCkAwG-n0NB3i85aA2woMXaZv9QM89pc-VZid6pIoMDOVltTsGB8zRNXxnvm1hOGvwvAYnJ79E7y3oKo4s61zMuII2uLfuQBag1NHDWgm83lJ3tPSexqfJoczXTS73uQqWNAumUJ0MSXJJpLyhlgHLr3buJ0kTaRcL2pjQ6BTYXOJ3u-E4B7dMAtGCVWHOvlvjZYyz6tXFQIhuFyvHv9d6MQ'
  },
  {
    name: 'pool-render.jpg',
    url: 'https://lh3.googleusercontent.com/aida-public/AB6AXuDcruRX3Z3y9ceZV-AHSoYOsojVk-NvLyRulWS2HkJ9lS5OBf3WlM3uw5oG-msT629SMy8czrcReepEgdlyx2cXlnxPA-k9lQxitf2zWAP0NbAfie__Zbkdgp0cYSRhDU-8k4fnvAS2NQQkni60K30Yp6ssqeMGlQxCtJLNhSpgd1-3_qFw2KU7g3-Q1wIEmyHtpHuhckV7v9IqliM0aBtE2B24EClWn1hHceY4TKn9iv2PVNaw0cFzI5onSmYUidm-Lb-DQNxyGZ9-'
  }
];

for (const img of images) {
  try {
    await downloadUrl(img.url, path.join(landingPublic, img.name));
  } catch (e) {
    console.error(`Failed ${img.name}:`, e.message);
  }
}
