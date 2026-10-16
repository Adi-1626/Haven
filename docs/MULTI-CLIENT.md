# Test Haven with independent accounts

## Account A in Haven Desktop and Account B in a browser

1. Launch the updated Haven Desktop and keep Account A signed in. Choose **Test with another account** immediately above your profile controls, or open **User settings → connection & testing → Test with another account**. For the initial upgrade, close the old executable once before opening the new one; the existing Haven profile, accounts and login are retained. No logout is needed for subsequent two-account testing.
2. Choose **Open browser client**, or copy **Haven backend URL** into your browser. This exact address reaches the backend used by the desktop app. Do not start a second standalone backend or guess port 3001.
3. Create Account B or sign in to it in the browser. Desktop and browser cookies are separate. If your browser already has Account A signed in, paste the copied URL into an InPrivate/Incognito window or another browser profile. Two normal tabs in one profile share cookies and do not provide separate account sessions.
4. Alternatively choose **Open isolated test client**. This opens a second Haven window on the same backend with its own temporary cookies and local storage. It starts signed out, does not replace Account A, and forgets its login when closed. Reopen it to create another fresh session. Up to four extra test windows can be open at once.
5. Keep Haven Desktop running. Closing the main window fully exits by default; enabling close-to-tray under **desktop & gaming** instead preserves the backend, voice and sharing in the tray. Fully quitting closes its test windows and stops its embedded local backend. The embedded backend binds only to `127.0.0.1`; its port can change after restarting. Recopy the current URL after restart. Your desktop account and database remain in the existing Haven app-data profile.

Connecting to a backend chooses where accounts and communities are stored. Joining a community uses a code or `/invite/code` link on that backend. These are different operations. A short invite code cannot identify a computer on the network. A full invite link can carry the backend address and invitation together. Sign in or register on that backend, then redeem the invitation. The desktop **Connect to a Haven host** form accepts either a server URL or a full invitation link and preserves the invitation path.

## Communication walkthrough

### Existing account says “Invalid username or password”

An account created in Desktop is not automatically present in a separately started `npm start` / `localhost:3001` backend. Start Desktop, choose **Test with another account → Copy backend URL**, and paste that exact address into the browser before signing in. Do not guess the port: the embedded backend chooses one at launch. Use the account's username, not its display name; copied `@username` values, surrounding username whitespace and case variations work in v0.3.1. Passwords remain case-sensitive and are not trimmed. No account data or passwords are migrated between hosts by this fix.

### Two-account workflow

1. In Account A, create a community. Create an invite and copy its code or full link.
2. In Account B on the same backend, use **Join a community**, paste the invite, and join. A full invite link can also be opened in Account B's browser. Check the community appears for both accounts. Check an invalid or revoked code gives a useful error.
3. Open **Friends → Add friend** and enter the other account's exact username. Accept the incoming request in the other client. Open the friend's direct message and send a message in each direction.
4. With headsets connected, open **Voice & Audio** settings and test the microphone. Select the input/output devices, start the test, speak and watch the input meter, listen to playback, then stop. Stop the test before comparing voice between two clients.
5. Join the same voice channel in both clients. Check both members appear under the channel. Navigate to a text channel and send a message while staying connected. Test mute and deafen in each client and observe the other member's state.
6. Open the soundboard, play an effect and check the other client receives it.
7. Start screen sharing from Account A and select an application window in the native picker. In Account B open the stream, expand it and enter fullscreen. Press Escape or use **Exit fullscreen** to return. Check the picture keeps its original aspect ratio.
8. Stop sharing from Account A. Check the stream disappears for Account B while both remain connected to voice. Start another stream and stop using the operating system's sharing controls if provided; the application should also clear the stream.
9. Disconnect voice, close Account B and confirm Account A stays signed in. Reopen an isolated test client and confirm it starts signed out.

On one physical computer, speaker output can feed either microphone and cause feedback or doubling. Use headphones, mute one client and deafen the other as appropriate. A software or synthetic microphone can verify transport, but does not prove real microphone acoustics or speaker routing. Testing conversation with two computers and separate headsets gives more useful results. Some browsers cannot select an output device; the application reports that limitation and uses the system default.

## Two Windows computers on one LAN

The desktop app's embedded backend intentionally listens on loopback and is not exposed to the network. Do not send `localhost`, `127.0.0.1`, or an embedded desktop invite link to the other computer: those names refer to the receiver's own computer. Use a separately hosted backend and connect both desktops or browsers to its HTTPS address.

On the host computer, build Haven, then start its production backend from the project directory with an explicit network binding. For example, in PowerShell:

```powershell
npm run build
$env:HOST = '127.0.0.1'
$env:PORT = '3001'
$env:DATA_DIR = 'C:\HavenData'
$env:PUBLIC_URL = 'https://haven.your-domain.example'
$env:ALLOWED_ORIGINS = 'https://haven.your-domain.example'
$env:TRUST_PROXY = '1'
$env:SECURE_COOKIES = '1'
npm start
```

Replace the example domain with a hostname resolving to your host's LAN address. Put a reverse proxy with a valid, trusted TLS certificate in front of port 3001, forward WebSockets as well as HTTP requests, and expose HTTPS port 443 to the LAN. `TRUST_PROXY=1` is appropriate only when this backend is reachable through your trusted proxy; restrict direct backend access. Prefer binding the backend to `127.0.0.1` when the proxy runs on the same host. Bind `0.0.0.0` only when an external proxy must reach the backend, and limit that port to the proxy with a firewall rule.

Use a certificate trusted by both Windows computers and their browsers. A manually bypassed certificate warning is not a dependable secure context. A trusted internal CA can work if installed on both computers, or use a domain and trusted certificate that you control. Your LAN DNS or hosts configuration must resolve that hostname to the host's LAN IP. Set `PUBLIC_URL` to the same HTTPS origin so invites point at an address reachable by the second computer.

In Windows Defender Firewall, explicitly allow inbound TCP 443 for the reverse proxy on the Private network profile and only from your LAN range. Do not disable the firewall. Do not expose the database directory or open all ports. If the host is on a Public profile or a corporate network, use the network's approved configuration. Haven never changes firewall settings automatically. Check both computers can load the HTTPS URL before signing in, then connect both Haven desktops through **Connect to a Haven host** if using the desktop clients.

Plain `http://192.168.x.x:3001` may serve chat pages, but it is not a normal browser secure context. Microphone capture and screen sharing can be unavailable, and Haven Desktop rejects non-loopback HTTP backend addresses. Do not rely on browser flags that treat insecure origins as secure. Localhost HTTP remains supported for same-computer testing only.

## Internet hosting and WebRTC

Run a stable backend with persistent storage behind HTTPS. Set `PUBLIC_URL`, `ALLOWED_ORIGINS`, secure cookies and proxy trust for that deployment. Use the same public origin for browser, API and WebSocket traffic, and publish full invitation links for that origin. The embedded desktop backend is not an internet hosting service and does not punch through your router or firewall.

Voice and video use WebRTC. Signaling goes through the Haven backend, but media transport may require STUN and TURN across NATs, VPNs and restrictive networks. Configure your own `ICE_SERVERS_JSON` for the server, including TURN credentials, and open only the TURN deployment's required ports. Configure relay credentials and TLS according to your TURN deployment; rotate or limit credentials appropriately. HTTPS alone does not ensure two peers can exchange media. Verify real conversation, streaming and reconnects from two different networks before relying on remote use. Haven currently uses peer connections and retains its existing small-room limit; this is not an SFU deployment.

## Session and data safety

Each account uses a cookie scoped to its backend. Desktop, browser profiles, private browser contexts and isolated test clients keep separate cookie stores. Tabs in the same context intentionally share a store. Account B must be on Account A's backend for friendship, communities and voice membership to meet. Switching the main desktop backend closes dependent test clients, then navigates the main client after checking that the destination responds as a Haven backend; it does not migrate accounts or local communities. A successful connection is saved for future desktop launches. Returning to the embedded backend requires removing the saved `connection.json` from the Haven app-data profile while Haven is closed; preserve its `server` data directory.

## Repeat the desktop session check

After `npm run build`, run `node scripts/verify-desktop-clients.mjs`. It launches Haven with a disposable profile and its own random loopback port, a real headless Chrome client, and an isolated Electron test client. It checks independent authenticated accounts, cookie and local-storage isolation, fresh sessions after reopening, owner login preservation, dependent-window cleanup, backend URL rejection and preservation of invitation paths. It also checks microphone permission and track cleanup with Chromium's synthetic microphone, and actual HTML fullscreen entry/exit in the isolated window. Chrome must be installed. These checks do not use a real microphone or validate acoustic playback, LAN networking, TURN or human-perceived media quality. The other end-to-end tests cover communication and stream transport.
