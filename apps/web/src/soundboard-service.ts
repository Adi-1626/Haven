import type { Sound, User } from '@haven/shared/types';
import { api, fetchResource } from './api';

const MUTED_USERS_KEY = 'haven.muted-soundboard-users';
const ENTRY_SOUNDS_KEY = 'haven.entry-sounds';

export interface SoundboardState {
  volume: number; // 0.0 to 1.0
  muted: boolean;
  previousVolume: number;
}

export class SoundboardService {
  private activeSources = new Set<AudioBufferSourceNode>();
  private activeGains = new Set<GainNode>();
  private audioContext: AudioContext | null = null;
  private mutedUsers = new Set<string>();
  private previousVolume = 1;
  private generation = 0;
  private playbackSettings: { volume: number; isMuted: boolean; outputVolume: number; outputDeviceId?: string } | null = null;
  private sourceUsers = new Map<GainNode, string | undefined>();

  updatePlaybackSettings(settings: { volume: number; isMuted: boolean; outputVolume: number; outputDeviceId?: string }): void {
    this.playbackSettings = settings;
    for (const [gain, userId] of this.sourceUsers) gain.gain.value = this.effectiveGain(settings, userId);
    if (this.audioContext && (this.audioContext as any).setSinkId) void (this.audioContext as any).setSinkId(settings.outputDeviceId || '').catch(() => {});
  }

  private effectiveGain(options: { volume?: number; isMuted?: boolean; outputVolume?: number }, userId?: string): number {
    if (options.isMuted || (userId && this.isUserSoundboardMuted(userId))) return 0;
    const gain = (options.volume ?? 1) * (options.outputVolume ?? 1);
    return Number.isFinite(gain) ? Math.max(0, Math.min(1, gain)) : 0;
  }

  constructor() {
    this.loadMutedUsers();
  }

  // ── 1. Per-User Soundboard Mute ──────────────────────────────────
  private loadMutedUsers() {
    if (typeof localStorage === 'undefined') return;
    try {
      const raw = localStorage.getItem(MUTED_USERS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          this.mutedUsers = new Set(parsed.filter(id => typeof id === 'string'));
        }
      }
    } catch {}
  }

  private persistMutedUsers() {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(MUTED_USERS_KEY, JSON.stringify(Array.from(this.mutedUsers)));
    } catch {}
  }

  isUserSoundboardMuted(userId: string): boolean {
    if (!userId) return false;
    return this.mutedUsers.has(userId);
  }

  setUserSoundboardMuted(userId: string, muted: boolean): void {
    if (!userId) return;
    if (muted) {
      this.mutedUsers.add(userId);
    } else {
      this.mutedUsers.delete(userId);
    }
    this.persistMutedUsers();
    if (this.playbackSettings) this.updatePlaybackSettings(this.playbackSettings);
  }

  clearMutedUsers(): void {
    this.mutedUsers.clear();
    this.persistMutedUsers();
  }

  // ── 2. Voice Entry Sounds ────────────────────────────────────────
  getEntrySoundId(serverId: string, user?: User | null): string | null {
    if (!serverId) return null;
    // 1. Authoritative: user account settings in database
    const dbSettings = user?.settings as Record<string, unknown> | undefined;
    const dbEntrySounds = dbSettings?.entrySounds as Record<string, string> | undefined;
    if (user) return typeof dbEntrySounds?.[serverId] === 'string' ? dbEntrySounds[serverId] || null : null;

    // 2. Local fallback cache
    if (typeof localStorage !== 'undefined') {
      try {
        const raw = localStorage.getItem(ENTRY_SOUNDS_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed[serverId] === 'string') {
            return parsed[serverId] || null;
          }
        }
      } catch {}
    }

    return null;
  }

  async saveEntrySound(
    serverId: string,
    soundId: string | null,
    currentUser: User
  ): Promise<Record<string, string>> {
    if (!serverId) return {};
    const existingDbSettings = (currentUser.settings || {}) as Record<string, unknown>;
    const existingEntrySounds = ((existingDbSettings.entrySounds as Record<string, string>) || {});

    const updatedEntrySounds = { ...existingEntrySounds };
    if (soundId) {
      updatedEntrySounds[serverId] = soundId;
    } else {
      delete updatedEntrySounds[serverId];
    }

    // Save first: failed persistence must not masquerade as an account preference.
    await api<{ user: User }>('/users/me', 'PATCH', { settings: { entrySounds: updatedEntrySounds } });

    // Update passed-in user reference immediately
    if (!currentUser.settings) (currentUser as any).settings = {};
    (currentUser.settings as any).entrySounds = updatedEntrySounds;

    // Cache locally immediately
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem(ENTRY_SOUNDS_KEY, JSON.stringify(updatedEntrySounds));
      } catch {}
    }

    return updatedEntrySounds;
  }

  // ── 3. Audio Pipeline & Playback ────────────────────────────────
  private async getAudioContext(): Promise<AudioContext> {
    if (!this.audioContext || this.audioContext.state === 'closed') {
      const AudioCtx = globalThis.AudioContext || (window as any).webkitAudioContext;
      this.audioContext = new AudioCtx({ latencyHint: 'interactive' });
    }
    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume().catch(() => {});
    }
    return this.audioContext;
  }

  /**
   * Play a soundboard sound with strict volume, mute, and per-user filtering.
   * Returns true if the sound was played, false if it was suppressed (muted).
   */
  async playSound(
    url: string,
    options?: {
      volume?: number; // 0 to 1
      isMuted?: boolean;
      userId?: string;
      outputVolume?: number; // master output volume (0 to 1)
      outputDeviceId?: string;
    }
  ): Promise<boolean> {
    const operation = this.generation;
    const userId = options?.userId;
    const currentOptions = () => ({ ...options, ...this.playbackSettings });
    if (this.effectiveGain(currentOptions(), userId) <= 0) return false;

    try {
      const ctx = await this.getAudioContext();
      if ((ctx as any).setSinkId) {
        try {
          await (ctx as any).setSinkId(currentOptions().outputDeviceId || '');
        } catch {}
      }

      const response = await fetchResource(url);
      if (!response.ok) {
        return false;
      }
      const arrayBuffer = await response.arrayBuffer();
      const audioBuffer = await ctx.decodeAudioData(arrayBuffer);

      if (ctx.state === 'closed' || operation !== this.generation) return false;
      const effectiveGain = this.effectiveGain(currentOptions(), userId);
      if (effectiveGain <= 0) return false;

      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;

      const gainNode = ctx.createGain();
      gainNode.gain.setValueAtTime(effectiveGain, ctx.currentTime);

      source.connect(gainNode).connect(ctx.destination);

      this.activeSources.add(source);
      this.activeGains.add(gainNode);
      this.sourceUsers.set(gainNode, userId);

      source.onended = () => {
        this.activeSources.delete(source);
        this.activeGains.delete(gainNode);
        this.sourceUsers.delete(gainNode);
        try {
          source.disconnect();
          gainNode.disconnect();
        } catch {}
      };

      source.start();
      return true;
    } catch (err) {
      console.warn('[SoundboardService] Playback failed:', err);
      return false;
    }
  }

  stopAllSounds(): void {
    this.generation++;
    for (const source of this.activeSources) {
      try {
        source.stop();
        source.disconnect();
      } catch {}
    }
    for (const gain of this.activeGains) {
      try {
        gain.disconnect();
      } catch {}
    }
    this.activeSources.clear();
    this.activeGains.clear();
    this.sourceUsers.clear();
    const context = this.audioContext;
    this.audioContext = null;
    if (context && context.state !== 'closed') void context.close().catch(() => {});
  }
}

export const soundboardService = new SoundboardService();
