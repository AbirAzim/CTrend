import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { existsSync, readFileSync } from 'fs';
import * as nodemailer from 'nodemailer';
import { join } from 'path';
import * as sharp from 'sharp';

const LOGO_PATH = join(process.cwd(), 'logo.png');

@Injectable()
export class MailService implements OnModuleInit {
  private readonly logger = new Logger(MailService.name);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private transporter: any = null;
  private from: string;
  /** data:image/png;base64,... for inline email images (no attachment) */
  private logoDataUrl: string | null = null;

  constructor(private config: ConfigService) {
    const host = this.config.get<string>('SMTP_HOST') || process.env.SMTP_HOST;
    const user = this.config.get<string>('SMTP_USER') || process.env.SMTP_USER;
    const pass = this.config.get<string>('SMTP_PASS') || process.env.SMTP_PASS;
    this.from =
      this.config.get<string>('SMTP_FROM') ||
      process.env.SMTP_FROM ||
      'Ke Jitbe <no-reply@kejitbe.app>';

    this.logger.log(
      `SMTP config — host:${host ?? 'MISSING'} user:${user ?? 'MISSING'} pass:${pass ? 'SET' : 'MISSING'}`,
    );

    if (host && user && pass) {
      this.transporter = nodemailer.createTransport({
        host,
        port: Number(
          this.config.get<string>('SMTP_PORT') ||
            process.env.SMTP_PORT ||
            '587',
        ),
        secure:
          (this.config.get<string>('SMTP_SECURE') ||
            process.env.SMTP_SECURE) === 'true',
        auth: { user, pass },
      });
      this.logger.log('SMTP transporter ready');
    } else {
      this.logger.warn(
        'SMTP not configured — emails will be logged to console only',
      );
    }
  }

  async onModuleInit() {
    this.logoDataUrl = await this.loadLogoDataUrl();
  }

  private async loadLogoDataUrl(): Promise<string | null> {
    try {
      if (!existsSync(LOGO_PATH)) {
        this.logger.warn(`logo.png not found at ${LOGO_PATH}`);
        return null;
      }
      // Resize to 80x80 before base64-encoding — keeps email HTML well under Gmail's 102KB clip limit
      const resized = await sharp(readFileSync(LOGO_PATH))
        .resize(80, 80, {
          fit: 'contain',
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        })
        .png({ compressionLevel: 9 })
        .toBuffer();
      return `data:image/png;base64,${resized.toString('base64')}`;
    } catch (e) {
      this.logger.warn(
        `Could not load logo.png: ${e instanceof Error ? e.message : String(e)}`,
      );
      return null;
    }
  }

  private logoImgTag(width: number, marginBottom: string): string {
    if (!this.logoDataUrl) return '';
    return `<img src="${this.logoDataUrl}" alt="Ke Jitbe" width="${width}" height="${width}" style="border-radius:12px;display:block;margin:0 auto ${marginBottom};">`;
  }

  /** Code + Copy button row — works in webmail; mobile users can long-press the code. */
  private copyableCodeBlock(code: string): string {
    const safe = code.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    return `
      <table cellpadding="0" cellspacing="0" border="0" style="margin:0 auto 12px;width:100%;max-width:440px;">
        <tr>
          <td style="vertical-align:middle;text-align:right;padding-right:10px;">
            <span style="display:inline-block;background:#EEEEF6;border:1.5px solid #D0D0E0;
              border-radius:10px;padding:14px 22px;font-size:28px;font-weight:800;
              letter-spacing:0.2em;color:#1A1A2E;font-family:ui-monospace,monospace;
              user-select:all;-webkit-user-select:all;">${code}</span>
          </td>
          <td style="vertical-align:middle;text-align:left;">
            <button
              type="button"
              onclick="navigator.clipboard&&navigator.clipboard.writeText('${safe}');this.innerText='Copied!';"
              style="display:inline-block;background:#1A1A2E;color:#fff;border-radius:10px;
              padding:12px 20px;font-size:14px;font-weight:600;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;border:0;cursor:pointer;">
              Copy code
            </button>
          </td>
        </tr>
      </table>
      <p style="margin:0;font-size:12px;color:#999;text-align:center;line-height:1.5;">
        Tap <strong>Copy code</strong>. If your email app blocks it, long-press the code to copy manually.
      </p>`;
  }

  async sendVerificationCode(to: string, code: string): Promise<void> {
    const html = this.baseTemplate(`
      <h2 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#1A1A2E;text-align:center;">
        Verify your email
      </h2>
      ${this.logoImgTag(48, '20px')}
      <p style="margin:0 0 28px;font-size:15px;color:#555;line-height:1.6;text-align:center;">
        Enter this code in the Ke Jitbe app to complete your sign-up.<br>
        It expires in <strong>15 minutes</strong>.
      </p>

      ${this.copyableCodeBlock(code)}
    `);

    await this.send(to, 'Your Ke Jitbe verification code', html, {
      text: `Your Ke Jitbe verification code is: ${code}\n\nIt expires in 15 minutes.`,
    });
  }

  async sendInvitationEmail(
    to: string,
    inviteUrl: string,
    inviterName: string,
    referralCode: string,
  ): Promise<void> {
    const html = this.baseTemplate(`
      <h2 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#1A1A2E;text-align:center;">
        You're invited to Ke Jitbe
      </h2>
      ${this.logoImgTag(48, '20px')}
      <p style="margin:0 0 20px;font-size:15px;color:#555;line-height:1.6;text-align:center;">
        <strong>${inviterName}</strong> has invited you to join Ke Jitbe —<br>
        the platform where you compare, vote, and see the trend.<br>
        This invitation expires in <strong>7 days</strong>.
      </p>
      <div style="background:#f8fafc;border-radius:12px;padding:18px 20px;margin:0 0 24px;text-align:center;">
        <p style="margin:0 0 16px;font-size:12px;color:#888;text-transform:uppercase;letter-spacing:0.08em;font-weight:700;">
          Your referral code
        </p>
        ${this.copyableCodeBlock(referralCode)}
        <p style="margin:16px 0 0;font-size:13px;color:#666;line-height:1.5;">
          Paste this code when you sign up — or redeem it from your profile — to earn <strong>5 referral points</strong>.
        </p>
      </div>
      <p style="text-align:center;margin:0 0 16px;">
        <a href="${inviteUrl}"
          style="display:inline-block;background:#1A1A2E;color:#fff;
            text-decoration:none;border-radius:10px;padding:14px 36px;
            font-size:16px;font-weight:600;">
          Create your account
        </a>
      </p>
      <p style="margin:0;font-size:13px;color:#777;text-align:center;line-height:1.6;">
        Your email and referral code will be filled in automatically on the sign-up page.
      </p>
      <p style="margin:16px 0 0;font-size:13px;color:#999;text-align:center;">
        If you weren't expecting this invitation, you can safely ignore this email.
      </p>
    `);

    await this.send(to, `${inviterName} invited you to Ke Jitbe`, html, {
      text: `${inviterName} has invited you to join Ke Jitbe.\n\nYour referral code: ${referralCode}\n(Copy the code from the email, or use the sign-up link below.)\n\nSign up to earn 5 referral points:\n${inviteUrl}\n\nThis invitation expires in 7 days. If you weren't expecting this, ignore it.`,
    });
  }

  async sendPromotionEmail(
    to: string,
    rejectUrl: string,
    promoterName: string,
    recipientName: string,
  ): Promise<void> {
    const html = this.baseTemplate(`
      <h2 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#1A1A2E;text-align:center;">
        You've been promoted to Admin 🎉
      </h2>
      ${this.logoImgTag(48, '20px')}
      <p style="margin:0 0 20px;font-size:15px;color:#555;line-height:1.6;text-align:center;">
        Hi <strong>${recipientName}</strong>,<br><br>
        <strong>${promoterName}</strong> has granted you <strong>Admin access</strong> on Ke Jitbe.<br>
        You now have admin privileges — no action is needed to accept.
      </p>
      <div style="background:#f8fafc;border-radius:10px;padding:16px 20px;margin:0 0 24px;text-align:center;">
        <p style="margin:0 0 6px;font-size:13px;color:#888;">Don't want admin access?</p>
        <p style="margin:0;font-size:13px;color:#555;line-height:1.5;">
          If you'd prefer not to be an admin, click the button below within <strong>7 days</strong>.<br>
          Your account will remain active as a regular user.
        </p>
      </div>
      <p style="text-align:center;margin:0 0 24px;">
        <a href="${rejectUrl}"
          style="display:inline-block;background:#dc2626;color:#fff;
            text-decoration:none;border-radius:10px;padding:12px 30px;
            font-size:15px;font-weight:600;">
          Decline Admin Access
        </a>
      </p>
      <p style="margin:0;font-size:12px;color:#999;text-align:center;">
        If you're happy being an admin, simply ignore this email.
      </p>
    `);

    await this.send(to, `You've been promoted to Admin on Ke Jitbe`, html, {
      text: `Hi ${recipientName},\n\n${promoterName} has granted you Admin access on Ke Jitbe. No action is needed to accept.\n\nIf you'd like to decline, visit this link within 7 days:\n${rejectUrl}\n\nIf you're happy being an admin, ignore this email.`,
    });
  }

  async sendPasswordResetLink(
    to: string,
    resetUrl: string,
    appResetUrl?: string,
  ): Promise<void> {
    const appLinkBlock = appResetUrl
      ? `<p style="margin:0 0 20px;font-size:14px;color:#555;line-height:1.6;text-align:center;">
          Using the Ke Jitbe app?
          <a href="${appResetUrl}" style="color:#1A1A2E;font-weight:600;">Open reset in app</a>
        </p>`
      : '';
    const html = this.baseTemplate(`
      <h2 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#1A1A2E;">
        Reset your password
      </h2>
      <p style="margin:0 0 28px;font-size:15px;color:#555;line-height:1.6;">
        We received a request to reset your Ke Jitbe password.<br>
        This link expires in <strong>1 hour</strong> and also verifies your email if you
        haven&apos;t confirmed it yet.
      </p>
      <p style="text-align:center;margin:0 0 28px;">
        <a href="${resetUrl}"
          style="display:inline-block;background:#1A1A2E;color:#fff;
            text-decoration:none;border-radius:10px;padding:14px 36px;
            font-size:16px;font-weight:600;">
          Reset Password
        </a>
      </p>
      ${appLinkBlock}
      <p style="margin:0;font-size:13px;color:#999;text-align:center;">
        If you signed up with Google, use <strong>Continue with Google</strong> instead.<br>
        If you didn't request this, you can safely ignore this email.
      </p>
    `);

    const textApp = appResetUrl ? `\n\nApp link:\n${appResetUrl}` : '';
    await this.send(to, 'Reset your Ke Jitbe password', html, {
      text: `Reset your Ke Jitbe password:\n\n${resetUrl}${textApp}\n\nThis link expires in 1 hour. If you signed up with Google, use Continue with Google instead. If you didn't request this, ignore this email.`,
    });
  }

  private baseTemplate(content: string): string {
    const headerLogo = this.logoImgTag(56, '12px');
    return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F0F0F5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0">
    <tr>
      <td align="center" style="padding:40px 16px;">
        <table width="520" cellpadding="0" cellspacing="0" border="0"
          style="background:#fff;border-radius:16px;overflow:hidden;
            box-shadow:0 4px 24px rgba(0,0,0,0.08);max-width:520px;width:100%;">

          <!-- Header -->
          <tr>
            <td style="background:#1A1A2E;padding:28px 36px;text-align:center;">
              ${headerLogo}
              <span style="color:#fff;font-size:20px;font-weight:700;letter-spacing:0.5px;display:block;${headerLogo ? 'margin-top:10px;' : ''}">Ke Jitbe</span>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:36px 36px 32px;">
              ${content}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#F8F8FB;padding:20px 36px;text-align:center;
              border-top:1px solid #EBEBF0;">
              <p style="margin:0;font-size:12px;color:#AAA;">
                © ${new Date().getFullYear()} Ke Jitbe · Compare. Vote. See the Trend.
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

  private async send(
    to: string,
    subject: string,
    html: string,
    opts: { text?: string } = {},
  ): Promise<void> {
    if (!this.transporter) {
      this.logger.log(
        `[DEV MAIL] To: ${to} | Subject: ${subject}\n${opts.text ?? '(html only)'}`,
      );
      return;
    }
    try {
      await this.transporter.sendMail({
        from: this.from,
        to,
        subject,
        html,
        text: opts.text,
      });
      this.logger.log(`Email sent to ${to}: ${subject}`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to send email to ${to}: ${message}`);
      throw err;
    }
  }
}
