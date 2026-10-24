import { createServer as createVite } from 'vite';
import react from '@vitejs/plugin-react';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp, type AppOptions } from '../apps/backend/src/app.js';
import type { Page } from '@playwright/test';

export const apiOrigin = 'http://127.0.0.1:3157';
export const probeOrigin = 'http://127.0.0.1:3156';

export async function streamFixture({ diagnosticsSink }: Pick<AppOptions, 'diagnosticsSink'> = {}) {
  // This fixture must never inherit Hosted credentials from the invoking shell.
  for (const key of Object.keys(process.env)) if (/SUPABASE|DATABASE_URL|HAVEN_MODE/.test(key)) delete process.env[key];
  const directory = mkdtempSync(path.join(tmpdir(), 'haven-streams-'));
  const start = async () => {
    const server = createApp({ dataDir: directory, origins: [probeOrigin], supabaseVerifier: null, diagnosticsSink, serveStatic: true, staticDir: path.resolve('apps/web/dist') });
    await new Promise<void>(resolve => server.httpServer.listen(3157, '127.0.0.1', resolve));
    return server;
  };
  let backend = await start();
  const html = `<!doctype html><html><head></head><body><div id="root"></div><script type="module">
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import {io} from 'socket.io-client'; import {useMedia} from '/src/media.ts';
    import StreamViewer from '/src/StreamViewer.tsx';
    window.__HAVEN_CONFIG__={apiUrl:'${apiOrigin}'};
    const qa=window.qa; qa.errors=[];
    // ?socket= routes signaling through another address (a proxy that can cut the network).
    qa.socket=io(new URLSearchParams(location.search).get('socket')||'${apiOrigin}',{withCredentials:true,transports:['websocket'],reconnectionDelay:100,reconnectionDelayMax:500});
    function Probe(){
      const [viewer,setViewer]=React.useState(null);
      qa.media=useMedia(qa.socket,qa.userId,message=>qa.errors.push(message),qa.account);
      qa.showViewer=id=>setViewer(id);
      const peer=qa.media.peers.find(p=>p.socketId===viewer);
      return peer?.stream?.getVideoTracks().length ? React.createElement(StreamViewer,{
        stream:peer.stream,name:'Remote',local:false,muted:qa.media.muted,deafened:qa.media.deafened,
        onToggleMute:qa.media.toggleMute,onToggleDeafen:qa.media.toggleDeafen,
        streamVolume:peer.streamVolume,onStreamVolumeChange:v=>qa.media.setStreamVolume(viewer,v),
        onClose:()=>setViewer(null),onStop:qa.media.stopShare,onError:e=>qa.errors.push(e)
      }):React.createElement('div',null,'Real media probe');
    }
    qa.root=createRoot(document.getElementById('root'));qa.root.render(React.createElement(Probe));
  </script></body></html>`;
  const vite = await createVite({ configFile: false, root: path.resolve('apps/web'), logLevel: 'error', plugins: [react(), {
    name: 'media-probe', configureServer(server) {
      server.middlewares.use('/probe', async (_request, response) => {
        response.setHeader('Content-Type', 'text/html');
        response.end(await server.transformIndexHtml('/probe', html));
      });
    },
  }], server: { host: '127.0.0.1', port: 3156, strictPort: true } });
  await vite.listen();
  return {
    get backend() { return backend; },
    async restart() { await backend.close(); backend = await start(); },
    async close() { await vite.close(); await backend.close(); rmSync(directory, { recursive: true, force: true }); },
  };
}

declare global { interface Window { qa: any } }

export async function instrumentMedia(page: Page, userId: string) {
  await page.addInitScript(({ userId }) => {
    const qa: any = window.qa = { userId, connections: [], audios: [], captures: [], microphones: [], canvases: [], captureDenied: false };
    const Peer = window.RTCPeerConnection;
    window.RTCPeerConnection = class extends Peer {
      constructor(configuration?: RTCConfiguration) { super(configuration); qa.connections.push(this); }
    };
    const AudioElement = window.Audio;
    window.Audio = class extends AudioElement {
      constructor(source?: string) { super(source); qa.audios.push(this); }
    };
    const getUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async constraints => {
      const stream = await getUserMedia(constraints); qa.microphones.push(stream); return stream;
    };
    navigator.mediaDevices.getDisplayMedia = async () => {
      if (qa.captureDenied) throw new DOMException('Capture cancelled', 'NotAllowedError');
      const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 360;
      qa.canvases.push(canvas);
      const context = canvas.getContext('2d')!; let frame = 0;
      const timer = setInterval(() => { context.fillStyle = `hsl(${frame++ % 360} 70% 40%)`; context.fillRect(0, 0, canvas.width, canvas.height); }, 33);
      const stream = canvas.captureStream(30);
      const audio = new AudioContext(); const oscillator = audio.createOscillator();
      const output = audio.createMediaStreamDestination(); oscillator.connect(output); oscillator.start();
      stream.addTrack(output.stream.getAudioTracks()[0]);
      // Stopping tracks does not dispatch ended; dispose the fixture's synthetic source explicitly.
      const track = stream.getVideoTracks()[0], stop = track.stop.bind(track);
      track.stop = () => { clearInterval(timer); oscillator.stop(); void audio.close(); stop(); };
      qa.captures.push(stream); return stream;
    };
  }, { userId });
}

export async function metrics(page: Page, socketId?: string) {
  return page.evaluate(async socketId => {
    const sources = window.qa.media.connectionStatsSources().filter((s: any) => !socketId || s.socketId === socketId);
    const reports = (await Promise.all(sources.map((s: any) => s.connection.getStats()))).flatMap((s: any) => [...s.values()]);
    const total = (type: string, kind: string, field: string) => reports.filter((s: any) => s.type === type && s.kind === kind).reduce((n: number, s: any) => n + (s[field] || 0), 0);
    return {
      audio: total('inbound-rtp', 'audio', 'bytesReceived'), video: total('inbound-rtp', 'video', 'framesDecoded'),
      sentVideo: total('outbound-rtp', 'video', 'bytesSent'),
      lanes: sources.map((s: any) => s.connection.getTransceivers().length),
      peers: window.qa.media.peers.map((p: any) => ({ id: p.socketId, userId: p.user.id, broadcastId: p.state.broadcastId, sharing: p.state.sharing, video: p.stream?.getVideoTracks().length || 0 })),
      watching: window.qa.media.watchingStreams, errors: window.qa.errors,
    };
  }, socketId);
}
