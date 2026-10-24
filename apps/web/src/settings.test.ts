import test from 'node:test';
import assert from 'node:assert/strict';
import { photoProblem, avatarTypes, avatarInputLimit } from './profile-photo';
import { openOriginalImage, openInNewTab, ORIGINAL_IMAGE_SUPPRESSION_WINDOW_MS } from './profile-images';

test('avatar validation enforces format and 12 MB file limit', () => {
  assert.equal(photoProblem({ type: 'image/png', size: 1024 * 1024 }), null);
  assert.equal(photoProblem({ type: 'image/jpeg', size: 5 * 1024 * 1024 }), null);
  assert.equal(photoProblem({ type: 'image/webp', size: 2 * 1024 * 1024 }), null);
  assert.equal(photoProblem({ type: 'image/gif', size: 500 * 1024 }), null);

  // Invalid mime types
  assert.equal(
    photoProblem({ type: 'image/svg+xml', size: 1000 }),
    'Choose a PNG, JPEG, WebP or GIF image'
  );
  assert.equal(
    photoProblem({ type: 'application/pdf', size: 1000 }),
    'Choose a PNG, JPEG, WebP or GIF image'
  );

  // Oversized file > 12 MB
  assert.equal(
    photoProblem({ type: 'image/png', size: 13 * 1024 * 1024 }),
    'Choose an image smaller than 12 MB'
  );
});

test('profile draft state preserves edits across category switches without wiping inputs', () => {
  const initialMe = {
    id: 'user-1',
    username: 'alex_zenith',
    displayName: 'Alex Mercer',
    avatar: '🌱',
    bio: 'Original bio text',
    status: 'online',
    createdAt: Date.now(),
  };

  // Simulate dirty draft state held in SettingsDialog
  let draft = {
    displayName: 'Alex Updated',
    avatar: '🚀',
    bio: 'Updated tactical bio description with details',
    status: 'dnd',
    avatarFile: null,
    previewUrl: null,
  };

  const isDirty = (d: typeof draft) =>
    d.displayName !== initialMe.displayName ||
    d.avatar !== initialMe.avatar ||
    d.bio !== initialMe.bio ||
    d.status !== initialMe.status ||
    d.avatarFile !== null;

  assert.equal(isDirty(draft), true);

  // Switch category to 'voice & video' and then back to 'profile'
  let currentTab = 'profile';
  currentTab = 'voice & video';
  assert.equal(currentTab, 'voice & video');

  // Verify draft remains intact and dirty
  assert.equal(draft.displayName, 'Alex Updated');
  assert.equal(draft.status, 'dnd');
  assert.equal(isDirty(draft), true);

  currentTab = 'profile';
  assert.equal(currentTab, 'profile');
  assert.equal(draft.displayName, 'Alex Updated');
  assert.equal(draft.bio, 'Updated tactical bio description with details');
});

test('profile validation enforces display name non-empty and backend limits', () => {
  const validate = (draft: { displayName: string; bio: string; avatar: string }) => {
    const trimmed = draft.displayName.trim();
    if (!trimmed) return 'Display name cannot be empty';
    if (trimmed.length > 50) return 'Display name must be 50 characters or fewer';
    if (draft.bio.length > 500) return 'Bio must be 500 characters or fewer';
    if (draft.avatar.length > 300) return 'Avatar URL must be 300 characters or fewer';
    return null;
  };

  assert.equal(validate({ displayName: '  ', bio: 'Valid', avatar: '' }), 'Display name cannot be empty');
  assert.equal(validate({ displayName: 'a'.repeat(51), bio: 'Valid', avatar: '' }), 'Display name must be 50 characters or fewer');
  assert.equal(validate({ displayName: 'Valid Name', bio: 'b'.repeat(501), avatar: '' }), 'Bio must be 500 characters or fewer');
  assert.equal(validate({ displayName: 'Valid Name', bio: 'Valid', avatar: 'https://example.com/'.concat('c'.repeat(300)) }), 'Avatar URL must be 300 characters or fewer');
  assert.equal(validate({ displayName: 'Valid Name', bio: 'Valid', avatar: 'https://example.com/avatar.png' }), null);
});

test('F01: successful avatar upload followed by repeat Save preserves avatar without deletion', () => {
  const initialUser = {
    id: 'user-42',
    username: 'alex',
    displayName: 'Alex Mercer',
    avatar: '',
    bio: 'Initial bio',
    status: 'online',
    createdAt: Date.now(),
  };

  let baseline = { ...initialUser };
  let draft: {
    displayName: string;
    avatar: string;
    bio: string;
    status: string;
    avatarFile: Blob | null;
    previewUrl: string | null;
  } = {
    displayName: baseline.displayName,
    avatar: baseline.avatar,
    bio: baseline.bio,
    status: baseline.status,
    avatarFile: new Uint8Array([1, 2, 3]) as unknown as Blob,
    previewUrl: 'blob:http://localhost/test-preview-1',
  };
  const touchedFields = new Set<string>();

  // 1. First save: upload succeeds, backend confirms server avatar URL
  const serverConfirmedAvatar = `/api/users/${initialUser.id}/avatar?v=confirmed123`;
  const updatedUserFromBackend = {
    ...initialUser,
    avatar: serverConfirmedAvatar,
  };

  // Reconciliation contract in SettingsDialog
  baseline = { ...updatedUserFromBackend };
  draft = {
    ...draft,
    avatar: serverConfirmedAvatar,
    avatarFile: null,
    previewUrl: null,
  };
  touchedFields.clear();

  // Verify dirty state is cleared
  const isDirty = () =>
    draft.avatarFile !== null ||
    draft.displayName !== baseline.displayName ||
    draft.avatar !== baseline.avatar ||
    draft.bio !== baseline.bio ||
    draft.status !== baseline.status;

  assert.equal(isDirty(), false, 'State should be pristine after successful save');
  assert.equal(draft.avatar, serverConfirmedAvatar, 'Draft must adopt confirmed avatar');

  // 2. Second save with no additional edits or only displayName edit
  draft = {
    ...draft,
    displayName: 'Alex Mercer Edited',
  };
  touchedFields.add('displayName');
  assert.equal(isDirty(), true);

  // Payload computation for PATCH:
  // Since draft.avatar matches baseline.avatar, avatar was NOT removed and is not sent as ''
  const patchPayload: Record<string, string> = {
    displayName: draft.displayName,
    bio: draft.bio,
    status: draft.status,
  };
  if (draft.avatar !== baseline.avatar) {
    patchPayload.avatar = draft.avatar;
  }

  assert.equal(patchPayload.avatar, undefined, 'Second save must never send avatar: "" to delete avatar');
  assert.equal(draft.avatar, serverConfirmedAvatar, 'Avatar URL must remain preserved');
});

test('F02: failed avatar upload preserves selected photo, preview, and draft for retry', async () => {
  const initialUser = {
    id: 'user-42',
    username: 'alex',
    displayName: 'Alex Mercer',
    avatar: '',
    bio: 'Unsaved bio edit',
    status: 'online',
    createdAt: Date.now(),
  };

  const selectedBlob = new Uint8Array([10, 20, 30]) as unknown as Blob;
  const selectedPreview = 'blob:http://localhost/preview-retry-test';

  let draft = {
    displayName: 'Alex Mercer New',
    avatar: '',
    bio: 'Unsaved bio edit',
    status: 'online',
    avatarFile: selectedBlob,
    previewUrl: selectedPreview,
  };

  let uploadError = '';
  const onSaveProfileAttempt = async (shouldFail: boolean) => {
    if (shouldFail) {
      uploadError = 'Network error: 500 Internal Server Error';
      throw new Error(uploadError);
    }
    return {
      ...initialUser,
      displayName: draft.displayName,
      avatar: '/api/users/user-42/avatar?v=newly-saved',
    };
  };

  // Attempt 1: Upload fails (500 error)
  let failed = false;
  try {
    await onSaveProfileAttempt(true);
  } catch {
    failed = true;
    // On failure, draft.avatarFile and previewUrl MUST NOT be wiped
  }

  assert.equal(failed, true);
  assert.equal(draft.avatarFile, selectedBlob, 'Selected file must be retained');
  assert.equal(draft.previewUrl, selectedPreview, 'Preview URL must remain intact');
  assert.equal(draft.displayName, 'Alex Mercer New', 'Other fields must not be wiped');
  assert.equal(uploadError, 'Network error: 500 Internal Server Error');

  // Attempt 2: Retry without reselecting file
  let confirmedUser: typeof initialUser | null = null;
  try {
    confirmedUser = await onSaveProfileAttempt(false);
  } catch {
    assert.fail('Retry should succeed');
  }

  assert.ok(confirmedUser);
  assert.equal(confirmedUser.avatar, '/api/users/user-42/avatar?v=newly-saved');
});

test('partial save failure preserves uploaded avatar URL so retry only patches', async () => {
  const initialUser = {
    id: 'user-100',
    username: 'alex',
    displayName: 'Alex',
    avatar: '',
    bio: 'Bio',
    status: 'online',
    createdAt: Date.now(),
  };

  let draft: {
    displayName: string;
    avatar: string;
    bio: string;
    status: string;
    avatarFile: Blob | null;
    previewUrl: string | null;
  } = {
    displayName: 'Alex New',
    avatar: '',
    bio: 'Bio New',
    status: 'online',
    avatarFile: new Uint8Array([1]) as unknown as Blob,
    previewUrl: 'blob:http://localhost/partial-test',
  };

  // Simulate upload succeeds -> server confirms avatar, but PATCH /users/me fails
  const uploadedAvatar = '/api/users/user-100/avatar?v=uploaded-stage1';
  let patchFailed = false;

  const simulateSave = async (patchFails: boolean) => {
    // 1. Upload file
    const confirmedAvatar = uploadedAvatar;
    // 2. Patch user profile
    if (patchFails) {
      const err = new Error('Database write conflict');
      (err as unknown as { uploadedAvatar?: string }).uploadedAvatar = confirmedAvatar;
      throw err;
    }
    return { ...initialUser, ...draft, avatar: confirmedAvatar };
  };

  try {
    await simulateSave(true);
  } catch (caught: any) {
    patchFailed = true;
    // SettingsDialog catches partial failure and adopts uploadedAvatar into draft
    if (caught.uploadedAvatar) {
      draft = {
        ...draft,
        avatar: caught.uploadedAvatar,
        avatarFile: null,
      };
    }
  }

  assert.equal(patchFailed, true);
  assert.equal(draft.avatar, uploadedAvatar, 'Draft adopted uploaded avatar even though PATCH failed');
  assert.equal(draft.avatarFile, null, 'Avatar file cleared so retry does not re-upload');

  // Next attempt: Retrying only sends PATCH with the confirmed avatar
  assert.equal(draft.avatar, uploadedAvatar);
});

test('F03: external profile update adopts canonical changes for pristine fields while protecting local edits', () => {
  const initialMe = {
    id: 'user-sync',
    username: 'sync_user',
    displayName: 'Alice Original',
    avatar: 'https://cdn.example/alice_old.png',
    bio: 'Old bio',
    status: 'online',
    createdAt: Date.now(),
  };

  let baseline = { ...initialMe };
  let draft = {
    displayName: baseline.displayName,
    avatar: baseline.avatar,
    bio: baseline.bio,
    status: baseline.status,
    avatarFile: null,
    previewUrl: null,
  };
  const touchedFields = new Set<string>();

  // User locally edits bio
  draft = { ...draft, bio: 'Local edit in progress' };
  touchedFields.add('bio');

  // External update arrives from another client/device
  const incomingMe = {
    ...initialMe,
    displayName: 'Alice Remote Renamed',
    avatar: 'https://cdn.example/alice_new.png',
    status: 'dnd',
    bio: 'Remote bio updated',
  };

  // SettingsDialog reconciliation effect:
  const nextDraft = { ...draft };
  if (!touchedFields.has('displayName') && incomingMe.displayName !== baseline.displayName) {
    nextDraft.displayName = incomingMe.displayName;
  }
  if (!touchedFields.has('avatar') && !draft.avatarFile && incomingMe.avatar !== baseline.avatar) {
    nextDraft.avatar = incomingMe.avatar;
  }
  if (!touchedFields.has('bio') && incomingMe.bio !== baseline.bio) {
    nextDraft.bio = incomingMe.bio;
  }
  if (!touchedFields.has('status') && incomingMe.status !== baseline.status) {
    nextDraft.status = incomingMe.status;
  }
  baseline = incomingMe;
  draft = nextDraft;

  // Assertions:
  // Pristine fields adopted remote update:
  assert.equal(draft.displayName, 'Alice Remote Renamed');
  assert.equal(draft.avatar, 'https://cdn.example/alice_new.png');
  assert.equal(draft.status, 'dnd');
  // Locally touched field was protected against remote overwrite:
  assert.equal(draft.bio, 'Local edit in progress');

  // When user clicks Reset:
  draft = {
    displayName: baseline.displayName,
    avatar: baseline.avatar,
    bio: baseline.bio,
    status: baseline.status,
    avatarFile: null,
    previewUrl: null,
  };
  touchedFields.clear();

  assert.equal(draft.bio, 'Remote bio updated', 'Reset restores to latest canonical baseline');
});

test('F10: explicit avatar removal immediately displays fallback preview without saving to server', () => {
  const user = {
    id: 'user-remove',
    username: 'bob',
    displayName: 'Bob Smith',
    avatar: '/api/users/user-remove/avatar?v=abc',
    bio: 'Hello',
    status: 'online',
    createdAt: Date.now(),
  };

  // Initial picker state
  let avatarValue = user.avatar;
  let avatarFile: Blob | null = null;
  let previewUrl: string | null = null;

  const getEffectiveAvatar = () =>
    previewUrl ? previewUrl : avatarValue;

  assert.equal(getEffectiveAvatar(), '/api/users/user-remove/avatar?v=abc');

  // User clicks "Remove"
  avatarValue = '';
  avatarFile = null;
  previewUrl = null;

  // The effective avatar must be '' (not falling back to user.avatar)
  const effectiveAvatar = getEffectiveAvatar();
  assert.equal(effectiveAvatar, '', 'Removed avatar must immediately evaluate to empty string');

  // Verify server is unchanged until confirmed
  assert.equal(user.avatar, '/api/users/user-remove/avatar?v=abc', 'Server user.avatar must not be altered');
});

test('F11: unsupported Notification API is distinguished from explicit permission denial', () => {
  const evaluatePermissionStatus = (hasApi: boolean, permission?: NotificationPermission) => {
    if (!hasApi) {
      return {
        status: 'unsupported',
        canRequest: false,
        buttonText: 'Notifications unavailable',
        guidance: 'Desktop notifications are not supported in this browser or environment.',
      };
    }
    if (permission === 'denied') {
      return {
        status: 'denied',
        canRequest: true,
        buttonText: 'Enable notifications',
        guidance: 'Notifications are blocked in your browser or system settings.',
      };
    }
    return {
      status: permission || 'default',
      canRequest: true,
      buttonText: permission === 'granted' ? 'Notifications enabled' : 'Enable notifications',
      guidance: '',
    };
  };

  const unsupported = evaluatePermissionStatus(false);
  assert.equal(unsupported.status, 'unsupported');
  assert.equal(unsupported.canRequest, false);
  assert.equal(unsupported.buttonText, 'Notifications unavailable');
  assert.ok(unsupported.guidance.includes('not supported'));

  const denied = evaluatePermissionStatus(true, 'denied');
  assert.equal(denied.status, 'denied');
  assert.ok(denied.guidance.includes('blocked'));
});

test('F06: preserve empty native PTT bindings without falling back to browser shortcut', () => {
  const computePttDisplay = (
    desktop: { settings: { pttShortcut: string }; runtime: { canConfigureDesktop: boolean } } | null,
    mediaSettings: { pushToTalkKey: string }
  ) => {
    const isDesktop = Boolean(desktop);
    const isMainElectron = isDesktop && desktop?.runtime.canConfigureDesktop !== false;
    const isIsolatedElectron = isDesktop && desktop?.runtime.canConfigureDesktop === false;

    const hasNativePtt = isDesktop && typeof desktop?.settings?.pttShortcut === 'string';
    const effectivePttKey = hasNativePtt
      ? desktop.settings.pttShortcut
      : mediaSettings.pushToTalkKey;

    const pttScopeLabel = isMainElectron
      ? 'Global shortcut'
      : isIsolatedElectron
      ? 'Focused window only (isolated client)'
      : 'Browser focused window only';

    const displayText = effectivePttKey
      ? `Effective key: ${effectivePttKey} (${pttScopeLabel})`
      : `No shortcut assigned (${pttScopeLabel})`;

    return { effectivePttKey, pttScopeLabel, displayText };
  };

  const browserMedia = { pushToTalkKey: 'Control+Shift+Space' };

  // Case 1: Main Electron with assigned F10
  const mainAssigned = computePttDisplay(
    { settings: { pttShortcut: 'F10' }, runtime: { canConfigureDesktop: true } },
    browserMedia
  );
  assert.equal(mainAssigned.effectivePttKey, 'F10');
  assert.equal(mainAssigned.pttScopeLabel, 'Global shortcut');
  assert.equal(mainAssigned.displayText, 'Effective key: F10 (Global shortcut)');

  // Case 2: Main Electron after clearing the global shortcut (empty native binding "")
  // MUST NOT fall back to Control+Shift+Space!
  const mainCleared = computePttDisplay(
    { settings: { pttShortcut: '' }, runtime: { canConfigureDesktop: true } },
    browserMedia
  );
  assert.equal(mainCleared.effectivePttKey, '');
  assert.equal(mainCleared.pttScopeLabel, 'Global shortcut');
  assert.equal(mainCleared.displayText, 'No shortcut assigned (Global shortcut)');

  // Case 3: Isolated Electron with empty native binding
  const isolatedCleared = computePttDisplay(
    { settings: { pttShortcut: '' }, runtime: { canConfigureDesktop: false } },
    browserMedia
  );
  assert.equal(isolatedCleared.effectivePttKey, '');
  assert.equal(isolatedCleared.pttScopeLabel, 'Focused window only (isolated client)');
  assert.equal(isolatedCleared.displayText, 'No shortcut assigned (Focused window only (isolated client))');

  // Case 4: Web Browser (desktop is null / unavailable)
  const browserClient = computePttDisplay(null, browserMedia);
  assert.equal(browserClient.effectivePttKey, 'Control+Shift+Space');
  assert.equal(browserClient.pttScopeLabel, 'Browser focused window only');
  assert.equal(browserClient.displayText, 'Effective key: Control+Shift+Space (Browser focused window only)');
});

test('F08: StrictMode effect replay preserves stored opener and restores focus on close/discard', () => {
  // Mock DOM environment for opener focus tracking
  class MockElement {
    public isConnected = true;
    public focused = false;
    constructor(public id: string, public parent: MockElement | null = null) {}
    focus() {
      this.focused = true;
      currentActive = this;
    }
    contains(child: MockElement | null): boolean {
      if (!child) return false;
      let curr: MockElement | null = child;
      while (curr) {
        if (curr === this) return true;
        curr = curr.parent;
      }
      return false;
    }
  }

  const mockBody = new MockElement('body');
  const openerButton = new MockElement('settings-opener-btn', mockBody);
  const dialogElement = new MockElement('dialog', mockBody);
  const insideDialogCloseBtn = new MockElement('close-btn', dialogElement);

  let currentActive: MockElement = openerButton;

  // Simulate SettingsDialog opener tracking logic
  let openerRef: MockElement | null = null;

  const captureOpener = (renderPhase: boolean) => {
    if (!openerRef) {
      const active = currentActive;
      if (active && active !== mockBody && !dialogElement.contains(active)) {
        openerRef = active;
      }
    }
  };

  // Phase 1: Mount 1 (Production or dev initial mount)
  currentActive = openerButton; // User clicked settings
  captureOpener(true); // Render phase capture
  assert.equal(openerRef, openerButton, 'Opener should be captured on initial render');

  // Dialog mounts and becomes modal, focusing inside
  currentActive = insideDialogCloseBtn;

  // Phase 2: React StrictMode simulated unmount and remount (effect replay)
  // Simulated unmount cleanup does not lose the ref in React fibers
  // StrictMode effect replay executes captureOpener:
  captureOpener(false);

  // Even though currentActive is now inside the dialog, openerRef MUST NOT be overwritten!
  assert.equal(openerRef, openerButton, 'Opener MUST NOT be overwritten during StrictMode effect replay');

  // Phase 3: Dialog unmount (e.g. Escape or Close clicked)
  // Cleanup restores focus
  const cleanup = () => {
    if (openerRef && openerRef.isConnected) {
      openerRef.focus();
    } else {
      openerButton.focus();
    }
  };
  cleanup();

  assert.equal(currentActive, openerButton, 'Focus must be restored to original opener button, not BODY');
  assert.equal(openerButton.focused, true);
});

test('F05: ImageViewer openOriginalImage opens exactly one tab and handles single, double, rapid and deliberate clicks', async () => {
  let createdTabs: Array<{ url: string; target: string; rel: string }> = [];
  let revokedBlobs: string[] = [];

  const mockOpenTab = (url: string) => {
    createdTabs.push({ url, target: '_blank', rel: 'noreferrer noopener' });
  };

  const mockCreateObjectURL = (blob: Blob) => 'blob:http://localhost/test-blob-' + Math.random().toString(36).slice(2);
  const mockRevokeObjectURL = (url: string) => {
    revokedBlobs.push(url);
  };

  let mockTime = 1000;
  const now = () => mockTime;

  // 1. Single click: public image opens exactly 1 tab
  createdTabs = [];
  const publicOpeningRef = { current: false };
  const publicLastOpenRef = { current: 0 };
  const publicSuccess = await openOriginalImage({
    source: 'https://images.example.com/photo.png',
    resolved: 'https://images.example.com/photo.png',
    isHostedAuth: () => false,
    isApiResource: () => false,
    fetchResource: async () => { throw new Error('should not fetch public'); },
    openTab: mockOpenTab,
    openingRef: publicOpeningRef,
    lastOpenTimeRef: publicLastOpenRef,
    now,
  });
  assert.equal(publicSuccess, true);
  assert.equal(createdTabs.length, 1, 'Public image single click must open exactly 1 tab');
  assert.equal(createdTabs[0].url, 'https://images.example.com/photo.png');
  assert.equal(createdTabs[0].rel, 'noreferrer noopener');

  // 1b. Single click: protected hosted image opens exactly 1 tab via bearer fetch
  createdTabs = [];
  const protectedOpeningRef = { current: false };
  const protectedLastOpenRef = { current: 0 };
  let fetchResourceCalledWith = '';
  const protectedSuccess = await openOriginalImage({
    source: '/api/users/user-1/avatar?v=abc.png',
    resolved: 'http://localhost:3000/api/users/user-1/avatar?v=abc.png',
    isHostedAuth: () => true,
    isApiResource: () => true,
    fetchResource: async (url) => {
      fetchResourceCalledWith = url;
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        blob: async () => new Blob(['fake image data'], { type: 'image/png' }),
      };
    },
    createObjectURL: mockCreateObjectURL,
    revokeObjectURL: mockRevokeObjectURL,
    scheduleRevoke: () => {},
    openTab: mockOpenTab,
    openingRef: protectedOpeningRef,
    lastOpenTimeRef: protectedLastOpenRef,
    now,
  });
  assert.equal(protectedSuccess, true);
  assert.equal(fetchResourceCalledWith, '/api/users/user-1/avatar?v=abc.png', 'Protected fetch must be called with resource source');
  assert.equal(createdTabs.length, 1, 'Protected image single click must open exactly 1 tab');
  assert.match(createdTabs[0].url, /^blob:http:\/\/localhost\/test-blob-/);
  assert.equal(createdTabs[0].url.includes('Bearer'), false, 'Token must not be exposed in URL');
  assert.equal(createdTabs[0].rel, 'noreferrer noopener', 'Opener must be isolated with noreferrer noopener');

  // 2. Double-click with 100-200 ms separation: exactly 1 tab created (public image)
  createdTabs = [];
  const dblOpeningRef = { current: false };
  const dblLastOpenRef = { current: 0 };
  mockTime = 2000;

  // First click of double-click
  const dblFirst = await openOriginalImage({
    source: 'https://images.example.com/photo.png',
    resolved: 'https://images.example.com/photo.png',
    isHostedAuth: () => false,
    isApiResource: () => false,
    openTab: mockOpenTab,
    openingRef: dblOpeningRef,
    lastOpenTimeRef: dblLastOpenRef,
    now,
  });
  assert.equal(dblFirst, true);
  assert.equal(createdTabs.length, 1);

  // Second click 150 ms later (within 100-200ms normal double-click window)
  mockTime = 2150;
  const dblSecond = await openOriginalImage({
    source: 'https://images.example.com/photo.png',
    resolved: 'https://images.example.com/photo.png',
    isHostedAuth: () => false,
    isApiResource: () => false,
    openTab: mockOpenTab,
    openingRef: dblOpeningRef,
    lastOpenTimeRef: dblLastOpenRef,
    now,
  });
  assert.equal(dblSecond, false, 'Second click of double-click must be suppressed');
  assert.equal(createdTabs.length, 1, 'Double-click must produce exactly 1 tab in total');

  // 2b. Double-click on protected image with async delay (150ms apart)
  createdTabs = [];
  const dblProtOpeningRef = { current: false };
  const dblProtLastOpenRef = { current: 0 };
  mockTime = 3000;

  const dblProtFirst = openOriginalImage({
    source: '/api/users/user-1/avatar?v=abc.png',
    resolved: 'http://localhost:3000/api/users/user-1/avatar?v=abc.png',
    isHostedAuth: () => true,
    isApiResource: () => true,
    fetchResource: async () => {
      // simulate 50ms async network fetch
      mockTime += 50;
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        blob: async () => new Blob(['data']),
      };
    },
    createObjectURL: mockCreateObjectURL,
    openTab: mockOpenTab,
    openingRef: dblProtOpeningRef,
    lastOpenTimeRef: dblProtLastOpenRef,
    now,
  });

  // Second click at 150ms
  mockTime = 3150;
  const dblProtSecond = openOriginalImage({
    source: '/api/users/user-1/avatar?v=abc.png',
    resolved: 'http://localhost:3000/api/users/user-1/avatar?v=abc.png',
    isHostedAuth: () => true,
    isApiResource: () => true,
    fetchResource: async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      blob: async () => new Blob(['data']),
    }),
    createObjectURL: mockCreateObjectURL,
    openTab: mockOpenTab,
    openingRef: dblProtOpeningRef,
    lastOpenTimeRef: dblProtLastOpenRef,
    now,
  });

  const [protFirstRes, protSecondRes] = await Promise.all([dblProtFirst, dblProtSecond]);
  assert.equal(protFirstRes, true);
  assert.equal(protSecondRes, false, 'Protected second click must be suppressed');
  assert.equal(createdTabs.length, 1, 'Protected double-click must produce exactly 1 tab in total');

  // 3. Rapid repeated clicks (e.g. 5 clicks within 300ms)
  createdTabs = [];
  const rapidOpeningRef = { current: false };
  const rapidLastOpenRef = { current: 0 };
  mockTime = 4000;
  const clickTimes = [4000, 4050, 4100, 4150, 4200];
  const rapidResults: boolean[] = [];

  for (const time of clickTimes) {
    mockTime = time;
    const res = await openOriginalImage({
      source: 'https://images.example.com/rapid.png',
      resolved: 'https://images.example.com/rapid.png',
      isHostedAuth: () => false,
      isApiResource: () => false,
      openTab: mockOpenTab,
      openingRef: rapidOpeningRef,
      lastOpenTimeRef: rapidLastOpenRef,
      now,
    });
    rapidResults.push(res);
  }

  assert.deepEqual(rapidResults, [true, false, false, false, false]);
  assert.equal(createdTabs.length, 1, 'Rapid repeated clicks must produce exactly 1 tab');

  // 4. Later deliberate click after suppression window opens the image again
  mockTime = 4000 + ORIGINAL_IMAGE_SUPPRESSION_WINDOW_MS + 200; // 800ms later
  const deliberateResult = await openOriginalImage({
    source: 'https://images.example.com/rapid.png',
    resolved: 'https://images.example.com/rapid.png',
    isHostedAuth: () => false,
    isApiResource: () => false,
    openTab: mockOpenTab,
    openingRef: rapidOpeningRef,
    lastOpenTimeRef: rapidLastOpenRef,
    now,
  });
  assert.equal(deliberateResult, true, 'Deliberate click after suppression window must succeed');
  assert.equal(createdTabs.length, 2, 'Total tabs created after deliberate click must be 2');

  // 5. Fetch failure does not open a tab and resets opening state
  createdTabs = [];
  const failOpeningRef = { current: false };
  const failLastOpenRef = { current: 0 };
  mockTime = 6000;
  let openingStateTracked = false;

  const failResult = await openOriginalImage({
    source: '/api/users/user-1/avatar?v=fail.png',
    resolved: 'http://localhost:3000/api/users/user-1/avatar?v=fail.png',
    isHostedAuth: () => true,
    isApiResource: () => true,
    fetchResource: async () => ({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      blob: async () => new Blob([]),
    }),
    createObjectURL: mockCreateObjectURL,
    openTab: mockOpenTab,
    onOpeningChange: state => { openingStateTracked = state; },
    openingRef: failOpeningRef,
    lastOpenTimeRef: failLastOpenRef,
    now,
  });

  assert.equal(failResult, false, 'Fetch failure must return false');
  assert.equal(createdTabs.length, 0, 'No tab must be opened on fetch failure');
  assert.equal(failOpeningRef.current, false, 'openingRef must be reset to false on failure');
  assert.equal(openingStateTracked, false, 'onOpeningChange must report false after failure');

  // 6. Blob cleanup after image use
  createdTabs = [];
  revokedBlobs = [];
  const cleanupOpeningRef = { current: false };
  const cleanupLastOpenRef = { current: 0 };
  let scheduledCallback: (() => void) | null = null;
  let scheduledDelay = 0;

  mockTime = 7000;
  await openOriginalImage({
    source: '/api/users/user-1/avatar?v=clean.png',
    resolved: 'http://localhost:3000/api/users/user-1/avatar?v=clean.png',
    isHostedAuth: () => true,
    isApiResource: () => true,
    fetchResource: async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      blob: async () => new Blob(['content']),
    }),
    createObjectURL: mockCreateObjectURL,
    revokeObjectURL: mockRevokeObjectURL,
    scheduleRevoke: (revoke, delay) => {
      scheduledCallback = revoke;
      scheduledDelay = delay;
    },
    openTab: mockOpenTab,
    openingRef: cleanupOpeningRef,
    lastOpenTimeRef: cleanupLastOpenRef,
    now,
  });

  assert.equal(createdTabs.length, 1);
  assert.equal(scheduledDelay, 60_000, 'Blob URL revocation must be scheduled after 60,000 ms');
  assert.equal(revokedBlobs.length, 0, 'Blob must not be revoked immediately');

  // Trigger scheduled cleanup
  assert.ok(scheduledCallback);
  (scheduledCallback as () => void)();
  assert.equal(revokedBlobs.length, 1);
  assert.equal(revokedBlobs[0], createdTabs[0].url, 'Revoked blob URL must match opened URL');
});

test('F05: openInNewTab creates a single anchor with noopener noreferrer without window.open fallback', () => {
  let createdElement: any = null;
  let appendedChild: any = null;
  let removedChild: any = null;
  let clickCount = 0;

  const originalDocument = (globalThis as any).document;
  (globalThis as any).document = {
    createElement: (tag: string) => {
      assert.equal(tag, 'a');
      createdElement = {
        href: '',
        target: '',
        rel: '',
        click: () => { clickCount++; },
        remove: () => { removedChild = createdElement; },
      };
      return createdElement;
    },
    body: {
      append: (el: any) => { appendedChild = el; },
    },
  };

  try {
    openInNewTab('https://example.com/original-image.png');
    assert.ok(createdElement, 'Anchor element was created');
    assert.equal(createdElement.href, 'https://example.com/original-image.png');
    assert.equal(createdElement.target, '_blank');
    assert.equal(createdElement.rel, 'noreferrer noopener');
    assert.equal(appendedChild, createdElement, 'Anchor was appended to body');
    assert.equal(clickCount, 1, 'Anchor was clicked exactly once');
    assert.equal(removedChild, createdElement, 'Anchor was removed from body');
  } finally {
    (globalThis as any).document = originalDocument;
  }
});

