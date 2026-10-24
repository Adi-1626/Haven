// Client-side initialization for Haven Local UI Testing Mode
// Provides absolute isolation from external production networks and simulates media streams.

(function initHavenUiTestMode() {
  if (typeof window === 'undefined') return;

  // 1. Strict Network Isolation Guard
  const originalFetch = window.fetch;
  window.fetch = function (input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const targetUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

    // Relative URLs and loopback origins are permitted
    const isLoopback =
      targetUrl.startsWith('/') ||
      targetUrl.startsWith('http://127.0.0.1') ||
      targetUrl.startsWith('http://localhost') ||
      targetUrl.startsWith('ws://127.0.0.1') ||
      targetUrl.startsWith('ws://localhost') ||
      targetUrl.startsWith('blob:') ||
      targetUrl.startsWith('data:');

    if (!isLoopback) {
      console.error('[HAVEN UI TEST MODE] Blocked external network request:', targetUrl);
      return Promise.reject(new Error(`[Haven UI Test Mode Isolation] Blocked external request to: ${targetUrl}`));
    }

    return originalFetch.apply(this, arguments as any);
  };

  // 2. Synthetic Display Capture Generator (Screen Sharing Simulation)
  function createSimulatedDisplayStream(label = 'HAVEN SCREEN SHARE SIMULATION', forcePortrait?: boolean): MediaStream {
    const isPortrait = forcePortrait ?? (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('stream') === 'portrait');
    const width = isPortrait ? 1080 : 1920;
    const height = isPortrait ? 1920 : 1080;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;
    let frame = 0;

    function renderFrame() {
      frame++;
      // Dark slate background
      ctx.fillStyle = '#0f1117';
      ctx.fillRect(0, 0, width, height);

      // Subtle grid pattern
      ctx.strokeStyle = '#1e2330';
      ctx.lineWidth = 1;
      for (let x = 0; x < width; x += 60) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
      }
      for (let y = 0; y < height; y += 60) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }

      // Banner card
      ctx.fillStyle = '#161922';
      ctx.strokeStyle = '#2d3345';
      ctx.lineWidth = 2;
      ctx.beginPath();
      const marginX = isPortrait ? 60 : 120;
      const marginY = 120;
      ctx.roundRect(marginX, marginY, width - marginX * 2, height - marginY * 2, 16);
      ctx.fill();
      ctx.stroke();

      // Title
      ctx.fillStyle = '#818cf8';
      ctx.font = isPortrait ? '600 36px "Space Grotesk", sans-serif' : '600 42px "Space Grotesk", sans-serif';
      ctx.fillText(label, marginX + 60, marginY + 100);

      ctx.fillStyle = '#94a3b8';
      ctx.font = '24px "Inter", sans-serif';
      ctx.fillText(isPortrait ? 'Portrait Mobile Stream (9:16)' : 'Shared Screen Stream (16:9)', marginX + 60, marginY + 150);

      // Animated signal rings
      const pulse = Math.sin(frame * 0.05) * 20;
      const centerX = width / 2;
      const centerY = height / 2;

      ctx.beginPath();
      ctx.arc(centerX, centerY, 120 + pulse, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(99, 102, 241, 0.4)';
      ctx.lineWidth = 4;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(centerX, centerY, 80 + pulse * 0.5, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(99, 102, 241, 0.2)';
      ctx.fill();
      ctx.strokeStyle = '#6366f1';
      ctx.lineWidth = 3;
      ctx.stroke();

      // Center mark
      ctx.fillStyle = '#c7d2fe';
      ctx.font = 'bold 32px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('✳', centerX, centerY + 10);
      ctx.textAlign = 'left';

      requestAnimationFrame(renderFrame);
    }

    renderFrame();
    return canvas.captureStream(60);
  }

  // 3. Audio Stream Generator (Microphone Fallback)
  function createSimulatedAudioStream(): MediaStream {
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioCtx) {
        const ctx = new AudioCtx({ sampleRate: 48000 });
        const dest = ctx.createMediaStreamDestination();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        gain.gain.value = 0.001; // Silent / minimal audible energy for mic activity meter
        osc.frequency.value = 440;
        osc.connect(gain);
        gain.connect(dest);
        osc.start();
        return dest.stream;
      }
    } catch {}

    // Fallback empty stream
    return new MediaStream();
  }

  // 4. Wrap MediaDevices for Seamless Simulated Media
  if (navigator.mediaDevices) {
    const originalGetUserMedia = navigator.mediaDevices.getUserMedia?.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async function (constraints?: MediaStreamConstraints): Promise<MediaStream> {
      try {
        if (originalGetUserMedia) {
          return await originalGetUserMedia(constraints);
        }
      } catch {
        // Fallback in environments without real audio hardware / permissions
      }
      return createSimulatedAudioStream();
    };

    navigator.mediaDevices.getDisplayMedia = async function (): Promise<MediaStream> {
      return createSimulatedDisplayStream('YOUR SCREEN · LOCAL DISPLAY SHARE');
    };
  }

  // 5. Intercept RTCPeerConnection to Inject Remote Participant Video
  if (typeof window !== 'undefined' && (window as any).RTCRtpReceiver) {
    let mockFrameCount = 50;
    const OriginalGetStats = (window as any).RTCRtpReceiver.prototype.getStats;
    (window as any).RTCRtpReceiver.prototype.getStats = async function () {
      mockFrameCount += 20;
      console.log('[RTCRtpReceiver Mock] getStats called! framesDecoded:', mockFrameCount, 'kind:', this.track?.kind);
      return new Map([
        ['mock-inbound-rtp', { type: 'inbound-rtp', kind: this.track?.kind || 'video', framesDecoded: mockFrameCount }]
      ]) as any;
    };
  }

  const OriginalRTCPeerConnection = window.RTCPeerConnection;
  if (OriginalRTCPeerConnection) {
    class MockRTCPeerConnection extends OriginalRTCPeerConnection {
      constructor(config?: RTCConfiguration) {
        super(config);

        // Pre-create simulated video and audio transceivers for screen sharing so adoptScreenLanes detects them
        let videoTransceiver: RTCRtpTransceiver | null = null;
        let audioTransceiver1: RTCRtpTransceiver | null = null;
        let audioTransceiver2: RTCRtpTransceiver | null = null;
        try {
          videoTransceiver = this.addTransceiver('video', { direction: 'recvonly' });
          audioTransceiver1 = this.addTransceiver('audio', { direction: 'recvonly' });
          audioTransceiver2 = this.addTransceiver('audio', { direction: 'recvonly' });
        } catch {}

        console.log('[RTCPeerConnection Mock] constructor created, videoTransceiver:', Boolean(videoTransceiver));
        (window as any).__mockPCs = (window as any).__mockPCs || [];
        (window as any).__mockPCs.push({ pc: this, videoTransceiver, audioTransceiver: audioTransceiver2 });

        // Create simulated display stream for remote sharing peers (e.g. Elena)
        const simulatedStream = createSimulatedDisplayStream('ELENA ROSTOVA · LIVE STREAM');
        const videoTrack = simulatedStream.getVideoTracks()[0];

        setTimeout(() => {
          if (typeof this.ontrack === 'function' && videoTrack && videoTransceiver) {
            try {
              const event = new Event('track') as any;
              event.track = videoTrack;
              event.streams = [simulatedStream];
              event.receiver = videoTransceiver.receiver;
              event.transceiver = videoTransceiver;
              console.log('[RTCPeerConnection Mock] dispatching ontrack event...');
              this.ontrack(event);
              console.log('[RTCPeerConnection Mock] ontrack dispatched successfully');
            } catch (err) {
              console.error('[RTCPeerConnection Mock] ontrack dispatch failed:', err);
            }
          }
        }, 150);
      }
    }
    (window as any).RTCPeerConnection = MockRTCPeerConnection;
  }


  // 6. UI Testing Mode Default Navigation:
  // On fresh dev-server launch or first load, default to Zenith Design Lab ('srv-zenith')
  // so that both Studio Room and Design Lounge appear naturally in the voice channels sidebar.
  try {
    const runKey = 'haven.ui.mock.run';
    const currentRun = localStorage.getItem(runKey);
    const runId = String((import.meta as any).env?.VITE_HAVEN_UI_RUN_ID || '');
    const isNewRun = Boolean(runId && currentRun !== runId);
    if (localStorage.getItem('haven.server') === null || isNewRun) {
      localStorage.setItem('haven.server', 'srv-zenith');
      if (localStorage.getItem('haven.selection') === null || isNewRun) {
        localStorage.setItem('haven.selection', JSON.stringify({ channelId: 'chn-design-tokens' }));
      }
    }
  } catch {}
})();
