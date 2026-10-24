import { useRef, useState, type DragEvent, type ChangeEvent } from 'react';
import { Camera, Trash2, Link as LinkIcon, Smile, Upload, AlertCircle } from 'lucide-react';
import type { User } from '@haven/shared/types';
import { photoProblem, squareAvatar } from '../profile-photo';
import { Avatar } from '../components';
import { AuthenticatedImage } from '../AuthenticatedImage';
import { profileImageSource } from '../profile-images';

interface AvatarPickerProps {
  user: User;
  avatarValue: string;
  avatarFile: Blob | null;
  previewUrl: string | null;
  onChange: (avatar: string, file: Blob | null, previewUrl: string | null) => void;
  disabled?: boolean;
}

export function AvatarPicker({
  user,
  avatarValue,
  avatarFile,
  previewUrl,
  onChange,
  disabled = false,
}: AvatarPickerProps) {
  const [dragging, setDragging] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState('');
  const [mode, setMode] = useState<'upload' | 'manual'>(() => {
    return avatarValue && !avatarValue.startsWith('/api/') ? 'manual' : 'upload';
  });
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    const problem = photoProblem(file);
    if (problem) {
      setPhotoError(problem);
      return;
    }
    setPhotoBusy(true);
    setPhotoError('');
    try {
      const croppedBlob = await squareAvatar(file);
      const newPreview = URL.createObjectURL(croppedBlob);
      onChange('', croppedBlob, newPreview);
    } catch (caught) {
      setPhotoError(caught instanceof Error ? caught.message : 'Could not process that image');
    } finally {
      setPhotoBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    if (disabled || photoBusy) return;
    const file = event.dataTransfer.files[0];
    if (file) void handleFile(file);
  };

  const onFileInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) void handleFile(file);
  };

  const handleRemove = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    onChange('', null, null);
    setPhotoError('');
  };

  // Determine current visual representation
  const hasCustomAvatar = Boolean(avatarFile || previewUrl || avatarValue.trim());
  const effectiveUser = {
    ...user,
    avatar: previewUrl ? previewUrl : avatarValue,
  };

  return (
    <div className="avatar-picker-container">
      <div className="avatar-picker-preview-row">
        <div
          className={`avatar-picker-dropzone ${dragging ? 'is-dragging' : ''} ${photoBusy ? 'is-busy' : ''}`}
          onDragOver={event => {
            event.preventDefault();
            if (!disabled && !photoBusy) setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          onClick={() => {
            if (!disabled && !photoBusy && fileInputRef.current) {
              fileInputRef.current.click();
            }
          }}
          role="button"
          tabIndex={0}
          aria-label="Upload profile photo"
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              fileInputRef.current?.click();
            }
          }}
        >
          {previewUrl ? (
            <div className="avatar-picker-local-preview">
              <img src={previewUrl} alt="Avatar preview" className="avatar-preview-img" />
            </div>
          ) : (
            <Avatar user={effectiveUser} size={72} />
          )}

          <div className="avatar-picker-overlay">
            <Camera size={20} className="avatar-picker-camera-icon" />
            <span className="avatar-picker-overlay-text">
              {photoBusy ? 'Processing…' : 'Change photo'}
            </span>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            hidden
            disabled={disabled || photoBusy}
            onChange={onFileInputChange}
          />
        </div>

        <div className="avatar-picker-details">
          <div className="avatar-picker-actions">
            <button
              type="button"
              className="secondary small-button"
              disabled={disabled || photoBusy}
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload size={14} />
              <span>Upload photo</span>
            </button>

            <button
              type="button"
              className="text-link small-link"
              disabled={disabled || photoBusy}
              onClick={() => setMode(m => (m === 'upload' ? 'manual' : 'upload'))}
            >
              {mode === 'upload' ? (
                <>
                  <LinkIcon size={13} />
                  <span>Use emoji or URL</span>
                </>
              ) : (
                <>
                  <Camera size={13} />
                  <span>Upload file</span>
                </>
              )}
            </button>

            {hasCustomAvatar && (
              <button
                type="button"
                className="text-link danger-text small-link"
                disabled={disabled || photoBusy}
                onClick={handleRemove}
                title="Remove custom avatar"
              >
                <Trash2 size={13} />
                <span>Remove</span>
              </button>
            )}
          </div>

          <span className="avatar-picker-hint">
            PNG, JPEG, WebP or GIF up to 12 MB. Cropped to 512×512 square.
          </span>
        </div>
      </div>

      {mode === 'manual' && (
        <div className="avatar-picker-manual-field">
          <label className="avatar-picker-label">
            <span>AVATAR · EMOJI OR HTTPS IMAGE URL</span>
            <input
              type="text"
              aria-label="Avatar"
              value={avatarValue}
              placeholder="🌱 or https://example.com/avatar.png"
              maxLength={300}
              disabled={disabled}
              onChange={event => {
                if (previewUrl) URL.revokeObjectURL(previewUrl);
                onChange(event.target.value, null, null);
              }}
            />
          </label>
        </div>
      )}

      {photoError && (
        <div className="avatar-picker-error" role="alert">
          <AlertCircle size={14} />
          <span>{photoError}</span>
        </div>
      )}
    </div>
  );
}
