type Stat = { id: string; type: string; selectedCandidatePairId?: string; selected?: boolean; nominated?: boolean; state?: string; localCandidateId?: string; remoteCandidateId?: string; candidateType?: string };

/**
 * Whether the connection's selected ICE candidate pair runs through a TURN relay, on either side.
 * `undefined` when the report does not identify the selected pair or its candidates (connection
 * still checking, or a browser that omits them): callers keep their previous decision instead of
 * degrading a direct viewer on missing data.
 */
export function selectedPairRelayed(report: RTCStatsReport | undefined): boolean | undefined {
  if (!report) return undefined;
  const stats = new Map<string, Stat>();
  let selectedId: string | undefined;
  let flagged: Stat | undefined;
  report.forEach((stat: Stat) => {
    stats.set(stat.id, stat);
    // Chromium names the pair in use on the transport; Firefox flags the pair itself.
    if (stat.type === 'transport' && stat.selectedCandidatePairId) selectedId = stat.selectedCandidatePairId;
    if (stat.type === 'candidate-pair' && (stat.selected || (stat.nominated && stat.state === 'succeeded'))) flagged ??= stat;
  });
  const pair = (selectedId ? stats.get(selectedId) : undefined) ?? flagged;
  if (!pair?.localCandidateId || !pair.remoteCandidateId) return undefined;
  const local = stats.get(pair.localCandidateId)?.candidateType;
  const remote = stats.get(pair.remoteCandidateId)?.candidateType;
  if (!local || !remote) return undefined;
  return local === 'relay' || remote === 'relay';
}
