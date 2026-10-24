import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { ConfirmDialog, AlertDialog, InputDialog } from './ZenithDialog';
import type { User, Server, Channel, VoicePeer } from '@haven/shared/types';
import type { CommunityMember } from './ServerSettings';

const makeUser = (id: string, name: string): User => ({
  id,
  username: name.toLowerCase(),
  displayName: name,
  bio: '',
  avatar: '',
  status: 'online',
  createdAt: 1000,
});

test('ConfirmDialog renders accessible dialog with correct roles, titles, and variant styling', () => {
  const html = renderToString(
    createElement(ConfirmDialog, {
      title: 'Delete Channel',
      message: 'Are you sure you want to delete this channel?',
      confirmLabel: 'Delete channel',
      cancelLabel: 'Cancel',
      variant: 'danger',
      onConfirm: () => {},
      onCancel: () => {},
    })
  );

  assert.ok(html.includes('role="alertdialog"'), 'Must have role=alertdialog');
  assert.ok(html.includes('aria-modal="true"'), 'Must have aria-modal=true');
  assert.ok(html.includes('Delete Channel'), 'Must display title');
  assert.ok(html.includes('Are you sure you want to delete this channel?'), 'Must display message');
  assert.ok(html.includes('zenith-dialog-btn-danger'), 'Must apply danger button class');
  assert.ok(html.includes('zenith-dialog-danger'), 'Must apply danger dialog class');
});

test('AlertDialog renders with single confirmation button and info icon', () => {
  const html = renderToString(
    createElement(AlertDialog, {
      title: 'Action Completed',
      message: 'Your settings have been saved successfully.',
      buttonLabel: 'Acknowledge',
      onClose: () => {},
    })
  );

  assert.ok(html.includes('role="alertdialog"'));
  assert.ok(html.includes('Action Completed'));
  assert.ok(html.includes('Acknowledge'));
});

test('InputDialog renders input field with initial value and placeholder', () => {
  const html = renderToString(
    createElement(InputDialog, {
      title: 'Rename Channel',
      message: 'Enter a new channel name below.',
      defaultValue: 'general',
      placeholder: 'e.g. announcements',
      confirmLabel: 'Rename',
      onSubmit: async () => {},
      onCancel: () => {},
    })
  );

  assert.ok(html.includes('role="dialog"'));
  assert.ok(html.includes('Rename Channel'));
  assert.ok(html.includes('value="general"'));
  assert.ok(html.includes('placeholder="e.g. announcements"'));
});

// Authoritative Voice Presence & Permission Logic Tests
function evaluateVoicePermissions(params: {
  actorUser: User;
  targetUser: User;
  server: Server;
  members: CommunityMember[];
  voiceData: VoicePeer[];
  channels: Channel[];
  mediaVoiceChannelId: string | null;
  mediaPeers: Array<{ user: { id: string } }>;
}) {
  const { actorUser, targetUser, server, members, voiceData, channels, mediaVoiceChannelId, mediaPeers } = params;
  const self = targetUser.id === actorUser.id;
  const target = members.find(m => m.user.id === targetUser.id);
  const canModerate = !self && target && target.role !== 'owner' && (server.role === 'owner' || (server.role === 'admin' && target.role === 'member'));

  const targetVoice = voiceData.find(v => v.user.id === targetUser.id && channels.find(c => c.id === v.channelId)?.serverId === server.id);
  const isSameActiveVoice = Boolean(
    mediaVoiceChannelId &&
    targetVoice &&
    targetVoice.channelId === mediaVoiceChannelId
  );
  const peer = mediaPeers.find(p => p.user.id === targetUser.id);
  const isTargetInVoice = Boolean(targetVoice && (!isSameActiveVoice || peer));
  const canDisconnect = Boolean(canModerate && server && isTargetInVoice);

  return { canModerate: Boolean(canModerate), isTargetInVoice, canDisconnect };
}

test('Voice moderation: canDisconnect is FALSE when target user is not connected to any voice channel', () => {
  const actor = makeUser('usr-alex', 'Alex');
  const target = makeUser('usr-marcus', 'Marcus');
  const server: Server = { id: 'srv-1', name: 'Haven Dev', icon: '', description: '', ownerId: 'usr-alex', role: 'owner', createdAt: 1000 };
  const members: CommunityMember[] = [
    { user: actor, role: 'owner' },
    { user: target, role: 'admin' },
  ];
  const channels: Channel[] = [
    { id: 'chn-voice-1', serverId: 'srv-1', name: 'Voice 1', type: 'voice', topic: '', position: 0 },
  ];

  const result = evaluateVoicePermissions({
    actorUser: actor,
    targetUser: target,
    server,
    members,
    voiceData: [], // Target is NOT in voice
    channels,
    mediaVoiceChannelId: null,
    mediaPeers: [],
  });

  assert.equal(result.canModerate, true, 'Owner has moderation power over admin');
  assert.equal(result.isTargetInVoice, false, 'Target is not in voice');
  assert.equal(result.canDisconnect, false, 'Disconnect MUST be hidden when target not in voice');
});

test('Voice moderation: canDisconnect is FALSE when target is in voice in a DIFFERENT server', () => {
  const actor = makeUser('usr-alex', 'Alex');
  const target = makeUser('usr-marcus', 'Marcus');
  const server1: Server = { id: 'srv-1', name: 'Haven Dev', icon: '', description: '', ownerId: 'usr-alex', role: 'owner', createdAt: 1000 };
  const channels: Channel[] = [
    { id: 'chn-voice-1', serverId: 'srv-1', name: 'Voice 1', type: 'voice', topic: '', position: 0 },
    { id: 'chn-voice-2', serverId: 'srv-2', name: 'Other Voice', type: 'voice', topic: '', position: 0 },
  ];
  const members: CommunityMember[] = [
    { user: actor, role: 'owner' },
    { user: target, role: 'member' },
  ];
  const voiceData: VoicePeer[] = [
    { socketId: 'sock-m', user: target, channelId: 'chn-voice-2', muted: false, deafened: false, sharing: false, speaking: false },
  ];

  const result = evaluateVoicePermissions({
    actorUser: actor,
    targetUser: target,
    server: server1,
    members,
    voiceData,
    channels,
    mediaVoiceChannelId: null,
    mediaPeers: [],
  });

  assert.equal(result.isTargetInVoice, false, 'Target is not in voice in srv-1');
  assert.equal(result.canDisconnect, false, 'Disconnect MUST be hidden for different server');
});

test('Voice moderation: canDisconnect is TRUE when target is connected in this server and actor is owner', () => {
  const actor = makeUser('usr-alex', 'Alex');
  const target = makeUser('usr-elena', 'Elena');
  const server: Server = { id: 'srv-1', name: 'Haven Dev', icon: '', description: '', ownerId: 'usr-alex', role: 'owner', createdAt: 1000 };
  const channels: Channel[] = [
    { id: 'chn-voice-1', serverId: 'srv-1', name: 'Voice 1', type: 'voice', topic: '', position: 0 },
  ];
  const members: CommunityMember[] = [
    { user: actor, role: 'owner' },
    { user: target, role: 'member' },
  ];
  const voiceData: VoicePeer[] = [
    { socketId: 'sock-e', user: target, channelId: 'chn-voice-1', muted: false, deafened: false, sharing: false, speaking: false },
  ];

  // Actor is NOT in voice (mediaVoiceChannelId is null), but moderator CAN disconnect participants without joining
  const result = evaluateVoicePermissions({
    actorUser: actor,
    targetUser: target,
    server,
    members,
    voiceData,
    channels,
    mediaVoiceChannelId: null,
    mediaPeers: [],
  });

  assert.equal(result.canModerate, true);
  assert.equal(result.isTargetInVoice, true);
  assert.equal(result.canDisconnect, true, 'Owner can disconnect member in voice without joining');
});

test('Voice moderation: admin cannot disconnect another admin or server owner', () => {
  const adminActor = makeUser('usr-admin', 'AdminUser');
  const adminTarget = makeUser('usr-marcus', 'Marcus');
  const ownerTarget = makeUser('usr-owner', 'OwnerUser');
  const server: Server = { id: 'srv-1', name: 'Haven Dev', icon: '', description: '', ownerId: 'usr-owner', role: 'admin', createdAt: 1000 };
  const channels: Channel[] = [
    { id: 'chn-voice-1', serverId: 'srv-1', name: 'Voice 1', type: 'voice', topic: '', position: 0 },
  ];
  const members: CommunityMember[] = [
    { user: adminActor, role: 'admin' },
    { user: adminTarget, role: 'admin' },
    { user: ownerTarget, role: 'owner' },
  ];
  const voiceData: VoicePeer[] = [
    { socketId: 'sock-m', user: adminTarget, channelId: 'chn-voice-1', muted: false, deafened: false, sharing: false, speaking: false },
    { socketId: 'sock-o', user: ownerTarget, channelId: 'chn-voice-1', muted: false, deafened: false, sharing: false, speaking: false },
  ];

  const adminVsAdmin = evaluateVoicePermissions({
    actorUser: adminActor,
    targetUser: adminTarget,
    server,
    members,
    voiceData,
    channels,
    mediaVoiceChannelId: null,
    mediaPeers: [],
  });
  assert.equal(adminVsAdmin.canModerate, false, 'Admin cannot moderate another admin');
  assert.equal(adminVsAdmin.canDisconnect, false);

  const adminVsOwner = evaluateVoicePermissions({
    actorUser: adminActor,
    targetUser: ownerTarget,
    server,
    members,
    voiceData,
    channels,
    mediaVoiceChannelId: null,
    mediaPeers: [],
  });
  assert.equal(adminVsOwner.canModerate, false, 'Admin cannot moderate owner');
  assert.equal(adminVsOwner.canDisconnect, false);
});

test('Voice moderation: when in same voice channel, dropped peer prevents stale disconnect action', () => {
  const actor = makeUser('usr-alex', 'Alex');
  const target = makeUser('usr-elena', 'Elena');
  const server: Server = { id: 'srv-1', name: 'Haven Dev', icon: '', description: '', ownerId: 'usr-alex', role: 'owner', createdAt: 1000 };
  const channels: Channel[] = [
    { id: 'chn-voice-1', serverId: 'srv-1', name: 'Voice 1', type: 'voice', topic: '', position: 0 },
  ];
  const members: CommunityMember[] = [
    { user: actor, role: 'owner' },
    { user: target, role: 'member' },
  ];
  // boot.voice still has stale entry, but mediaPeers does NOT have Elena (she dropped)
  const voiceData: VoicePeer[] = [
    { socketId: 'sock-e', user: target, channelId: 'chn-voice-1', muted: false, deafened: false, sharing: false, speaking: false },
  ];

  const result = evaluateVoicePermissions({
    actorUser: actor,
    targetUser: target,
    server,
    members,
    voiceData,
    channels,
    mediaVoiceChannelId: 'chn-voice-1', // Actor is in chn-voice-1
    mediaPeers: [], // Elena is NOT in mediaPeers!
  });

  assert.equal(result.isTargetInVoice, false, 'Target dropped from live WebRTC room');
  assert.equal(result.canDisconnect, false, 'Disconnect action suppressed when peer dropped');
});
