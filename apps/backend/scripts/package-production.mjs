import { mkdir, rm, cp, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(backendRoot, '../..');
const outputDir = path.join(backendRoot, 'dist-standalone');

async function main() {
  console.log('Building @haven/shared...');
  execSync('npm run build', { cwd: path.join(repoRoot, 'packages', 'shared'), stdio: 'inherit' });

  console.log('Building @haven/backend...');
  execSync('npm run build', { cwd: backendRoot, stdio: 'inherit' });

  if (existsSync(outputDir)) {
    await rm(outputDir, { recursive: true, force: true });
  }
  await mkdir(outputDir, { recursive: true });

  // Copy backend compiled output
  await cp(path.join(backendRoot, 'build'), path.join(outputDir, 'build'), { recursive: true });

  // Copy shared compiled output and source
  await mkdir(path.join(outputDir, 'packages', 'shared'), { recursive: true });
  await cp(path.join(repoRoot, 'packages', 'shared', 'dist'), path.join(outputDir, 'packages', 'shared', 'dist'), { recursive: true });
  await cp(path.join(repoRoot, 'packages', 'shared', 'src'), path.join(outputDir, 'packages', 'shared', 'src'), { recursive: true });
  await cp(path.join(repoRoot, 'packages', 'shared', 'package.json'), path.join(outputDir, 'packages', 'shared', 'package.json'));

  // Copy .env.example
  if (existsSync(path.join(backendRoot, '.env.example'))) {
    await cp(path.join(backendRoot, '.env.example'), path.join(outputDir, '.env.example'));
  }

  // Create standalone production package.json
  const backendPkg = JSON.parse(await readFile(path.join(backendRoot, 'package.json'), 'utf8'));
  const standalonePkg = {
    name: 'haven-backend-standalone',
    version: backendPkg.version,
    private: true,
    type: 'module',
    main: 'build/index.js',
    scripts: {
      start: 'node build/index.js'
    },
    dependencies: {
      ...backendPkg.dependencies,
      '@haven/shared': 'file:./packages/shared'
    }
  };
  await writeFile(path.join(outputDir, 'package.json'), JSON.stringify(standalonePkg, null, 2) + '\n');

  // Create minimal production Dockerfile for Voroa / container deployment
  const dockerfile = `FROM node:22-alpine AS runtime
WORKDIR /app
RUN apk add --no-cache python3 make g++ sqlite
COPY package.json ./
COPY packages/ ./packages/
COPY build/ ./build/
COPY .env.example ./.env
RUN npm install --omit=dev
EXPOSE 3001
ENV PORT=3001 HOST=0.0.0.0 NODE_ENV=production DATA_DIR=/data SERVE_STATIC=false
VOLUME ["/data"]
CMD ["node", "build/index.js"]
`;
  await writeFile(path.join(outputDir, 'Dockerfile'), dockerfile);

  console.log(`Standalone production backend packaged into: ${outputDir}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
