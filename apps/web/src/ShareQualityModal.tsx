import { useEffect, useState } from 'react';
import { Check, ChevronDown, Monitor, MonitorUp, SlidersHorizontal, Square, X } from 'lucide-react';
import type { useMedia } from './media';
import { targetDimensions } from './media-quality';
import StreamStatistics from './StreamStatistics';
import './zenith-media-modals.css';

export interface ShareQualityModalProps {
  media: ReturnType<typeof useMedia>;
  onClose: () => void;
}

export function ShareQualityModal({ media, onClose }: ShareQualityModalProps) {
  const [height, setHeight] = useState<number | 'native'>(media.settings.shareHeight);
  const [fps, setFps] = useState<15 | 30 | 60>(media.settings.shareFps);
  const [bitrate, setBitrate] = useState<number>(media.settings.shareBitrateMbps);
  const [busy, setBusy] = useState(false);
  const [applied, setApplied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => () => media.setVideoDetailsOpen(false), [media.setVideoDetailsOpen]);

  useEffect(() => {
    setHeight(media.settings.shareHeight);
    setFps(media.settings.shareFps);
    setBitrate(media.settings.shareBitrateMbps);
  }, [media.settings.shareHeight, media.settings.shareFps, media.settings.shareBitrateMbps]);

  const handleApply = async () => {
    setBusy(true);
    setError(null);
    try {
      await media.setShareQuality(height, fps, bitrate);
      setApplied(true);
      setTimeout(() => setApplied(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not apply share quality');
    } finally {
      setBusy(false);
    }
  };

  const isSharing = Boolean(media.sharing);
  // Measured from the live capture. Before sharing nothing is known: the picker chooses the source.
  const nativeWidth = media.quality.nativeWidth;
  const nativeHeight = media.quality.nativeHeight;
  const measured = nativeWidth > 0 && nativeHeight > 0;
  const target = measured ? targetDimensions(nativeWidth, nativeHeight, height) : undefined;
  const targetResolution = target ? `${target.width} × ${target.height}` : height === 'native' ? 'native resolution of the chosen source' : `${height}p, or the source's height if smaller`;
  const targetFps = fps;
  const targetBitrate = bitrate;

  const sliderPercent = Math.min(100, Math.max(0, ((bitrate - 1) / 49) * 100));

  return (
    <section className="zenith-media-card" aria-label="Screen share quality settings">
      {/* Header */}
      <div className="zenith-media-header">
        <div className="zenith-media-title-group">
          <div className="zenith-media-icon-badge" aria-hidden="true">
            <SlidersHorizontal size={18} />
          </div>
          <div>
            <h2 className="zenith-media-title">Screen share quality</h2>
          </div>
        </div>
        <button
          type="button"
          className="zenith-media-close-btn"
          onClick={onClose}
          aria-label="Close quality dialog"
          title="Close dialog"
        >
          <X size={18} />
        </button>
      </div>

      {error && (
        <div className="form-error" role="alert" style={{ marginBottom: '14px' }}>
          {error}
        </div>
      )}

      {/* Captured Source Resolution Banner */}
      <div className="zenith-share-source-banner">
        <div className="zenith-share-source-left">
          <Monitor size={18} aria-hidden="true" />
          <span>
            {isSharing && measured
              ? `Captured source: ${nativeWidth} × ${nativeHeight}`
              : 'Ready to capture: native resolution of the screen or window you choose'}
          </span>
        </div>
        {isSharing ? (
          <span className="zenith-share-live-tag">
            <span className="zenith-share-live-dot" aria-hidden="true" />
            LIVE
          </span>
        ) : (
          <button
            type="button"
            className="zenith-share-start-btn"
            disabled={!media.voiceChannelId}
            onClick={() => {
              void media.startShare();
              onClose();
            }}
            title={media.voiceChannelId ? 'Choose a screen to share' : 'Connect to a voice channel to share screen'}
          >
            <MonitorUp size={13} />
            <span>Share screen</span>
          </button>
        )}
      </div>

      {/* Gaming Mode Capping Notice */}
      {media.settings.gamingMode && (
        <div className="zenith-gaming-mode-banner" role="status">
          Gaming Mode temporarily caps sharing at 720p, 30 fps and 3 Mbps per viewer. Your selections below are saved and restored when it is turned off.
        </div>
      )}

      {/* Controls Stack */}
      <div className="zenith-share-controls">
        {/* Resolution Control */}
        <div className="zenith-control-group">
          <label htmlFor="share-resolution-select" className="zenith-control-label">
            Resolution
          </label>
          <div className="zenith-select-wrapper">
            <select
              id="share-resolution-select"
              className="zenith-share-select"
              value={height}
              onChange={e => setHeight(e.target.value === 'native' ? 'native' : Number(e.target.value))}
            >
              {media.shareOptions.map(option => (
                <option key={option.height} value={option.height}>
                  {option.label}
                </option>
              ))}
            </select>
            <div className="zenith-select-chevron" aria-hidden="true">
              <ChevronDown size={16} />
            </div>
          </div>
          <p className="zenith-control-help">
            Current output target: {targetResolution}, {targetFps} fps, up to {targetBitrate} Mbps per viewer. Viewers connected through a relay server receive at most 720p, 15 fps and 1 Mbps.
          </p>
        </div>

        {/* Frame Rate Control */}
        <div className="zenith-control-group">
          <label htmlFor="share-fps-select" className="zenith-control-label">
            Frame Rate
          </label>
          <div className="zenith-select-wrapper">
            <select
              id="share-fps-select"
              className="zenith-share-select"
              value={fps}
              onChange={e => setFps(Number(e.target.value) as 15 | 30 | 60)}
            >
              <option value={60}>60 fps · smooth motion</option>
              <option value={30}>30 fps · standard motion</option>
              <option value={15}>15 fps · low bandwidth</option>
            </select>
            <div className="zenith-select-chevron" aria-hidden="true">
              <ChevronDown size={16} />
            </div>
          </div>
        </div>

        {/* Bitrate Budget Slider */}
        <div className="zenith-control-group">
          <div className="zenith-control-label">
            <span>Bitrate Budget</span>
            <span className="zenith-control-value-badge" aria-label={`Current bitrate ${bitrate} megabits per second`}>
              {bitrate} Mbps
            </span>
          </div>

          <div className="zenith-slider-container">
            <input
              type="range"
              min="1"
              max="50"
              step="1"
              value={bitrate}
              aria-label="Bitrate budget in Mbps"
              className="zenith-slider-input"
              style={{
                background: `linear-gradient(to right, #c0c1ff ${sliderPercent}%, #101319 ${sliderPercent}%)`,
              }}
              onChange={e => setBitrate(Number(e.target.value))}
            />
            <div className="zenith-slider-markers" aria-hidden="true">
              <span>1 Mbps</span>
              <span>12 Mbps (Recommended)</span>
              <span>50 Mbps</span>
            </div>
          </div>

          <p className="zenith-share-footnote">
            Budget is per viewer. WebRTC adapts to congestion; achieved quality depends on your hardware and connection.
          </p>
        </div>
      </div>

      <StreamStatistics quality={media.quality} onToggle={media.setVideoDetailsOpen} />

      {/* Footer Actions */}
      <div className="zenith-share-footer">
        <button
          type="button"
          className="zenith-stop-share-btn"
          disabled={!isSharing}
          onClick={() => {
            media.stopShare();
            onClose();
          }}
          title={isSharing ? 'Stop sharing screen' : 'Not currently sharing screen'}
        >
          <Square size={14} fill="currentColor" />
          <span>Stop sharing</span>
        </button>

        <div className="zenith-share-actions-right">
          <button
            type="button"
            className="zenith-share-cancel-btn"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="button"
            className="zenith-share-apply-btn"
            disabled={busy}
            onClick={() => void handleApply()}
          >
            <Check size={15} />
            <span>{busy ? 'Applying…' : applied ? 'Applied!' : 'Apply quality'}</span>
          </button>
        </div>
      </div>
    </section>
  );
}
