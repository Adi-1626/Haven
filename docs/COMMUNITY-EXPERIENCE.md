# Community experience — Haven 0.4

## Using the new controls

- Open **User settings → Voice & video / Desktop** and click a shortcut button. Press the actual combination, then release every key. Escape, clicking again or leaving the window cancels recording. Clear disables that binding; Apply saves it. Desktop global mute/deafen bindings require a modifier. Duplicate bindings and unsupported/reserved combinations are rejected; an OS registration failure is shown rather than silently ignored.
- Open **Server options** for Overview, Members, Emoji and Invites. Owners and admins can edit the name, description and icon, and manage emoji. Only owners can change member roles. Member removal and voice moderation obey the owner/admin/member hierarchy on the server, not just in the UI.
- On the Emoji tab, upload a PNG, JPEG, GIF, WebP or APNG with a unique name. Members can use the server's emoji in its text channels and reactions through the picker. Owners/admins can rename or delete them. Renaming retains existing message references.
- Right-click a voice participant, voice roster entry, member, friend or DM entry for profile/contact actions. Voice participants offer an individual volume slider and local mute. Authorized moderators also get persistent server mute/deafen, disconnect and member removal. Right-click a server, channel or message for relevant navigation/edit/copy actions. Shift+F10 or the Context Menu key opens menus on supported focused targets; voice tiles also have an explicit actions button.
- Click a voice avatar or choose View profile, then click the profile picture to open the original URL at fit/actual size. Profile name, bio and avatar changes reach other connected clients, including already-open profiles and existing voice peers, without leaving voice.

## Implementation and limits

### Profiles and images

The backend updates active voice peer profiles when a profile changes and emits a public, audience-scoped `user:update`. The renderer also resolves users from canonical current state, rather than relying on the snapshot taken when someone joined voice. Newer profile/presence/voice events received during a bootstrap request are overlaid on its response, and superseded requests cannot overwrite newer state. This also fixes speaking indicators disappearing after a delayed snapshot. The temporary overlay exists only for the current request; it adds no polling or persistent event journal. No peer connection is restarted for a cosmetic update.

HTTPS profile URLs are used unchanged, without guessed CDN parameters or an enlargement service. The viewer displays the original supplied resource and its natural dimensions; it cannot recover a larger image from a thumbnail URL. Failed/expired/hotlink-blocked images fall back safely. Remote URLs are loaded directly by the client without referrer headers; the server does not proxy arbitrary remote URLs.

Server icons accept emoji/HTTPS URLs or authenticated local PNG/JPEG/static WebP uploads, up to 1 MiB and 1024 × 1024 pixels. A new uploaded icon gets a versioned URL. Uploaded icon/emoji bytes require membership; unauthenticated invite previews use initials for a private uploaded icon rather than weakening its access control.

### Custom emoji

The server accepts at most 50 emoji per community, 256 KiB per source/poster, 128 × 128 pixels and 120 animation frames. Raster signatures, header dimensions and animation container/frame bounds are checked server-side; SVG is not accepted. This is structural validation, not full image decoding or an antivirus service. Animated uploads require a separate static PNG poster, generated from the first decoded frame by the browser. Media inspection does not run a transcoder or introduce an image-processing worker on the voice path.

Messages/reactions store an immutable `:hvn_UUID:` reference. The server validates emoji ownership against the conversation: server emoji are not usable in DMs or another community. Deleting emoji removes the media; existing references become inert text instead of an arbitrary image URL. Names are editable but IDs are stable. Image endpoints are authenticated and revalidate membership rather than granting long-lived public access.

Visible animated emoji share the existing bounded animation scheduler (24 active animations). Gaming mode, reduced motion, hidden/background pages and off-screen images switch to actual static poster URLs, not merely a CSS animation pause that would leave GIF decoders running. There are no per-emoji timers, polling loops or remote emoji services.

### Shortcuts and voice safety

Recording suspends native global shortcut dispatch and focused push-to-talk, releases active transmit, and restores bindings when the recording finishes/cancels. Modifier and physical-key normalization is shared with focused fallback behavior. Desktop settings are saved by the main process independently of the embedded server's changing port. Browser-only clients cannot install system-wide shortcuts.

Global delivery uses Haven's existing Windows keyboard helper and Electron shortcut APIs, not game process injection or an anti-cheat bypass. Conflicts with Haven's other bindings and registration failures are detectable; an unrelated game's private bindings or every fullscreen/anti-cheat environment cannot be inferred. Test your chosen combination in your actual game before relying on it.

Local mute/volume apply to all active connections for that user and survive a room rejoin within the running client. They are receiver-only and do not change the other person's microphone or server state. They are cleared on sign-out and are not promised across application restarts.

Community mute/deafen are persistent membership flags, sent on joining/rejoining and protected from the target clearing them through `voice:state`. A server deafen also disables outgoing microphone audio. Removing a forced flag republishes the client's own retained choice so sidebar mute/speaking state does not remain stuck. Desktop tray state reflects the effective mute/deafen state. These controls apply to compliant Haven clients in the existing peer-to-peer mesh; they are not SFU-side packet filtering against a modified malicious media client.

The update retains voice reconnect, device hot swapping, source-picker cancellation, stream continuity, background/tray behavior, Opus bitrate/FEC/DTX and gaming mode. Cosmetic changes do not renegotiate media. New menus only attach dismissal listeners while open, and management requests are event-driven rather than periodic.

## Reference evidence

REA static analysis of the installed Discord `app-1.0.9261` input module informed the recording interaction, not Haven's source architecture. The observed `input_capture.js` exports a capture watcher; its inert source describes bounded recording, release completion and watcher teardown. Asset SHA-256: `a744d08d1e05a9642b123acba39b81fdcf6e3ca4f2783cd83aafdd4664e7d934`. Retained evidence IDs from the analysis session: `ev_2b651397111ff7d855b270e9d403d10067c440a7a7c9f1756c1a831842590625`, `ev_ae28da663037ed0bfdef677b7c80eaba3a46892068c987996b25f8d79157a526`, `ev_17ba815e0a6eeb5394be2addc8275afcb4ef13b5055fc838c9219d6846336679` (export/source lines 76–78). These are static observations, not proof of live Discord UI or native hotkey behavior. Discord accounts, credentials and unrelated user content were not inspected.

Official interaction references: [custom keybinds](https://discord.com/blog/how-to-use-keyboard-shortcuts-on-discord-create-custom-keybinds), [profiles](https://support.discord.com/hc/en-us/articles/4403147417623-Custom-Profiles), and [roles/permissions](https://support.discord.com/hc/en-us/articles/214836687-Discord-Roles-and-Permissions). Haven's components, upload format, authorization and media implementation are independent; Discord code/assets are not included.

## Manual checks still required

Use two accounts on the same Haven backend, not independent localhost databases. Repeat avatar updates, emoji upload/rename/delete, moderator actions and local volume changes while both remain in voice. Test the chosen global combinations with actual keyboard layouts, USB audio hot plugging, physical speakers/microphone and a real taskbar tray click. Confirm startup-at-logon only if you intentionally enable it.

Automated checks use controlled local peers, synthetic microphones and owned test windows. They do not establish Valorant/anti-cheat compatibility, physical audio quality, WAN/TURN behavior, long-session reliability or game frame-time/ping impact. Earlier bounded measurements remain in `PERFORMANCE-MEASUREMENTS.md`; this feature update makes no new gaming benchmark claim. See `VERIFICATION.md` and `PACKAGING.md` for the executed checks and exact portable build.
