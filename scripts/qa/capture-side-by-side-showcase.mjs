import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';

const outputDir = path.resolve('output/zenith-channel-invites');
fs.mkdirSync(outputDir, { recursive: true });

async function run() {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

  await page.goto('http://127.0.0.1:5173/');
  await page.waitForSelector('.server-rail', { timeout: 10000 });

  // Select Zenith Design Lab
  const serverBtn = page.locator('.server-icon[title*="Zenith Design Lab"]').first();
  if (await serverBtn.count() > 0) {
    await serverBtn.click();
    await page.waitForTimeout(400);
  }

  // Inject Stitch Showcase comparison overlay
  await page.evaluate(() => {
    // Hide standard open dialogs
    document.querySelectorAll('dialog').forEach(d => d.close());

    // Create showcase overlay
    const overlay = document.createElement('div');
    overlay.id = 'zenith-showcase-overlay';
    overlay.style.position = 'fixed';
    overlay.style.inset = '0';
    overlay.style.background = 'rgba(0, 0, 0, 0.7)';
    overlay.style.backdropFilter = 'blur(4px)';
    overlay.style.zIndex = '99999';
    overlay.style.display = 'flex';
    overlay.style.alignItems = 'center';
    overlay.style.justifyContent = 'center';
    overlay.style.gap = '24px';
    overlay.style.padding = '24px';

    overlay.innerHTML = `
      <!-- Modal 1: Create channel -->
      <div class="zenith-modal-inner" style="width: 520px; border-radius: 12px; border: 1px solid rgba(70, 70, 79, 0.45); box-shadow: 0 25px 60px -15px rgba(0, 0, 0, 0.85); flex-shrink: 0;">
        <div class="zenith-modal-header">
          <div class="zenith-modal-title-group">
            <div class="zenith-modal-title-row">
              <span class="zenith-modal-icon-channel">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 12h8"/><path d="M12 8v8"/></svg>
              </span>
              <h2 class="zenith-modal-heading">Create channel</h2>
            </div>
          </div>
          <button class="zenith-modal-close-btn" type="button" aria-label="Close dialog">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
          </button>
        </div>

        <div class="zenith-form-body">
          <div class="zenith-form-section">
            <label class="zenith-eyebrow-label">CHANNEL TYPE</label>
            <div class="zenith-channel-type-grid">
              <div class="zenith-type-card is-selected">
                <div class="zenith-type-icon">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" x2="20" y1="9" y2="9"/><line x1="4" x2="20" y1="15" y2="15"/><line x1="10" x2="8" y1="3" y2="21"/><line x1="16" x2="14" y1="3" y2="21"/></svg>
                </div>
                <div class="zenith-type-content">
                  <div class="zenith-type-title-row">
                    <span class="zenith-type-title">Text</span>
                    <span class="zenith-radio-dot"><span class="zenith-radio-dot-inner"></span></span>
                  </div>
                  <p class="zenith-type-desc">Post messages, links, images, and attachments.</p>
                </div>
              </div>

              <div class="zenith-type-card">
                <div class="zenith-type-icon">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>
                </div>
                <div class="zenith-type-content">
                  <div class="zenith-type-title-row">
                    <span class="zenith-type-title">Voice</span>
                    <span class="zenith-radio-dot"></span>
                  </div>
                  <p class="zenith-type-desc">Talk, hang out, and share your screen in real time.</p>
                </div>
              </div>
            </div>
          </div>

          <div class="zenith-form-section">
            <label class="zenith-eyebrow-label">CHANNEL NAME</label>
            <div class="zenith-input-prefix-wrap">
              <span class="zenith-input-prefix">#</span>
              <input class="zenith-input has-prefix" value="tactical-chat" readonly />
            </div>
          </div>

          <div class="zenith-form-section">
            <label class="zenith-eyebrow-label">TOPIC</label>
            <input class="zenith-input" value="Squad strategies and match VODs" readonly />
            <span class="zenith-input-help">Visible to participants in the channel top header.</span>
          </div>

          <div class="zenith-modal-footer">
            <button class="zenith-btn-cancel" type="button">Cancel</button>
            <button class="zenith-btn-primary" type="button">
              <span>Create channel</span>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
            </button>
          </div>
        </div>
      </div>

      <!-- Modal 2: Invite people -->
      <div class="zenith-modal-inner" style="width: 480px; border-radius: 12px; border: 1px solid rgba(70, 70, 79, 0.45); box-shadow: 0 25px 60px -15px rgba(0, 0, 0, 0.85); flex-shrink: 0;">
        <div class="zenith-modal-header">
          <div class="zenith-modal-title-group">
            <div class="zenith-modal-title-row">
              <span class="zenith-modal-icon-invite">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" x2="19" y1="8" y2="14"/><line x1="22" x2="16" y1="11" y2="11"/></svg>
              </span>
              <h2 class="zenith-modal-heading">Invite people to The Cozy Corner</h2>
            </div>
            <div class="zenith-modal-subtitle-row">
              <span class="zenith-status-dot"></span>
              <span class="zenith-modal-subtitle">Community · 12 online · Public link</span>
            </div>
          </div>
          <button class="zenith-modal-close-btn" type="button" aria-label="Close dialog">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
          </button>
        </div>

        <p class="zenith-invite-desc">Invite someone into The Cozy Corner in Haven. They can create their own account after opening the link.</p>

        <div class="zenith-expire-row">
          <label class="zenith-eyebrow-label" style="margin-bottom: 0;">EXPIRE LINK</label>
          <div class="zenith-select-wrap">
            <select class="zenith-select" readonly>
              <option selected>In 7 days</option>
            </select>
            <span class="zenith-select-icon">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m7 15 5 5 5-5"/><path d="m7 9 5-5 5 5"/></svg>
            </span>
          </div>
        </div>

        <div class="zenith-invite-card">
          <div class="zenith-invite-link-row">
            <span class="zenith-invite-link-input">https://haven.community/invite/<b style="color: #c0c1ff;">cozy-vance-441</b></span>
            <button class="zenith-btn-copy-link" type="button">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
              <span>Copy invite link</span>
            </button>
          </div>
          <div class="zenith-invite-code-row">
            <div class="zenith-direct-code-group">
              <span>Direct code:</span>
              <code class="zenith-direct-code-badge">cozy-vance-441</code>
            </div>
            <button class="zenith-btn-copy-code" type="button">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
              <span>Copy code</span>
            </button>
          </div>
        </div>

        <div class="zenith-active-invites-section">
          <div class="zenith-active-invites-header">
            <span class="zenith-eyebrow-label" style="margin-bottom: 0;">ACTIVE INVITATIONS</span>
            <span class="zenith-active-count">1 active</span>
          </div>
          <div class="zenith-invites-list">
            <div class="zenith-invite-item">
              <div class="zenith-invite-item-left">
                <span class="zenith-pulse-wrapper"><span class="zenith-pulse-ping"></span><span class="zenith-pulse-dot"></span></span>
                <div class="zenith-invite-item-info">
                  <span class="zenith-invite-item-code">cozy-vance-441</span>
                  <span class="zenith-invite-item-sub">Expires in 6 days · Used 3 times</span>
                </div>
              </div>
              <button class="zenith-invite-item-delete" type="button" aria-label="Revoke invite">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
              </button>
            </div>
          </div>
        </div>

        <div class="zenith-invite-footer">
          <div class="zenith-role-indicator">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/></svg>
            <span>Role: Regular Member (Default)</span>
          </div>
          <button class="zenith-link-btn" type="button">Edit permissions</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
  });

  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(outputDir, '00_stitch_comparison_1280x720.png') });
  console.log('✓ Captured 00_stitch_comparison_1280x720.png (Direct Stitch comparison)');

  await browser.close();
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
