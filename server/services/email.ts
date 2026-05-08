import { Resend } from "resend";
import type { CollectionRole } from "../../shared/schema.js";

const apiKey = process.env.RESEND_API_KEY;
const from =
  process.env.EMAIL_FROM || "Socrates AI <noreply@socratesai.app>";
const appUrl = process.env.APP_URL || "http://localhost:4000";

const resend = apiKey ? new Resend(apiKey) : null;

function hashEmail(email: string): string {
  // Cheap non-reversible fingerprint for logs (no plain email leakage).
  let hash = 0;
  for (let i = 0; i < email.length; i++) {
    hash = (hash << 5) - hash + email.charCodeAt(i);
    hash |= 0;
  }
  return `email:${(hash >>> 0).toString(36)}`;
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ─── Shared email shell (V70 brand language) ─────────────────────────────────
// All transactional emails share this outer chrome:
//   • brand header (logo + "Socrates AI" wordmark)
//   • V70 hero (purple uppercase eyebrow + bold display headline)
//   • content slot
//   • Build · Practice · Learn motto strip
//   • sign-off + footer
// Email-client constraints: tables only, inline CSS, no animations / blur,
// absolute logo URL.

function renderEmailShell(params: {
  eyebrow: string;
  headline: string;
  innerHtml: string;
  preheader?: string;
}): string {
  const logoUrl = `${appUrl}/brand/icon.png`;
  const year = new Date().getFullYear();
  const preheader = params.preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:#ffffff;opacity:0;">${escapeHtml(params.preheader)}</div>`
    : "";
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <meta name="color-scheme" content="light only" />
    <meta name="supported-color-schemes" content="light only" />
  </head>
  <body style="margin:0;padding:0;background-color:#ffffff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0F0520;">
    ${preheader}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#ffffff;">
      <tr>
        <td align="center" style="padding:32px 16px 40px 16px;">
          <table role="presentation" width="520" cellpadding="0" cellspacing="0" border="0" style="width:520px;max-width:100%;background-color:#ffffff;">

            <!-- Brand header: logo + wordmark -->
            <tr>
              <td style="padding:0 8px 28px 8px;">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td valign="middle" style="padding-right:10px;">
                      <img src="${logoUrl}" width="32" height="32" alt="" style="display:block;border:0;border-radius:8px;" />
                    </td>
                    <td valign="middle" style="font-size:15px;font-weight:700;letter-spacing:-0.01em;color:#0F0520;">
                      Socrates AI
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <!-- Card -->
            <tr>
              <td style="background-color:#ffffff;border:1px solid #ECE6F4;border-radius:20px;box-shadow:0 25px 60px -20px rgba(45,17,82,0.12);">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">

                  <!-- Hero -->
                  <tr>
                    <td style="padding:36px 36px 8px 36px;">
                      <p style="margin:0 0 12px 0;font-size:11px;line-height:1;font-weight:700;letter-spacing:0.28em;text-transform:uppercase;color:#5A2E9A;">
                        ${escapeHtml(params.eyebrow)}
                      </p>
                      <h1 style="margin:0 0 4px 0;font-size:30px;line-height:1.1;font-weight:700;letter-spacing:-0.02em;color:#0F0520;">
                        ${escapeHtml(params.headline)}
                      </h1>
                    </td>
                  </tr>

                  <!-- Content -->
                  <tr>
                    <td style="padding:20px 36px 8px 36px;">
                      ${params.innerHtml}
                    </td>
                  </tr>

                  <!-- Motto strip -->
                  <tr>
                    <td style="padding:8px 36px 28px 36px;">
                      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                        <tr>
                          <td style="border-top:1px solid #ECE6F4;padding-top:18px;">
                            <p style="margin:0;font-size:11px;line-height:1;font-weight:700;letter-spacing:0.24em;text-transform:uppercase;color:#9A8AB8;text-align:center;">
                              Build &middot; Practice &middot; Learn
                            </p>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>

                </table>
              </td>
            </tr>

            <!-- Footer -->
            <tr>
              <td style="padding:24px 8px 0 8px;">
                <p style="margin:0 0 4px 0;font-size:13px;line-height:1.5;color:#6B5E84;">
                  &mdash; The Socrates AI team
                </p>
                <p style="margin:0;font-size:12px;line-height:1.5;color:#9A8AB8;">
                  &copy; ${year} Socrates AI &middot; OSCE practice partner
                </p>
              </td>
            </tr>

          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

// ─── CTA button snippet (reused across emails) ────────────────────────────────

function renderCtaButton(url: string, label: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px 0;">
                        <tr>
                          <td style="background-color:#5A2E9A;border-radius:12px;box-shadow:0 8px 20px -8px rgba(90,46,154,0.45);">
                            <a href="${url}" style="display:inline-block;padding:14px 28px;font-size:15px;font-weight:700;letter-spacing:-0.01em;color:#ffffff;text-decoration:none;line-height:1.2;border-radius:12px;">
                              ${label} &nbsp;&rarr;
                            </a>
                          </td>
                        </tr>
                      </table>`;
}

// ─── Password reset email ─────────────────────────────────────────────────────

function renderResetHtml(resetUrl: string): string {
  const inner = `
                      <p style="margin:0 0 20px 0;font-size:15px;line-height:1.65;color:#3D2E5A;">
                        We received a request to reset the password on your Socrates AI account. Choose a new one with the button below &mdash; this link expires in <strong style="color:#0F0520;">1 hour</strong>.
                      </p>
                      ${renderCtaButton(resetUrl, "Reset my password")}
                      <p style="margin:0 0 6px 0;font-size:12px;line-height:1.5;color:#6B5E84;">
                        Or paste this link into your browser:
                      </p>
                      <p style="margin:0 0 20px 0;font-size:12px;line-height:1.5;color:#5A2E9A;word-break:break-all;">
                        ${resetUrl}
                      </p>
                      <p style="margin:0 0 4px 0;font-size:12px;line-height:1.55;color:#9A8AB8;">
                        Didn&rsquo;t request this? You can safely ignore this email &mdash; your password hasn&rsquo;t changed.
                      </p>`;
  return renderEmailShell({
    eyebrow: "Account Recovery",
    headline: "Choose a new password",
    innerHtml: inner,
    preheader: "Reset your Socrates AI password — link expires in 1 hour.",
  });
}

function renderResetText(resetUrl: string): string {
  return `Reset your Socrates AI password

Hi there,

We received a request to reset the password on your Socrates AI account.
Use the link below to choose a new password — this link expires in 1 hour.

Reset my password:
${resetUrl}

If you didn't request this, you can safely ignore this email.
Your password hasn't changed.

— The Socrates AI team`;
}

// ─── Email verification email ─────────────────────────────────────────────────

function renderVerifyHtml(verifyUrl: string): string {
  const inner = `
                      <p style="margin:0 0 16px 0;font-size:15px;line-height:1.65;color:#3D2E5A;">
                        Welcome to Socrates AI &mdash; your OSCE practice partner. Confirm this is really you and we&rsquo;ll get you straight into your stations.
                      </p>
                      <p style="margin:0 0 8px 0;font-size:15px;line-height:1.65;color:#3D2E5A;">
                        Tap the button below to confirm your email. This link expires in <strong style="color:#0F0520;">24 hours</strong>.
                      </p>
                      ${renderCtaButton(verifyUrl, "Confirm my email")}
                      <p style="margin:0 0 6px 0;font-size:12px;line-height:1.5;color:#6B5E84;">
                        Or paste this link into your browser:
                      </p>
                      <p style="margin:0 0 20px 0;font-size:12px;line-height:1.5;color:#5A2E9A;word-break:break-all;">
                        ${verifyUrl}
                      </p>
                      <p style="margin:0 0 4px 0;font-size:12px;line-height:1.55;color:#9A8AB8;">
                        Didn&rsquo;t create a Socrates AI account? You can safely ignore this email.
                      </p>`;
  return renderEmailShell({
    eyebrow: "One More Step",
    headline: "Welcome — confirm your email",
    innerHtml: inner,
    preheader: "Confirm your email and start practicing OSCEs with Socrates AI.",
  });
}

function renderVerifyText(verifyUrl: string): string {
  return `Confirm your email address — Socrates AI

Thanks for joining Socrates AI. Open this link to confirm your account (expires in 24 hours):
${verifyUrl}

If you didn't create a Socrates AI account, you can safely ignore this email.

— The Socrates AI team`;
}

// ─── Collection invite email ──────────────────────────────────────────────────

function renderInviteHtml(
  params: {
    inviterName: string;
    collectionTitle: string;
    role: CollectionRole;
  },
  inviteUrl: string,
): string {
  const safeTitle = escapeHtml(params.collectionTitle);
  const safeName = escapeHtml(params.inviterName);
  const safeRole = escapeHtml(params.role);
  const inner = `
                      <p style="margin:0 0 18px 0;font-size:15px;line-height:1.65;color:#3D2E5A;">
                        <strong style="color:#0F0520;">${safeName}</strong> invited you to join
                        <strong style="color:#0F0520;">&ldquo;${safeTitle}&rdquo;</strong> on Socrates AI.
                      </p>
                      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px 0;background-color:#F7F3FB;border:1px solid #ECE6F4;border-radius:14px;">
                        <tr>
                          <td style="padding:14px 18px;">
                            <p style="margin:0 0 4px 0;font-size:11px;line-height:1;font-weight:700;letter-spacing:0.24em;text-transform:uppercase;color:#5A2E9A;">
                              Joining as
                            </p>
                            <p style="margin:0;font-size:15px;line-height:1.4;font-weight:700;color:#0F0520;text-transform:capitalize;">
                              ${safeRole}
                            </p>
                          </td>
                        </tr>
                      </table>
                      ${renderCtaButton(inviteUrl, "Accept invite")}
                      <p style="margin:0 0 6px 0;font-size:12px;line-height:1.5;color:#6B5E84;">
                        Or paste this link into your browser:
                      </p>
                      <p style="margin:0 0 20px 0;font-size:12px;line-height:1.5;color:#5A2E9A;word-break:break-all;">
                        ${inviteUrl}
                      </p>
                      <p style="margin:0 0 4px 0;font-size:12px;line-height:1.55;color:#9A8AB8;">
                        This invite expires in 7 days. If you weren&rsquo;t expecting it, you can safely ignore this email.
                      </p>`;
  return renderEmailShell({
    eyebrow: "Collection Invite",
    headline: `Join "${params.collectionTitle}"`,
    innerHtml: inner,
    preheader: `${params.inviterName} invited you to a Socrates AI collection.`,
  });
}

function renderInviteText(
  params: {
    inviterName: string;
    collectionTitle: string;
    role: CollectionRole;
  },
  inviteUrl: string,
): string {
  return `${params.inviterName} invited you to join "${params.collectionTitle}" on Socrates AI as a ${params.role}.

Accept the invite:
${inviteUrl}

This invite expires in 7 days. If you didn't expect this, you can ignore this email.

— The Socrates AI team`;
}

// ─── Exported send functions ──────────────────────────────────────────────────

export async function sendPasswordResetEmail(params: {
  to: string;
  token: string;
}): Promise<{ sent: boolean; resetUrl: string }> {
  const resetUrl = `${appUrl}/auth/reset/${params.token}`;
  const fingerprint = hashEmail(params.to.toLowerCase());

  if (!resend) {
    console.log(
      `[email] password reset link generated (no Resend key) ${fingerprint}`,
    );
    return { sent: false, resetUrl };
  }

  try {
    await resend.emails.send({
      from,
      to: params.to,
      subject: "Reset your Socrates AI password",
      html: renderResetHtml(resetUrl),
      text: renderResetText(resetUrl),
    });
    console.log(`[email] password reset sent ${fingerprint}`);
    return { sent: true, resetUrl };
  } catch (err) {
    console.error(`[email] password reset send failed ${fingerprint}`, err);
    return { sent: false, resetUrl };
  }
}

export async function sendVerificationEmail(params: {
  to: string;
  token: string;
}): Promise<{ sent: boolean; verifyUrl: string }> {
  const verifyUrl = `${appUrl}/auth/verify/${params.token}`;
  const fingerprint = hashEmail(params.to.toLowerCase());

  if (!resend) {
    console.log(
      `[email] verification link generated (no Resend key) ${fingerprint}`,
    );
    return { sent: false, verifyUrl };
  }

  try {
    await resend.emails.send({
      from,
      to: params.to,
      subject: "Confirm your email — Socrates AI",
      html: renderVerifyHtml(verifyUrl),
      text: renderVerifyText(verifyUrl),
    });
    console.log(`[email] verification email sent ${fingerprint}`);
    return { sent: true, verifyUrl };
  } catch (err) {
    console.error(`[email] verification email send failed ${fingerprint}`, err);
    return { sent: false, verifyUrl };
  }
}

export async function sendCollectionInviteEmail(params: {
  to: string;
  inviterName: string;
  collectionTitle: string;
  role: CollectionRole;
  token: string;
}): Promise<{ sent: boolean; inviteUrl: string }> {
  const inviteUrl = `${appUrl}/invites/${params.token}`;
  const fingerprint = hashEmail(params.to.toLowerCase());

  if (!resend) {
    console.log(
      `[email] invite link generated (no Resend key) ${fingerprint} collection="${params.collectionTitle}"`,
    );
    return { sent: false, inviteUrl };
  }

  try {
    await resend.emails.send({
      from,
      to: params.to,
      subject: `${params.inviterName} invited you to "${params.collectionTitle}" on Socrates AI`,
      html: renderInviteHtml(params, inviteUrl),
      text: renderInviteText(params, inviteUrl),
    });
    console.log(
      `[email] invite sent ${fingerprint} collection="${params.collectionTitle}"`,
    );
    return { sent: true, inviteUrl };
  } catch (err) {
    console.error(
      `[email] invite send failed ${fingerprint} collection="${params.collectionTitle}"`,
      err,
    );
    return { sent: false, inviteUrl };
  }
}
