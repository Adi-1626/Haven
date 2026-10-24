/** One reusable lane per media kind, independent of the microphone lane.
 * Receiving is always negotiated; only an acknowledged viewer can enable sending.
 * replaceTrack(null) sends no media and does not grow SDP on watch/unwatch.
 */
export function createScreenTransport(connection: RTCPeerConnection, offered?: { video: RTCRtpTransceiver; audio: RTCRtpTransceiver }) {
  const video = offered?.video ?? connection.addTransceiver('video', { direction: 'sendrecv' });
  const audio = offered?.audio ?? connection.addTransceiver('audio', { direction: 'sendrecv' });
  video.direction = 'sendrecv';
  audio.direction = 'sendrecv';
  let desired: MediaStream | null = null;
  let closed = false;
  let queue = Promise.resolve();
  return {
    video, audio,
    senders: [video.sender, audio.sender],
    setStream(stream: MediaStream | null) {
      desired = stream;
      queue = queue.catch(() => {}).then(async () => {
        if (closed || connection.signalingState === 'closed') return;
        const current = desired;
        await video.sender.replaceTrack(current?.getVideoTracks()[0] ?? null);
        await audio.sender.replaceTrack(current?.getAudioTracks()[0] ?? null);
      });
      return queue;
    },
    close() { closed = true; desired = null; },
  };
}
