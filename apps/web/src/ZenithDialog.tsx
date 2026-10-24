import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import { AlertTriangle, Info, Loader2, X } from 'lucide-react';

export interface ConfirmDialogProps {
  open?: boolean;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'warning' | 'primary';
  icon?: ReactNode;
  busy?: boolean;
  error?: string;
  autoFocusButton?: 'confirm' | 'cancel';
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
  testId?: string;
}

export function ConfirmDialog({
  open = true,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'danger',
  icon,
  busy: externalBusy = false,
  error: externalError = '',
  autoFocusButton = 'cancel',
  onConfirm,
  onCancel,
  testId = 'zenith-confirm-dialog',
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const confirmBtnRef = useRef<HTMLButtonElement>(null);
  const cancelBtnRef = useRef<HTMLButtonElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const pendingRef = useRef(false);
  const mountedRef = useRef(true);

  const [localBusy, setLocalBusy] = useState(false);
  const [localError, setLocalError] = useState('');

  const titleId = useId();
  const descId = useId();

  const isBusy = externalBusy || localBusy;
  const currentError = localError || externalError;

  // Track mount state
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Save opener element and manage dialog lifecycle
  useEffect(() => {
    if (!open) return;

    openerRef.current = document.activeElement as HTMLElement | null;
    const dialogElement = dialogRef.current;
    if (!dialogElement) return;

    if (!dialogElement.open) {
      dialogElement.showModal();
    }

    // Set initial focus safely
    const timer = setTimeout(() => {
      if (autoFocusButton === 'confirm') {
        confirmBtnRef.current?.focus();
      } else {
        cancelBtnRef.current?.focus();
      }
    }, 20);

    const handleCancelEvent = (event: Event) => {
      event.preventDefault();
      if (!isBusy) {
        onCancel();
      }
    };

    dialogElement.addEventListener('cancel', handleCancelEvent);

    return () => {
      clearTimeout(timer);
      dialogElement.removeEventListener('cancel', handleCancelEvent);
      if (dialogElement.open) {
        dialogElement.close();
      }
      // Restore focus to original opener element
      if (openerRef.current && typeof openerRef.current.focus === 'function' && openerRef.current.isConnected) {
        openerRef.current.focus();
      }
    };
  }, [open, autoFocusButton, isBusy, onCancel]);

  const handleConfirm = async () => {
    if (pendingRef.current || isBusy) return;

    pendingRef.current = true;
    setLocalBusy(true);
    setLocalError('');

    try {
      await onConfirm();
    } catch (err) {
      if (mountedRef.current) {
        setLocalError(err instanceof Error ? err.message : 'Action failed. Please try again.');
        setLocalBusy(false);
      }
    } finally {
      pendingRef.current = false;
      if (mountedRef.current) {
        setLocalBusy(false);
      }
    }
  };

  if (!open) return null;

  const defaultIcon = variant === 'danger'
    ? <AlertTriangle size={20} />
    : variant === 'warning'
      ? <AlertTriangle size={20} />
      : <Info size={20} />;

  const confirmBtnClass = variant === 'danger'
    ? 'zenith-dialog-btn-danger'
    : variant === 'warning'
      ? 'zenith-dialog-btn-warning'
      : 'zenith-dialog-btn-primary';

  return (
    <dialog
      ref={dialogRef}
      role="alertdialog"
      className={`modal zenith-modal-frame zenith-dialog-modal zenith-dialog-${variant}`}
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descId}
      data-testid={testId}
      onClick={event => {
        if (event.target === dialogRef.current && !isBusy) {
          onCancel();
        }
      }}
      onKeyDown={event => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          if (!isBusy) onCancel();
        }
      }}
    >
      <div className="zenith-dialog-inner">
        <div className="zenith-dialog-header">
          <div className={`zenith-dialog-icon zenith-dialog-icon-${variant}`}>
            {icon || defaultIcon}
          </div>
          <div className="zenith-dialog-title-group">
            <h3 className="zenith-dialog-title" id={titleId}>
              {title}
            </h3>
          </div>
          <button
            type="button"
            className="zenith-dialog-close-btn"
            disabled={isBusy}
            onClick={onCancel}
            aria-label="Close dialog"
          >
            <X size={16} />
          </button>
        </div>

        <div className="zenith-dialog-body" id={descId}>
          {typeof message === 'string' ? <p>{message}</p> : message}
        </div>

        {currentError && (
          <div className="zenith-dialog-error" role="alert">
            <AlertTriangle size={14} />
            <span>{currentError}</span>
          </div>
        )}

        <div className="zenith-dialog-actions">
          <button
            ref={cancelBtnRef}
            type="button"
            className="zenith-dialog-btn zenith-dialog-btn-cancel"
            disabled={isBusy}
            onClick={onCancel}
            data-testid={`${testId}-cancel`}
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmBtnRef}
            type="button"
            className={`zenith-dialog-btn ${confirmBtnClass}`}
            disabled={isBusy}
            onClick={() => void handleConfirm()}
            data-testid={`${testId}-confirm`}
          >
            {isBusy ? (
              <>
                <Loader2 size={13} className="zenith-spin" />
                <span>Working…</span>
              </>
            ) : (
              confirmLabel
            )}
          </button>
        </div>
      </div>
    </dialog>
  );
}

export interface AlertDialogProps {
  open?: boolean;
  title: string;
  message: ReactNode;
  buttonLabel?: string;
  variant?: 'info' | 'warning' | 'danger';
  icon?: ReactNode;
  onClose: () => void;
  testId?: string;
}

export function AlertDialog({
  open = true,
  title,
  message,
  buttonLabel = 'Dismiss',
  variant = 'info',
  icon,
  onClose,
  testId = 'zenith-alert-dialog',
}: AlertDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  const titleId = useId();
  const descId = useId();

  useEffect(() => {
    if (!open) return;
    openerRef.current = document.activeElement as HTMLElement | null;
    const dialogElement = dialogRef.current;
    if (!dialogElement) return;

    if (!dialogElement.open) {
      dialogElement.showModal();
    }

    const timer = setTimeout(() => {
      buttonRef.current?.focus();
    }, 20);

    const handleCancelEvent = (event: Event) => {
      event.preventDefault();
      onClose();
    };

    dialogElement.addEventListener('cancel', handleCancelEvent);

    return () => {
      clearTimeout(timer);
      dialogElement.removeEventListener('cancel', handleCancelEvent);
      if (dialogElement.open) dialogElement.close();
      if (openerRef.current && typeof openerRef.current.focus === 'function' && openerRef.current.isConnected) {
        openerRef.current.focus();
      }
    };
  }, [open, onClose]);

  if (!open) return null;

  const defaultIcon = variant === 'danger'
    ? <AlertTriangle size={20} />
    : variant === 'warning'
      ? <AlertTriangle size={20} />
      : <Info size={20} />;

  const btnClass = variant === 'danger'
    ? 'zenith-dialog-btn-danger'
    : variant === 'warning'
      ? 'zenith-dialog-btn-warning'
      : 'zenith-dialog-btn-primary';

  return (
    <dialog
      ref={dialogRef}
      role="alertdialog"
      className={`modal zenith-modal-frame zenith-dialog-modal zenith-dialog-${variant}`}
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descId}
      data-testid={testId}
      onClick={event => {
        if (event.target === dialogRef.current) onClose();
      }}
      onKeyDown={event => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="zenith-dialog-inner">
        <div className="zenith-dialog-header">
          <div className={`zenith-dialog-icon zenith-dialog-icon-${variant}`}>
            {icon || defaultIcon}
          </div>
          <div className="zenith-dialog-title-group">
            <h3 className="zenith-dialog-title" id={titleId}>
              {title}
            </h3>
          </div>
          <button
            type="button"
            className="zenith-dialog-close-btn"
            onClick={onClose}
            aria-label="Close dialog"
          >
            <X size={16} />
          </button>
        </div>

        <div className="zenith-dialog-body" id={descId}>
          {typeof message === 'string' ? <p>{message}</p> : message}
        </div>

        <div className="zenith-dialog-actions">
          <button
            ref={buttonRef}
            type="button"
            className={`zenith-dialog-btn ${btnClass}`}
            onClick={onClose}
            data-testid={`${testId}-dismiss`}
          >
            {buttonLabel}
          </button>
        </div>
      </div>
    </dialog>
  );
}

export interface InputDialogProps {
  open?: boolean;
  title: string;
  message?: ReactNode;
  placeholder?: string;
  defaultValue?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  busy?: boolean;
  error?: string;
  validate?: (value: string) => string | undefined;
  onSubmit: (value: string) => void | Promise<void>;
  onCancel: () => void;
  testId?: string;
}

export function InputDialog({
  open = true,
  title,
  message,
  placeholder = '',
  defaultValue = '',
  confirmLabel = 'Submit',
  cancelLabel = 'Cancel',
  busy: externalBusy = false,
  error: externalError = '',
  validate,
  onSubmit,
  onCancel,
  testId = 'zenith-input-dialog',
}: InputDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const pendingRef = useRef(false);
  const mountedRef = useRef(true);

  const [value, setValue] = useState(defaultValue);
  const [localBusy, setLocalBusy] = useState(false);
  const [localError, setLocalError] = useState('');

  const titleId = useId();
  const descId = useId();

  const isBusy = externalBusy || localBusy;
  const currentError = localError || externalError;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    setValue(defaultValue);
    setLocalError('');
    openerRef.current = document.activeElement as HTMLElement | null;
    const dialogElement = dialogRef.current;
    if (!dialogElement) return;

    if (!dialogElement.open) {
      dialogElement.showModal();
    }

    const timer = setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 20);

    const handleCancelEvent = (event: Event) => {
      event.preventDefault();
      if (!isBusy) onCancel();
    };

    dialogElement.addEventListener('cancel', handleCancelEvent);

    return () => {
      clearTimeout(timer);
      dialogElement.removeEventListener('cancel', handleCancelEvent);
      if (dialogElement.open) dialogElement.close();
      if (openerRef.current && typeof openerRef.current.focus === 'function' && openerRef.current.isConnected) {
        openerRef.current.focus();
      }
    };
  }, [open, defaultValue, isBusy, onCancel]);

  const handleSubmit = async (event?: FormEvent) => {
    event?.preventDefault();
    if (pendingRef.current || isBusy) return;

    if (validate) {
      const validationError = validate(value);
      if (validationError) {
        setLocalError(validationError);
        return;
      }
    }

    pendingRef.current = true;
    setLocalBusy(true);
    setLocalError('');

    try {
      await onSubmit(value);
    } catch (err) {
      if (mountedRef.current) {
        setLocalError(err instanceof Error ? err.message : 'Action failed. Please try again.');
        setLocalBusy(false);
      }
    } finally {
      pendingRef.current = false;
      if (mountedRef.current) {
        setLocalBusy(false);
      }
    }
  };

  if (!open) return null;

  return (
    <dialog
      ref={dialogRef}
      role="dialog"
      className="modal zenith-modal-frame zenith-dialog-modal zenith-dialog-primary"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={message ? descId : undefined}
      data-testid={testId}
      onClick={event => {
        if (event.target === dialogRef.current && !isBusy) {
          onCancel();
        }
      }}
      onKeyDown={event => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          if (!isBusy) onCancel();
        }
      }}
    >
      <form onSubmit={handleSubmit} className="zenith-dialog-inner">
        <div className="zenith-dialog-header">
          <div className="zenith-dialog-icon zenith-dialog-icon-primary">
            <Info size={20} />
          </div>
          <div className="zenith-dialog-title-group">
            <h3 className="zenith-dialog-title" id={titleId}>
              {title}
            </h3>
          </div>
          <button
            type="button"
            className="zenith-dialog-close-btn"
            disabled={isBusy}
            onClick={onCancel}
            aria-label="Close dialog"
          >
            <X size={16} />
          </button>
        </div>

        {message && (
          <div className="zenith-dialog-body" id={descId}>
            {typeof message === 'string' ? <p>{message}</p> : message}
          </div>
        )}

        <div className="zenith-dialog-input-wrap">
          <input
            ref={inputRef}
            type="text"
            className="zenith-dialog-input"
            value={value}
            disabled={isBusy}
            placeholder={placeholder}
            onChange={e => {
              setValue(e.target.value);
              if (localError) setLocalError('');
            }}
          />
        </div>

        {currentError && (
          <div className="zenith-dialog-error" role="alert">
            <AlertTriangle size={14} />
            <span>{currentError}</span>
          </div>
        )}

        <div className="zenith-dialog-actions">
          <button
            type="button"
            className="zenith-dialog-btn zenith-dialog-btn-cancel"
            disabled={isBusy}
            onClick={onCancel}
            data-testid={`${testId}-cancel`}
          >
            {cancelLabel}
          </button>
          <button
            type="submit"
            className="zenith-dialog-btn zenith-dialog-btn-primary"
            disabled={isBusy}
            data-testid={`${testId}-submit`}
          >
            {isBusy ? (
              <>
                <Loader2 size={13} className="zenith-spin" />
                <span>Working…</span>
              </>
            ) : (
              confirmLabel
            )}
          </button>
        </div>
      </form>
    </dialog>
  );
}
