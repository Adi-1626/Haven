import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium, _electron as electron } from '@playwright/test';

// Dedicated synthetic fixture. No backend, accounts, database, or user profile.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'haven-perf-phase1-'));
const results = { measuredAt: new Date().toISOString(), cpu: os.cpus()[0].model, logicalCores: os.cpus().length, memoryGiB: os.totalmem() / 1024 ** 3, boundaries: 'Synthetic microphones and same-device WebRTC; no game, backend or database. Render counters are not whole-app CPU/GPU measurements.' };
let fixtureSource = '';
const server = await createServer({
  root: path.join(root, 'apps/web'), configFile: false, envFile: false, cacheDir: path.join(temporary, 'vite-cache'),
  server: { host: '127.0.0.1', port: 0 },
  plugins: [{ name: 'performance-fixture',
    resolveId(id) { if (id === 'virtual:performance-fixture') return '\0virtual:performance-fixture'; },
    load(id) { if (id === '\0virtual:performance-fixture') return fixtureSource; },
    configureServer(server) {
    server.middlewares.use((request, response, next) => {
      if (request.url === '/api/rtc') { response.setHeader('Content-Type', 'application/json'); response.end('{"iceServers":[]}'); return; }
      if (request.url !== '/__performance') { next(); return; }
      response.setHeader('Content-Type', 'text/html');
      response.end('<!doctype html><html><head><style>.auth-page{position:relative}.orbital-bg-wrap{position:absolute;inset:0}.orbital-canvas{display:block;width:100%;height:100%}</style></head><body><div id="root"></div></body></html>');
    });
  } }],
});
let browser;
let desktop;
try {
  await server.listen();
  const url = `http://127.0.0.1:${server.httpServer.address().port}/__performance`;
  fixtureSource = `
      import React, {useState} from 'react';
      import {createRoot} from 'react-dom/client';
      import {flushSync} from 'react-dom';
      import {OrbitalBackground} from '/src/OrbitalBackground.tsx';
      import {OrbitalScene} from '/src/orbital/scene.ts';
      import {useInputMeter} from '/src/input-meter.ts';
      import {useMedia} from '/src/media.ts';
      import '/src/voice-room.css';
      let frames=0, disposed=0;
      const render=OrbitalScene.prototype.render, dispose=OrbitalScene.prototype.dispose;
      OrbitalScene.prototype.render=function(...args){frames++;return render.apply(this,args)};
      OrbitalScene.prototype.dispose=function(...args){disposed++;return dispose.apply(this,args)};
      const sockets=[]; const joined=[];
      function socket(id){
        const listeners=new Map();
        const s={id,connected:true,on(name,cb){const v=listeners.get(name)||new Set();v.add(cb);listeners.set(name,v)},off(name,cb){listeners.get(name)?.delete(cb)},timeout(){return s},
          deliver(name,data){for(const cb of listeners.get(name)||[])cb(data)},
          emit(name,data,ack){
            const user={id,username:id,displayName:id};
            if(name==='voice:join'){
              const peers=joined.map(p=>({socketId:p.id,user:{id:p.id,username:p.id,displayName:p.id}}));
              if(!joined.includes(s)){for(const p of joined)p.deliver('voice:peer-joined',{socketId:id,user});joined.push(s)}
              ack(null,{peers});
            } else if(name==='voice:signal') queueMicrotask(()=>sockets.find(p=>p.id===data.target)?.deliver(name,{...data,from:id}));
            else if(name==='voice:state'||name==='voice:activity') {for(const p of joined)if(p!==s)p.deliver(name,{...data,socketId:id})}
            else if(name==='voice:leave'){const i=joined.indexOf(s);if(i>=0)joined.splice(i,1);for(const p of joined)p.deliver('voice:peer-left',{socketId:id})}
          }};sockets.push(s);return s;
      }
      const a=socket('a'),b=socket('b');
      let meter,showMeter; let rootRenders=0,meterRenders=0,baselineRenders=0,setBaseline;
      function Meter(){const level=useInputMeter(meter);meterRenders++;return React.createElement('output',{id:'meter'},level)}
      function Baseline(){const [level,set]=useState(0);setBaseline=set;baselineRenders++;return React.createElement('output',null,level)}
      function Harness(){
        rootRenders++;
        const first=useMedia(a,'a',message=>window.errors.push(message));
        const second=useMedia(b,'b',message=>window.errors.push(message));
        const [visible,setVisible]=useState(true);showMeter=setVisible;meter=first.inputMeter;
        window.media=[first,second];
        return React.createElement(React.Fragment,null,React.createElement('div',{className:'auth-page',style:{height:400,width:800}},React.createElement(OrbitalBackground)),visible?React.createElement(Meter):null);
      }
      const main=createRoot(document.getElementById('root'));const base=document.createElement('div');document.body.append(base);const baseline=createRoot(base);
      window.errors=[];flushSync(()=>{main.render(React.createElement(Harness));baseline.render(React.createElement(Baseline))});
      window.fixture={frames:()=>frames,disposed:()=>disposed,meter,counts:()=>({rootRenders,meterRenders,baselineRenders}),
        publish(value){flushSync(()=>meter.publish(value));flushSync(()=>setBaseline(value))},
        hideMeter(){flushSync(()=>showMeter(false))},
        unmount(){flushSync(()=>{main.unmount();baseline.unmount()})},
        async sent(){let total=0;for(const {connection} of window.media[0].connectionStatsSources())(await connection.getStats()).forEach(r=>{if(r.type==='outbound-rtp'&&r.kind==='audio')total+=r.bytesSent||0});return total}
      };
      window.ready=true;
    `;
  async function setup(page) {
    await page.goto(url);
    await page.addScriptTag({type:'module',url:'/@id/__x00__virtual:performance-fixture'});
    await page.waitForFunction(()=>window.ready);
  }
  const flags=['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream','--autoplay-policy=no-user-gesture-required'];
  browser=await chromium.launch({channel:'chrome',headless:true,args:flags});
  const page=await browser.newPage({permissions:['microphone']});
  await setup(page);
  await page.waitForFunction(()=>window.fixture.frames()>2);
  await page.waitForTimeout(500); // Let initial device enumeration and activity subscriptions settle.
  const countBefore=await page.evaluate(()=>window.fixture.counts());
  await page.evaluate(async()=>{for(let i=1;i<=20;i++){window.fixture.publish(i/25);await new Promise(r=>setTimeout(r,50))}});
  const countAfter=await page.evaluate(()=>window.fixture.counts());
  assert.equal(countAfter.rootRenders,countBefore.rootRenders);
  assert.equal(countAfter.meterRenders-countBefore.meterRenders,20);
  assert.equal(countAfter.baselineRenders-countBefore.baselineRenders,20);
  results.rendering={samples:20,intervalMs:50,baselineOwnerRenders:20,optimizedOwnerRenders:0,visibleMeterRenders:20};
  await page.evaluate(async()=>{await window.media[0].join('room');await window.media[1].join('room')});
  await page.waitForFunction(()=>window.media.every(m=>m.peers.some(p=>p.connectionState==='connected')));
  await page.evaluate(()=>window.fixture.hideMeter());
  await page.waitForTimeout(600);
  const hiddenBefore=await page.evaluate(()=>window.fixture.counts());
  await page.evaluate(async()=>{for(let i=1;i<=20;i++){window.media[0].inputMeter.publish(i/25);await new Promise(r=>setTimeout(r,50))}});
  const hiddenAfter=await page.evaluate(()=>window.fixture.counts());
  assert.equal(hiddenAfter.rootRenders,hiddenBefore.rootRenders);
  assert.equal(hiddenAfter.meterRenders,hiddenBefore.meterRenders);
  results.rendering.activeVoiceHiddenMeterOwnerRenders=0;
  results.rendering.hiddenMeterRenders=0;
  await page.evaluate(()=>window.media[0].toggleMute());
  await page.waitForFunction(()=>window.media[0].muted&&window.media[1].peers[0].state.muted);
  await page.evaluate(()=>window.media[0].toggleMute());
  await page.waitForFunction(()=>!window.media[0].muted&&!window.media[1].peers[0].state.muted);
  await page.evaluate(()=>window.media[0].toggleDeafen());
  await page.waitForFunction(()=>window.media[0].deafened&&window.media[1].peers[0].state.deafened);
  await page.evaluate(()=>window.media[0].toggleDeafen());
  await page.waitForFunction(()=>!window.media[0].deafened&&!window.media[1].peers[0].state.deafened);
  const before=await page.evaluate(()=>window.fixture.sent());
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.waitForTimeout(100);
  const reduced=await page.evaluate(()=>window.fixture.frames());
  await page.waitForTimeout(350);
  assert.equal(await page.evaluate(()=>window.fixture.frames()),reduced, JSON.stringify(await page.evaluate(()=>({reduced:matchMedia('(prefers-reduced-motion: reduce)').matches,disposed:window.fixture.disposed(),canvases:document.querySelectorAll('canvas').length}))));
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.waitForFunction(n=>window.fixture.frames()>n,reduced);
  await page.evaluate(()=>document.documentElement.dataset.gaming='true');
  await page.waitForTimeout(100);const gaming=await page.evaluate(()=>window.fixture.frames());
  await page.waitForTimeout(350);assert.equal(await page.evaluate(()=>window.fixture.frames()),gaming);
  await page.evaluate(()=>document.documentElement.dataset.gaming='false');
  await page.waitForFunction(n=>window.fixture.frames()>n,gaming);
  const after=await page.evaluate(()=>window.fixture.sent());assert.ok(after>before);
  await page.evaluate(()=>{
    const el=document.createElement('div');el.className='app';el.innerHTML='<section class="voice-room-view"><div class="person-tile speaking"><div class="avatar-button"><span class="avatar">A</span></div></div><span class="stream-live-dot"></span></section>';document.body.append(el);
  });
  for(const mode of ['background','gaming']){
    await page.evaluate(mode=>document.documentElement.dataset[mode]='true',mode);
    assert.deepEqual(await page.locator('.voice-room-view').evaluate(el=>Array.from(el.querySelectorAll('.avatar,.stream-live-dot'),e=>getComputedStyle(e).animationName)),['none','none']);
    await page.evaluate(mode=>document.documentElement.dataset[mode]='false',mode);
  }
  results.browser={reducedMotionFrames:0,gamingFrames:0,syntheticVoiceBytesDelta:after-before,errors:await page.evaluate(()=>window.errors)};
  assert.deepEqual(results.browser.errors,[]);
  await page.evaluate(()=>window.fixture.unmount());
  assert.equal(await page.evaluate(()=>window.fixture.disposed()),1);
  await browser.close();browser=undefined;

  const preload=path.join(root,'apps/desktop/electron/preload.cjs');
  const runtime=path.join(root,'apps/desktop/electron/desktop-runtime.cjs');
  const entry=path.join(temporary,'main.cjs');
  await fs.writeFile(entry,`const {app,BrowserWindow,ipcMain,Tray,Menu,nativeImage,globalShortcut}=require('electron');
    app.setPath('userData',${JSON.stringify(path.join(temporary,'profile'))});
    app.commandLine.appendSwitch('use-fake-device-for-media-stream');app.commandLine.appendSwitch('use-fake-ui-for-media-stream');app.commandLine.appendSwitch('autoplay-policy','no-user-gesture-required');
    app.whenReady().then(()=>{const w=new BrowserWindow({width:1000,height:700,webPreferences:{preload:${JSON.stringify(preload)},backgroundThrottling:false}});
    const d=require(${JSON.stringify(runtime)}).createDesktopRuntime({app,Tray,Menu,nativeImage,globalShortcut,getWindow:()=>w,getClients:()=>[w.webContents],onQuit:()=>{}});d.attachWindow(w);
    ipcMain.handle('desktop:settings',e=>d.snapshot(e.sender));ipcMain.on('desktop:client-setting-status',e=>e.returnValue={value:null,error:null,canPersist:false});ipcMain.on('desktop:client-setting-read',e=>e.returnValue=null);ipcMain.on('desktop:voice-state',()=>{});
    w.webContents.session.setPermissionRequestHandler((_c,_p,cb)=>cb(true));app.on('before-quit',()=>d.beforeQuit());w.loadURL(${JSON.stringify(url)});});`);
  desktop=await electron.launch({args:[entry]});
  const nativePage=await desktop.firstWindow();await setup(nativePage);
  await desktop.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];w.show();w.focus()});
  await nativePage.waitForFunction(()=>window.fixture.frames()>2);
  await nativePage.evaluate(async()=>{await window.media[0].join('room');await window.media[1].join('room')});
  await nativePage.waitForFunction(()=>window.media.every(m=>m.peers.some(p=>p.connectionState==='connected')));
  const nativeBefore=await nativePage.evaluate(()=>window.fixture.sent());
  results.electron={};
  for(const state of ['blur','minimized','hidden']){
    await desktop.evaluate(({BrowserWindow},state)=>{
      const w=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('/__performance'));
      if(state==='blur') { const focus=new BrowserWindow({width:200,height:100,title:'Performance test focus target'});focus.focus(); }
      else if(state==='minimized')w.minimize();else w.hide();
    },state);
    await nativePage.waitForFunction(()=>window.media[0].background);
    await nativePage.waitForTimeout(100);const frames=await nativePage.evaluate(()=>window.fixture.frames());
    await nativePage.waitForTimeout(350);assert.equal(await nativePage.evaluate(()=>window.fixture.frames()),frames);
    results.electron[state]={animationFrames:0,voiceLive:await nativePage.evaluate(()=>window.media.every(m=>m.localStream.getAudioTracks()[0].readyState==='live'&&m.peers.some(p=>p.connectionState==='connected')))};
    assert.equal(results.electron[state].voiceLive,true);
    await desktop.evaluate(({BrowserWindow})=>{const windows=BrowserWindow.getAllWindows();const w=windows.find(w=>w.webContents.getURL().includes('/__performance'));windows.filter(h=>h!==w).forEach(h=>h.close());w.restore();w.show();w.focus()});
    await nativePage.waitForFunction(n=>window.fixture.frames()>n,frames);
  }
  results.electron.syntheticVoiceBytesDelta=await nativePage.evaluate(()=>window.fixture.sent())-nativeBefore;
  assert.ok(results.electron.syntheticVoiceBytesDelta>0);
  assert.equal(await nativePage.evaluate(()=>window.fixture.disposed()),0,'activity transitions reuse the scene');
  await nativePage.evaluate(()=>window.fixture.unmount());
  assert.equal(await nativePage.evaluate(()=>window.fixture.disposed()),1);
  await desktop.close();desktop=undefined;
  await fs.mkdir(path.join(root,'output/performance-phase1'),{recursive:true});
  await fs.writeFile(path.join(root,'output/performance-phase1/verification.json'),JSON.stringify(results,null,2));
  console.log(JSON.stringify(results,null,2));
} finally {
  await browser?.close();await desktop?.close();await server.close();
  // Keep the isolated temporary profile for diagnostics; never touch user profiles.
}
