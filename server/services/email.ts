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

// ─── Shared email shell ───────────────────────────────────────────────────────
// All transactional emails share this outer chrome: background, centered card,
// logo, title, content slot, divider, sign-off, and footer.
// Pass `innerHtml` as everything that goes after the <h1> and before the <hr>.

function renderEmailShell(params: {
  title: string;
  innerHtml: string;
}): string {
  const logoUrl = `${appUrl}/brand/icon.png`;
  const year = new Date().getFullYear();
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
  </head>
  <body style="margin:0;padding:0;background-color:#f7f5fb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1a1a1a;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td align="center" style="padding:40px 16px;">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" border="0" style="background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.06);">

            <!-- Logo header -->
            <tr>
              <td align="center" style="padding:28px 32px 0 32px;">
                <img src="${logoUrl}" width="40" height="40" alt="Socrates AI" style="display:block;border:0;" />
              </td>
            </tr>

            <!-- Card content -->
            <tr>
              <td style="padding:20px 32px 28px 32px;">
                <h1 style="margin:0 0 16px 0;font-size:20px;line-height:1.4;font-weight:600;color:#1a1a1a;">
                  ${params.title}
                </h1>
                ${params.innerHtml}
                <hr style="border:none;border-top:1px solid #eee;margin:24px 0" />
                <p style="margin:0 0 4px 0;font-size:14px;line-height:1.5;color:#4a4a4a;">
                  — The Socrates AI team
                </p>
              </td>
            </tr>

            <!-- Footer -->
            <tr>
              <td align="center" style="padding:0 32px 24px 32px;">
                <p style="margin:0;font-size:12px;line-height:1.5;color:#9a9a9a;text-align:center;">
                  &copy; ${year} Socrates AI
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
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px 0;">
                  <tr>
                    <td style="background-color:#5A2E9A;border-radius:8px;">
                      <a href="${url}" style="display:inline-block;padding:14px 28px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;line-height:1.2;">
                        ${label}
                      </a>
                    </td>
                  </tr>
                </table>`;
}

// ─── Password reset email ─────────────────────────────────────────────────────

function renderResetHtml(resetUrl: string): string {
  const inner = `
                <p style="margin:0 0 20px 0;font-size:15px;line-height:1.6;color:#4a4a4a;">
                  Hi there,
                </p>
                <p style="margin:0 0 24px 0;font-size:15px;line-height:1.6;color:#4a4a4a;">
                  We received a request to reset the password on your Socrates AI account. Click the button below to choose a new password &mdash; this link expires in 1 hour.
                </p>
                ${renderCtaButton(resetUrl, "Reset my password")}
                <p style="margin:0 0 8px 0;font-size:13px;line-height:1.5;color:#6a6a6a;">
                  Or paste this link into your browser:
                </p>
                <p style="margin:0 0 24px 0;font-size:13px;line-height:1.5;color:#5A2E9A;word-break:break-all;">
                  ${resetUrl}
                </p>
                <p style="margin:0;font-size:12px;line-height:1.5;color:#9a9a9a;">
                  If you didn&rsquo;t request this, you can safely ignore this email. Your password hasn&rsquo;t changed.
                </p>`;
  return renderEmailShell({ title: "Reset your Socrates AI password", innerHtml: inner });
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
                <p style="margin:0 0 24px 0;font-size:15px;line-height:1.6;color:#4a4a4a;">
                  Thanks for joining Socrates AI. Click the button below to verify your email &mdash; this keeps your account secure and ensures you receive important updates.
                </p>
                ${renderCtaButton(verifyUrl, "Confirm my email")}
                <p style="margin:0 0 8px 0;font-size:13px;line-height:1.5;color:#6a6a6a;">
                  Or paste this link into your browser:
                </p>
                <p style="margin:0 0 24px 0;font-size:13px;line-height:1.5;color:#5A2E9A;word-break:break-all;">
                  ${verifyUrl}
                </p>
                <p style="margin:0;font-size:12px;line-height:1.5;color:#9a9a9a;">
                  This link expires in 24 hours. If you didn&rsquo;t create a Socrates AI account, you can safely ignore this email.
                </p>`;
  return renderEmailShell({ title: "Confirm your email address", innerHtml: inner });
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
                <p style="margin:0 0 24px 0;font-size:15px;line-height:1.6;color:#4a4a4a;">
                  <strong>${safeName}</strong> invited you to join
                  <strong>&ldquo;${safeTitle}&rdquo;</strong> on Socrates AI as
                  a <strong>${safeRole}</strong>.
                </p>
                ${renderCtaButton(inviteUrl, "Accept invite")}
                <p style="margin:0 0 8px 0;font-size:13px;line-height:1.5;color:#6a6a6a;">
                  Or paste this link into your browser:
                </p>
                <p style="margin:0 0 24px 0;font-size:13px;line-height:1.5;color:#5A2E9A;word-break:break-all;">
                  ${inviteUrl}
                </p>
                <p style="margin:0;font-size:12px;line-height:1.5;color:#9a9a9a;">
                  This invite expires in 7 days. If you didn&rsquo;t expect this,
                  you can safely ignore this email.
                </p>`;
  return renderEmailShell({ title: "You've been invited to a collection", innerHtml: inner });
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
