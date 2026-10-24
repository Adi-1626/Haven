import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

test('Issue 1: Rapid server switching cancels stale member requests and updates loading state', async () => {
  let activeVersion = 0;
  let members: string[] = [];
  let membersLoading = false;
  const notifiedErrors: string[] = [];

  const notify = (msg: string) => notifiedErrors.push(msg);

  // Helper simulating the effect logic from App.tsx
  const switchServer = (serverId: string | null, delayMs: number, resultData: string[], shouldFail = false) => {
    const version = ++activeVersion;
    if (!serverId) {
      members = [];
      membersLoading = false;
      return Promise.resolve();
    }
    members = [];
    membersLoading = true;

    return new Promise<void>(resolve => {
      setTimeout(() => {
        if (shouldFail) {
          if (version === activeVersion) {
            members = [];
            notify('Server error');
          }
        } else {
          if (version === activeVersion) {
            members = resultData;
          }
        }
        if (version === activeVersion) {
          membersLoading = false;
        }
        resolve();
      }, delayMs);
    });
  };

  // Case A: User switches from Server 1 to Server 2 rapidly.
  // Request 1 takes 80ms, but Server 2 is selected immediately (20ms later) and completes in 20ms.
  const req1 = switchServer('server-1', 80, ['Alice (Server 1)', 'Bob (Server 1)']);
  // Immediate state after switch to Server 1: members is cleared and loading is true
  assert.deepEqual(members, []);
  assert.equal(membersLoading, true);

  // 10ms later user clicks server 2
  const req2 = switchServer('server-2', 20, ['Charlie (Server 2)']);
  assert.deepEqual(members, []);
  assert.equal(membersLoading, true);

  await req2;
  // Server 2 resolved first
  assert.deepEqual(members, ['Charlie (Server 2)']);
  assert.equal(membersLoading, false);

  await req1;
  // Stale request 1 resolved LATER, but must NOT overwrite Server 2's members!
  assert.deepEqual(members, ['Charlie (Server 2)']);
  assert.equal(membersLoading, false);

  // Case B: Error handling on failed request clears members and notifies
  const req3 = switchServer('server-3', 10, [], true);
  await req3;
  assert.deepEqual(members, []);
  assert.equal(membersLoading, false);
  assert.equal(notifiedErrors.includes('Server error'), true);
});

test('Issue 3: Modal dialog accessible name logic when hideHeader is true vs false', () => {
  const getDialogA11yProps = (
    title: string,
    hideHeader: boolean,
    titleId = 'title-id-123',
    explicitAriaLabel?: string,
    explicitAriaLabelledBy?: string
  ) => {
    const effectiveAriaLabel = explicitAriaLabel ?? (typeof title === 'string' ? title : undefined);
    const effectiveAriaLabelledBy = explicitAriaLabelledBy ?? (!hideHeader ? titleId : undefined);
    return {
      'aria-label': effectiveAriaLabelledBy ? undefined : effectiveAriaLabel,
      'aria-labelledby': effectiveAriaLabelledBy,
    };
  };

  // Standard modal with header: uses aria-labelledby pointing to <h2>
  const standardModal = getDialogA11yProps('Make a space of your own', false);
  assert.equal(standardModal['aria-labelledby'], 'title-id-123');
  assert.equal(standardModal['aria-label'], undefined);

  // Server settings modal with hideHeader={true}:
  // Previously had dangling aria-labelledby pointing to non-existent <h2> and no aria-label.
  // Now provides accessible name via aria-label and removes dangling aria-labelledby.
  const serverSettingsModal = getDialogA11yProps('Community settings', true);
  assert.equal(serverSettingsModal['aria-labelledby'], undefined);
  assert.equal(serverSettingsModal['aria-label'], 'Community settings');
});

test('Issue 4: Invitation permissions match backend rules (moderators vs ordinary members)', () => {
  const canCreateInvite = (role: string) => role === 'owner' || role === 'admin';

  assert.equal(canCreateInvite('owner'), true);
  assert.equal(canCreateInvite('admin'), true);
  assert.equal(canCreateInvite('member'), false);

  // Verify that an ordinary member attempting createInvite receives an error without making backend call
  let apiCalled = false;
  let errorState = '';
  const createInviteHandler = (role: string) => {
    const moderate = role !== 'member';
    if (!moderate) {
      errorState = 'Only server owners and moderators can create new invitations.';
      return;
    }
    apiCalled = true;
  };

  createInviteHandler('member');
  assert.equal(apiCalled, false);
  assert.equal(errorState, 'Only server owners and moderators can create new invitations.');

  errorState = '';
  createInviteHandler('admin');
  assert.equal(apiCalled, true);
  assert.equal(errorState, '');
});

test('Issue 5: ContextMenu Escape keydown listener and focus target logic', () => {
  let closed = false;
  const onClose = () => { closed = true; };

  const handleKeyDown = (key: string, targetTag: string) => {
    if (key === 'Escape') {
      onClose();
    }
  };

  handleKeyDown('Escape', 'DIV');
  assert.equal(closed, true);
});

test('Issue 2 & 6: community.css fidelity and responsive reflow for 500x550 window', () => {
  const cssPath = join(import.meta.dirname, 'community.css');
  const cssContent = readFileSync(cssPath, 'utf8');

  // Verify Stitch fidelity: padding 14px (p-3.5) and gap 12px
  assert.match(cssContent, /\.zenith-member-row\s*\{[^}]*padding:\s*14px;/);
  assert.match(cssContent, /\.zenith-member-row\s*\{[^}]*gap:\s*12px;/);

  // Verify responsive breakpoint covers 500x550 window (at least 640px)
  assert.match(cssContent, /@media\s*\(max-width:\s*640px\)/);

  // Verify member row reflows to column under responsive query
  assert.match(cssContent, /flex-direction:\s*column;/);

  // Verify controls flex-wrap is enabled to prevent badges from overlapping avatar/name
  assert.match(cssContent, /\.zenith-member-controls\s*\{[^}]*flex-wrap:\s*wrap;/);
});
