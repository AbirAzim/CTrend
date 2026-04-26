import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { existsSync, readFileSync } from 'fs';
import * as nodemailer from 'nodemailer';
import { join } from 'path';

const LOGO_PATH = join(process.cwd(), 'logo.png');

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private transporter: any = null;
  private from: string;
  /** data:image/png;base64,... for inline email images (no attachment) */
  private readonly logoDataUrl: string | null;

  constructor(private config: ConfigService) {
    const host = this.config.get<string>('SMTP_HOST') || process.env.SMTP_HOST;
    const user = this.config.get<string>('SMTP_USER') || process.env.SMTP_USER;
    const pass = this.config.get<string>('SMTP_PASS') || process.env.SMTP_PASS;
    this.from =
      this.config.get<string>('SMTP_FROM') ||
      process.env.SMTP_FROM ||
      'CTrend <no-reply@ctrend.app>';

    this.logoDataUrl = this.loadLogoDataUrl();

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

  private loadLogoDataUrl(): string | null {
    try {
      if (!existsSync(LOGO_PATH)) {
        this.logger.warn(`logo.png not found at ${LOGO_PATH}`);
        return null;
      }
      const buf = readFileSync(LOGO_PATH);
      return `data:image/png;base64,${buf.toString('base64')}`;
    } catch (e) {
      this.logger.warn(
        `Could not read logo.png: ${e instanceof Error ? e.message : String(e)}`,
      );
      return null;
    }
  }

  private logoImgTag(width: number, marginBottom: string): string {
    if (!this.logoDataUrl) return '';
    return `<img src="${this.logoDataUrl}" alt="CTrend" width="${width}" height="${width}" style="border-radius:12px;display:block;margin:0 auto ${marginBottom};">`;
  }

  async sendVerificationCode(to: string, code: string): Promise<void> {
    const html = this.baseTemplate(`
      <h2 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#1A1A2E;text-align:center;">
        Verify your email
      </h2>
      ${this.logoImgTag(48, '20px')}
      <p style="margin:0 0 28px;font-size:15px;color:#555;line-height:1.6;text-align:center;">
        Enter this code in the CTrend app to complete your sign-up.<br>
        It expires in <strong>15 minutes</strong>.
      </p>

      <table cellpadding="0" cellspacing="0" border="0" style="margin:0 auto 16px;width:100%;max-width:440px;">
        <tr>
          <td style="vertical-align:middle;text-align:right;padding-right:10px;">
            <span id="verification-code" style="display:inline-block;background:#EEEEF6;border:1.5px solid #D0D0E0;
              border-radius:10px;padding:14px 22px;font-size:28px;font-weight:800;
              letter-spacing:0.25em;color:#1A1A2E;font-family:ui-monospace,monospace;
              user-select:all;-webkit-user-select:all;">${code}</span>
          </td>
          <td style="vertical-align:middle;text-align:left;">
            <button
              type="button"
              onclick="navigator.clipboard&&navigator.clipboard.writeText('${code}');this.innerText='Copied';"
              style="display:inline-block;background:#1A1A2E;color:#fff;border-radius:10px;
              padding:12px 20px;font-size:14px;font-weight:600;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;border:0;cursor:pointer;">
              Copy
            </button>
          </td>
        </tr>
      </table>
      <p style="margin:0;font-size:12px;color:#999;text-align:center;line-height:1.5;">
        Tap <strong>Copy</strong>. If your email client blocks it, long-press the code to copy manually.
      </p>
    `);

    await this.send(to, 'Your CTrend verification code', html, {
      text: `Your CTrend verification code is: ${code}\n\nIt expires in 15 minutes.`,
    });
  }

  async sendPasswordResetLink(to: string, resetUrl: string): Promise<void> {
    const html = this.baseTemplate(`
      <h2 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#1A1A2E;">
        Reset your password
      </h2>
      <p style="margin:0 0 28px;font-size:15px;color:#555;line-height:1.6;">
        We received a request to reset your CTrend password.<br>
        This link expires in <strong>1 hour</strong>.
      </p>
      <p style="text-align:center;margin:0 0 28px;">
        <a href="${resetUrl}"
          style="display:inline-block;background:#1A1A2E;color:#fff;
            text-decoration:none;border-radius:10px;padding:14px 36px;
            font-size:16px;font-weight:600;">
          Reset Password
        </a>
      </p>
      <p style="margin:0;font-size:13px;color:#999;text-align:center;">
        If you didn't request this, you can safely ignore this email.
      </p>
    `);

    await this.send(to, 'Reset your CTrend password', html, {
      text: `Reset your CTrend password:\n\n${resetUrl}\n\nThis link expires in 1 hour. If you didn't request this, ignore this email.`,
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
              <span style="color:#fff;font-size:20px;font-weight:700;letter-spacing:0.5px;display:block;${headerLogo ? 'margin-top:10px;' : ''}">CTrend</span>
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
                © ${new Date().getFullYear()} CTrend · Compare. Vote. See the Trend.
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
