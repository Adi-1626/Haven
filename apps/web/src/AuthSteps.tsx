/** Two-stage progress shared by account creation and first-time profile setup. */
export function AuthSteps({ current }: { current: 1 | 2 }) {
  return (
    <ol className="auth-steps" aria-label={`Step ${current} of 2: ${current === 1 ? 'Create your account' : 'Set up your profile'}`}>
      <li className={`auth-step${current === 1 ? ' current' : ' done'}`} aria-current={current === 1 ? 'step' : undefined}><span className="auth-step-dot" aria-hidden="true" /><span className="auth-step-label">Account</span></li>
      <li className="auth-step-line" aria-hidden="true" />
      <li className={`auth-step${current === 2 ? ' current' : ''}`} aria-current={current === 2 ? 'step' : undefined}><span className="auth-step-dot" aria-hidden="true" /><span className="auth-step-label">Profile</span></li>
    </ol>
  );
}
