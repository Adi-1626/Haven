export type VoiceDiagnosticType = 'ice_failed' | 'ice_timeout' | 'recovery_failed' | 'retries_exhausted' | 'recovered';
type CandidateCounts = Partial<Record<'host' | 'srflx' | 'prflx' | 'relay', number>>;
export interface IceSummary {
  pairs: { total: number; failed: number; succeeded: number; inProgress: number; waiting: number; frozen: number; selected: boolean };
  local: CandidateCounts;
  remote: CandidateCounts;
}
export interface VoiceDiagnostic extends Partial<IceSummary> {
  v: 1;
  type: VoiceDiagnosticType;
  peer: string;
  connectionState: RTCPeerConnectionState;
  iceState: RTCIceConnectionState;
  signalingState: RTCSignalingState;
  gatheringState: RTCIceGatheringState;
  retryCount: number;
  durationMs: number;
  checkingMs?: number;
  everConnected: boolean;
  resettable: boolean;
  browser: 'chromium' | 'firefox' | 'safari' | 'other';
  client: 'web' | 'desktop';
}
export interface PeerContext { peer: string; retryCount: number; startedAt: number; checkingSince: number; everConnected: boolean; resettable: boolean }

const pairStates = { failed: 'failed', succeeded: 'succeeded', 'in-progress': 'inProgress', waiting: 'waiting', frozen: 'frozen' } as const;
const candidateTypes = new Set(['host', 'srflx', 'prflx', 'relay']);

/**
 * Counts candidate pairs by state and candidates by type. These tell a blocked STUN server
 * (no srflx), endpoint-dependent NAT (srflx on both sides, every pair failed) and lost signaling
 * (no remote candidates) apart. Addresses, ports and credentials are never read.
 */
export function summarizeIceStats(stats: RTCStatsReport): IceSummary {
  const summary: IceSummary = { pairs: { total: 0, failed: 0, succeeded: 0, inProgress: 0, waiting: 0, frozen: 0, selected: false }, local: {}, remote: {} };
  stats.forEach((stat: { type: string; state?: string; selected?: boolean; nominated?: boolean; selectedCandidatePairId?: string; candidateType?: string }) => {
    if (stat.type === 'candidate-pair') {
      summary.pairs.total++;
      const state = pairStates[stat.state as keyof typeof pairStates];
      if (state) summary.pairs[state]++;
      // Firefox flags the pair in use; Chromium names it on the transport.
      if (stat.selected || (stat.nominated && stat.state === 'succeeded')) summary.pairs.selected = true;
    } else if (stat.type === 'transport' && stat.selectedCandidatePairId) summary.pairs.selected = true;
    else if ((stat.type === 'local-candidate' || stat.type === 'remote-candidate') && candidateTypes.has(stat.candidateType ?? '')) {
      const side = stat.type === 'local-candidate' ? summary.local : summary.remote;
      const type = stat.candidateType as keyof CandidateCounts;
      side[type] = Math.min(10_000, (side[type] ?? 0) + 1);
    }
  });
  return summary;
}

function browser(): VoiceDiagnostic['browser'] {
  const agent = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  return /Firefox\//.test(agent) ? 'firefox' : /Chrom(e|ium)\/|Electron\//.test(agent) ? 'chromium' : /Safari\//.test(agent) ? 'safari' : 'other';
}

/**
 * Reports failing and recovered peer connections to the backend. Each failure kind is reported
 * once per peer and retry, at most `perMinute` times overall, and statistics are read only when a
 * report is due: a healthy call never pays for diagnostics.
 */
export function createVoiceDiagnostics(send: (report: VoiceDiagnostic) => void, { perMinute = 10, now = Date.now } = {}) {
  const reported = new Set<string>();
  let tokens = perMinute, refilledAt = now();
  const elapsed = (since: number) => Math.min(86_400_000, Math.max(0, Math.round(now() - since)));
  return {
    async report(type: VoiceDiagnosticType, connection: RTCPeerConnection, context: PeerContext) {
      const key = `${context.peer}:${type}:${context.retryCount}`;
      if (reported.has(key)) return false;
      tokens = Math.min(perMinute, tokens + (now() - refilledAt) * perMinute / 60_000);
      refilledAt = now();
      if (tokens < 1) return false;
      tokens--;
      reported.add(key);
      if (reported.size > 512) reported.delete(reported.values().next().value!);
      let summary: Partial<IceSummary> = {};
      try { summary = summarizeIceStats(await connection.getStats()); } catch { /* A closed connection has no statistics; report its states. */ }
      send({
        v: 1, type, peer: context.peer,
        connectionState: connection.connectionState, iceState: connection.iceConnectionState,
        signalingState: connection.signalingState, gatheringState: connection.iceGatheringState,
        retryCount: Math.min(100, context.retryCount), durationMs: elapsed(context.startedAt),
        ...(type === 'recovered' ? {} : { checkingMs: elapsed(context.checkingSince) }),
        everConnected: context.everConnected, resettable: context.resettable,
        ...summary, browser: browser(), client: typeof window !== 'undefined' && window.haven ? 'desktop' : 'web',
      });
      return true;
    },
  };
}
