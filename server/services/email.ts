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
  return `<!DOCTYPE html>
<html>
  <body style="margin:0;padding:0;background-color:#f7f5fb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1a1a1a;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td align="center" style="padding:40px 16px;">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" border="0" style="background-color:#ffffff;border-radius:12px;overflow:hidden;">
            <tr>
              <td style="padding:32px 32px 24px 32px;">
                <h1 style="margin:0 0 16px 0;font-size:20px;line-height:1.4;font-weight:600;color:#1a1a1a;">
                  You've been invited to a collection
                </h1>
                <p style="margin:0 0 24px 0;font-size:15px;line-height:1.6;color:#4a4a4a;">
                  <strong>${safeName}</strong> invited you to join
                  <strong>&ldquo;${safeTitle}&rdquo;</strong> on Socrates AI as
                  a <strong>${safeRole}</strong>.
                </p>
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px 0;">
                  <tr>
                    <td style="background-color:#5A2E9A;border-radius:8px;">
                      <a href="${inviteUrl}" style="display:inline-block;padding:12px 24px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;">
                        Accept invite
                      </a>
                    </td>
                  </tr>
                </table>
                <p style="margin:0 0 8px 0;font-size:13px;line-height:1.5;color:#6a6a6a;">
                  Or paste this link into your browser:
                </p>
                <p style="margin:0 0 24px 0;font-size:13px;line-height:1.5;color:#5A2E9A;word-break:break-all;">
                  ${inviteUrl}
                </p>
                <p style="margin:0;font-size:12px;line-height:1.5;color:#9a9a9a;">
                  This invite expires in 7 days. If you didn't expect this,
                  you can safely ignore this email.
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

This invite expires in 7 days. If you didn't expect this, you can ignore this email.`;
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderResetHtml(resetUrl: string): string {
  return `<!DOCTYPE html>
<html>
  <body style="margin:0;padding:0;background-color:#f7f5fb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1a1a1a;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td align="center" style="padding:40px 16px;">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" border="0" style="background-color:#ffffff;border-radius:12px;overflow:hidden;">
            <tr>
              <td style="padding:32px 32px 24px 32px;">
                <h1 style="margin:0 0 16px 0;font-size:20px;line-height:1.4;font-weight:600;color:#1a1a1a;">
                  Reset your Socrates AI password
                </h1>
                <p style="margin:0 0 24px 0;font-size:15px;line-height:1.6;color:#4a4a4a;">
                  We received a request to reset your password. Tap the button below to choose a new one. This link expires in 60 minutes and can only be used once.
                </p>
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px 0;">
                  <tr>
                    <td style="background-color:#5A2E9A;border-radius:8px;">
                      <a href="${resetUrl}" style="display:inline-block;padding:12px 24px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;">
                        Reset password
                      </a>
                    </td>
                  </tr>
                </table>
                <p style="margin:0 0 8px 0;font-size:13px;line-height:1.5;color:#6a6a6a;">
                  Or paste this link into your browser:
                </p>
                <p style="margin:0 0 24px 0;font-size:13px;line-height:1.5;color:#5A2E9A;word-break:break-all;">
                  ${resetUrl}
                </p>
                <p style="margin:0;font-size:12px;line-height:1.5;color:#9a9a9a;">
                  If you didn't request this, you can safely ignore this email — your password will stay the same.
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

function renderResetText(resetUrl: string): string {
  return `Reset your Socrates AI password.

Open this link to choose a new one (expires in 60 minutes, single use):
${resetUrl}

If you didn't request this, you can safely ignore this email.`;
}

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
