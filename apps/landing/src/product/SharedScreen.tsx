/** The sample "screen" being shared in the product demo: a level blockout from a small game team. */
export function SharedScreen() {
  return (
    <svg className="shared-art" viewBox="0 0 640 360" role="img" aria-label="Sample shared screen: a misty 3D level with mountains and a lit gateway">
      <defs>
        <linearGradient id="ss-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#141633" />
          <stop offset="0.55" stopColor="#2a2b5c" />
          <stop offset="1" stopColor="#5a5a9a" />
        </linearGradient>
        <radialGradient id="ss-sun" cx="0.62" cy="0.52" r="0.42">
          <stop offset="0" stopColor="#e1dfff" stopOpacity="0.85" />
          <stop offset="0.25" stopColor="#c0c1ff" stopOpacity="0.35" />
          <stop offset="1" stopColor="#c0c1ff" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="ss-floor" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#262850" />
          <stop offset="1" stopColor="#0d0f1f" />
        </linearGradient>
        <linearGradient id="ss-fog" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#c0c1ff" stopOpacity="0" />
          <stop offset="1" stopColor="#c0c1ff" stopOpacity="0.22" />
        </linearGradient>
      </defs>
      <rect width="640" height="360" fill="url(#ss-sky)" />
      <rect width="640" height="360" fill="url(#ss-sun)" />
      <circle cx="398" cy="170" r="18" fill="#f1efff" opacity="0.9" />
      <path d="M0 214 L70 150 L120 186 L188 118 L252 176 L300 150 L360 200 L420 140 L476 182 L540 128 L600 170 L640 150 L640 250 L0 250Z" fill="#33356b" opacity="0.75" />
      <path d="M0 236 L60 196 L132 222 L210 170 L270 214 L340 190 L404 230 L470 186 L552 222 L640 196 L640 262 L0 262Z" fill="#23244b" />
      <rect y="232" width="640" height="40" fill="url(#ss-fog)" />
      <path d="M0 256 H640 V360 H0Z" fill="url(#ss-floor)" />
      <g stroke="#c0c1ff" strokeOpacity="0.16" strokeWidth="1">
        <path d="M320 256 L-80 360 M320 256 L80 360 M320 256 L240 360 M320 256 L400 360 M320 256 L560 360 M320 256 L720 360" />
        <path d="M0 270 H640 M0 290 H640 M0 318 H640 M0 352 H640" />
      </g>
      <g transform="translate(398 256)">
        <path d="M-46 0 V-74 Q0 -112 46 -74 V0 H32 V-66 Q0 -92 -32 -66 V0Z" fill="#0f1024" stroke="#c0c1ff" strokeOpacity="0.55" />
        <path d="M-32 0 V-66 Q0 -92 32 -66 V0Z" fill="#e1dfff" opacity="0.18" />
        <path d="M-2 0 L-60 52 M2 0 L60 52" stroke="#45dfa4" strokeOpacity="0.5" />
      </g>
      <g fill="#0f1024">
        <path d="M150 256 l10 -42 l10 42z" />
        <path d="M176 256 l7 -28 l7 28z" />
        <path d="M560 256 l12 -50 l12 50z" />
      </g>
      <g fontFamily="JetBrains Mono, monospace" fontSize="10" fill="#e1e2eb" opacity="0.72">
        <text x="16" y="24">LEVEL 03 · BLOCKOUT</text>
        <text x="16" y="38" opacity="0.6">lighting pass b</text>
      </g>
      <g transform="translate(560 20)" opacity="0.7">
        <rect width="64" height="40" rx="3" fill="#0f1024" stroke="#c0c1ff" strokeOpacity="0.4" />
        <path d="M8 30 L22 16 L32 24 L44 12 L56 22" stroke="#45dfa4" fill="none" strokeOpacity="0.8" />
        <circle cx="32" cy="24" r="2" fill="#e1dfff" />
      </g>
    </svg>
  );
}
