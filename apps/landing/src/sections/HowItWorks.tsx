import { useState } from 'react';
import { REPOSITORY_URL } from '../config';
import { Coordinate, ExternalLink } from '../components/primitives';

type Route = 'direct' | 'relay';

function ConnectionDiagram({ route }: { route: Route }) {
  const relay = route === 'relay';
  return (
    <svg className={`diagram route-${route}`} viewBox="0 0 560 300" role="img" aria-labelledby="diagram-title diagram-desc">
      <title id="diagram-title">{relay ? 'Relayed connection' : 'Direct connection'}</title>
      <desc id="diagram-desc">
        {relay
          ? 'Both people stay connected to the Haven service for their account, messages and call setup. Voice and video travel through a relay server because a direct path is blocked.'
          : 'Both people stay connected to the Haven service for their account, messages and call setup. Voice and video travel directly between the two devices.'}
      </desc>
      <g className="diagram-signal">
        <path id="sig-a" d="M110 214 C150 150 200 110 236 86" />
        <path id="sig-b" d="M450 214 C410 150 360 110 324 86" />
      </g>
      <g className="diagram-media">
        <path className="media-direct" d="M122 236 H438" />
        <path className="media-relay" d="M118 246 C180 290 240 292 266 282 M294 282 C320 292 380 290 442 246" />
      </g>
      <g className="diagram-node diagram-service" transform="translate(280 62)">
        <rect x="-124" y="-32" width="248" height="64" rx="12" />
        <text y="-6" className="diagram-label">Haven service</text>
        <text y="14" className="diagram-sub">accounts · messages · call setup</text>
      </g>
      <g className="diagram-node diagram-person" transform="translate(96 236)">
        <circle r="26" />
        <text y="5" className="diagram-label">You</text>
      </g>
      <g className="diagram-node diagram-person" transform="translate(464 236)">
        <circle r="26" />
        <text y="5" className="diagram-label">Friend</text>
      </g>
      <g className="diagram-node diagram-relay" transform="translate(280 282)">
        <rect x="-14" y="-14" width="28" height="28" rx="6" />
        <text y="-22" className="diagram-sub">relay</text>
      </g>
      <text className="diagram-caption" x="280" y="226">{relay ? 'direct path blocked by the network' : 'voice · video · screens'}</text>
    </svg>
  );
}

export function HowItWorks() {
  const [route, setRoute] = useState<Route>('direct');
  return (
    <section id="how-it-works" className="station how" aria-labelledby="how-title">
      <div className="how-inner">
        <div className="section-head how-head" data-calm="0.7">
          <Coordinate index="04">How it works</Coordinate>
          <h2 id="how-title" className="section-title reveal" data-arrival>
            Plain answers about where things go.
          </h2>
          <p className="section-lede reveal">
            Haven is two kinds of connection: one to the Haven service for the things that should be there on every device, and one between the people in a call.
          </p>
        </div>

        <div className="how-grid">
          <figure className="diagram-wrap reveal" data-calm="0.9">
            <div className="route-switch" role="group" aria-label="Show connection type">
              <button type="button" aria-pressed={route === 'direct'} onClick={() => setRoute('direct')}>Direct</button>
              <button type="button" aria-pressed={route === 'relay'} onClick={() => setRoute('relay')}>Relayed</button>
            </div>
            <ConnectionDiagram route={route} />
            <figcaption className="diagram-legend">
              <span><i className="legend-signal" aria-hidden="true" />Haven service</span>
              <span><i className="legend-media" aria-hidden="true" />Voice, video and screens</span>
            </figcaption>
          </figure>

          <ol className="facts reveal" data-calm="0.75">
            <li>
              <h3>Your account and messages</h3>
              <p>Stored by the hosted Haven service, so your communities and history are there on every device you sign in from.</p>
            </li>
            <li>
              <h3>Calls and shared screens</h3>
              <p>Sent between the people in the call with WebRTC, directly where the network allows and through a relay server where it doesn’t. WebRTC encrypts this media in transit either way.</p>
            </li>
            <li>
              <h3>Made for small groups</h3>
              <p>Voice rooms are a mesh: everyone connects to everyone. That keeps things simple for friends and small communities, and it’s why rooms work best at that size.</p>
            </li>
            <li>
              <h3>Source you can read</h3>
              <p>Haven’s code, including the server and the Windows app, is public. <ExternalLink href={REPOSITORY_URL}>Read it on GitHub</ExternalLink></p>
            </li>
          </ol>
        </div>
      </div>
    </section>
  );
}
