import { forwardRef, type InputHTMLAttributes } from 'react';

export interface ToggleSwitchProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  checked?: boolean;
  disabled?: boolean;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  'aria-label': string;
  className?: string;
  id?: string;
}

/**
 * Zenith Minimal ToggleSwitch
 * Follows W3C ARIA switch pattern: native input[type="checkbox"][role="switch"]
 * Lavender active track (#C0C1FF), dark neutral inactive track (#282C35),
 * smooth thumb transition, accessible focus-visible outline.
 */
export const ToggleSwitch = forwardRef<HTMLInputElement, ToggleSwitchProps>(function ToggleSwitch(
  { checked = false, disabled = false, onChange, className = '', id, 'aria-label': ariaLabel, ...rest },
  ref
) {
  return (
    <label
      className={`zenith-toggle-switch ${checked ? 'is-checked' : ''} ${disabled ? 'is-disabled' : ''} ${className}`.trim()}
    >
      <input
        ref={ref}
        type="checkbox"
        role="switch"
        aria-checked={checked}
        aria-label={ariaLabel}
        checked={checked}
        disabled={disabled}
        id={id}
        onChange={onChange}
        className="zenith-toggle-input"
        {...rest}
      />
      <span className="zenith-toggle-track" aria-hidden="true">
        <span className="zenith-toggle-thumb" />
      </span>
    </label>
  );
});

export default ToggleSwitch;
