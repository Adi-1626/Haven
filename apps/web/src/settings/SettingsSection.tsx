import type { ReactNode } from 'react';

export function SettingsSection({
  title,
  description,
  children,
  action,
}: {
  title?: string;
  description?: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="settings-section">
      {(title || action) && (
        <div className="settings-section-header">
          {title && <h3 className="settings-section-title">{title}</h3>}
          {action && <div className="settings-section-action">{action}</div>}
        </div>
      )}
      {description && <p className="settings-section-description">{description}</p>}
      <div className="settings-section-content">{children}</div>
    </section>
  );
}
