/** Remote ICE credentials named by the SDP; every ICE restart replaces them. */
export function iceUfrags(sdp: string | undefined) {
  return new Set(Array.from((sdp ?? '').matchAll(/^a=ice-ufrag:(\S+)\s*$/gm), match => match[1]));
}

const pendingLimit = 256;
const retiredLimit = 32;

/**
 * Routes remote candidates to the ICE generation they belong to. Signaling delivers each
 * peer's messages in order, but a candidate can still precede the description that starts
 * its generation (first offer, ICE restart, ignored offer collision) or trail one that ended
 * it. Candidates for a generation that has not been applied yet wait; candidates for one the
 * remote peer has replaced can never be used and are discarded instead of being reported as
 * `Unknown ufrag` failures.
 */
export function createCandidateRouter() {
  let remote: Set<string> | null = null;
  const retired = new Set<string>();
  const ignored = new Set<string>();
  let pending: RTCIceCandidateInit[] = [];
  let discarded = 0;

  function retire(ufrag: string) {
    retired.delete(ufrag);
    retired.add(ufrag);
    if (retired.size > retiredLimit) retired.delete(retired.values().next().value!);
  }
  function ready(candidate: RTCIceCandidateInit) {
    const ufrag = candidate.usernameFragment;
    // Credential-less candidates cannot be matched; the browser validates them on add.
    return ufrag ? remote!.has(ufrag) || remote!.size === 0 : true;
  }

  return {
    /** Returns the candidate when it can be added now, or null when it waits or is stale. */
    receive(candidate: RTCIceCandidateInit, ignoringOffer = false) {
      const ufrag = candidate.usernameFragment;
      if (ufrag && retired.has(ufrag)) { discarded++; return null; }
      if (remote && !(ignoringOffer && !ufrag) && ready(candidate)) return candidate;
      if (pending.length >= pendingLimit) throw new Error(`More than ${pendingLimit} ICE candidates arrived without a matching remote description`);
      pending.push(candidate);
      return null;
    },
    /** Records an applied remote description and returns the waiting candidates it unlocks. */
    applied(sdp: string | undefined) {
      const next = iceUfrags(sdp);
      remote?.forEach(ufrag => { if (!next.has(ufrag)) retire(ufrag); });
      // The remote side rolled back an offer we ignored unless its credentials survived.
      ignored.forEach(ufrag => { if (!next.has(ufrag)) retire(ufrag); });
      ignored.clear();
      next.forEach(ufrag => retired.delete(ufrag));
      remote = next;
      const unlocked: RTCIceCandidateInit[] = [];
      pending = pending.filter(candidate => {
        if (candidate.usernameFragment && retired.has(candidate.usernameFragment)) { discarded++; return false; }
        if (!ready(candidate)) return true;
        unlocked.push(candidate);
        return false;
      });
      return unlocked;
    },
    /** A colliding offer was ignored; its candidates wait until the remote side resolves it. */
    ignoredOffer(sdp: string | undefined) {
      iceUfrags(sdp).forEach(ufrag => { if (!remote?.has(ufrag)) ignored.add(ufrag); });
    },
    get pending() { return pending.length; },
    get discarded() { return discarded; },
  };
}
