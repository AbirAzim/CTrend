import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { join } from 'path';

const LOGO_CID = 'ctrend-logo';
const LOGO_PATH = join(process.cwd(), 'logo.png');

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private transporter: any = null;
  private from: string;

  constructor(private config: ConfigService) {
    const host = this.config.get<string>('SMTP_HOST') || process.env.SMTP_HOST;
    const user = this.config.get<string>('SMTP_USER') || process.env.SMTP_USER;
    const pass = this.config.get<string>('SMTP_PASS') || process.env.SMTP_PASS;
    this.from =
      this.config.get<string>('SMTP_FROM') ||
      process.env.SMTP_FROM ||
      'CTrend <no-reply@ctrend.app>';

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

  async sendVerificationCode(to: string, code: string): Promise<void> {
    const digits = code.split('');
    const digitBoxes = digits
      .map(
        (d) =>
          `<td style="width:48px;height:56px;text-align:center;vertical-align:middle;` +
          `background:#F4F4F8;border-radius:10px;font-size:28px;font-weight:700;` +
          `color:#1A1A2E;font-family:monospace;letter-spacing:0;">${d}</td>`,
      )
      .join('<td style="width:8px;"></td>');

    const html = this.baseTemplate(`
      <h2 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#1A1A2E;">
        Verify your email
      </h2>
      <p style="margin:0 0 28px;font-size:15px;color:#555;line-height:1.6;">
        Enter this code in the CTrend app to complete your sign-up.<br>
        It expires in <strong>15 minutes</strong>.
      </p>

      <!-- Code block -->
      <table cellpadding="0" cellspacing="0" border="0" style="margin:0 auto 28px;">
        <tr>${digitBoxes}</tr>
      </table>

      <!-- Copy-friendly plain text fallback shown prominently -->
      <p style="margin:0 0 28px;text-align:center;">
        <span style="display:inline-block;background:#EEEEF6;border:1.5px dashed #A0A0C0;
          border-radius:8px;padding:10px 28px;font-size:32px;font-weight:800;
          letter-spacing:10px;color:#1A1A2E;font-family:monospace;
          user-select:all;-webkit-user-select:all;cursor:text;">${code}</span>
      </p>
      <p style="margin:0;font-size:13px;color:#999;text-align:center;">
        Click the code above to select it, then copy.
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
              <img src="cid:${LOGO_CID}" alt="CTrend" width="56" height="56"
                style="border-radius:12px;display:block;margin:0 auto 12px;">
              <span style="color:#fff;font-size:20px;font-weight:700;letter-spacing:0.5px;">CTrend</span>
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
        attachments: [
          {
            filename: 'logo.png',
            path: LOGO_PATH,
            cid: LOGO_CID,
          },
        ],
      });
      this.logger.log(`Email sent to ${to}: ${subject}`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to send email to ${to}: ${message}`);
      throw err;
    }
  }
}
