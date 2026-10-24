import type { ReactNode } from 'react';

export function SettingRow({
  label,
  description,
  control,
  children,
  className = '',
  as = 'label',
}: {
  label: ReactNode;
  description?: ReactNode;
  control?: ReactNode;
  children?: ReactNode;
  className?: string;
  as?: 'label' | 'div';
}) {
  const Component = as;
  return (
    <Component className={`setting-row toggle-label ${className}`.trim()}>
      <div className="setting-row-text">
        <span className="setting-row-label toggle-title">{label}</span>
        {description && (
          <span className="setting-row-description toggle-description">{description}</span>
        )}
      </div>
      {control && <div className="setting-row-control toggle-control">{control}</div>}
      {children}
    </Component>
  );
}

