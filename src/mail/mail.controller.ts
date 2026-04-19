import { Controller, Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

@Controller('email')
export class MailController {
  /**
   * Opens in browser; copies verification code to clipboard (best-effort).
   * Linked from verification emails.
   */
  @Get('copy-code')
  copyCode(@Query('code') code: string | undefined, @Res() res: Response) {
    if (!code || !/^\d{4,10}$/.test(code)) {
      res
        .status(400)
        .type('html')
        .send(
          '<!DOCTYPE html><html><body style="font-family:sans-serif;padding:24px;">Invalid code.</body></html>',
        );
      return;
    }
    const safe = escapeHtml(code);
    const jsonCode = JSON.stringify(code);
    res.type('html').send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Copy code</title>
</head>
<body style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#F0F0F5;padding:32px 16px;text-align:center;">
  <div style="max-width:400px;margin:0 auto;background:#fff;border-radius:16px;padding:28px 24px;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
    <p style="margin:0 0 12px;font-size:15px;color:#555;">Your verification code</p>
    <pre id="code" style="margin:0 0 20px;font-size:28px;font-weight:800;letter-spacing:0.2em;color:#1A1A2E;font-family:ui-monospace,monospace;">${safe}</pre>
    <p id="msg" style="margin:0 0 16px;font-size:14px;color:#2e7d32;min-height:22px;"></p>
    <button type="button" id="btn" style="background:#1A1A2E;color:#fff;border:none;border-radius:10px;padding:12px 28px;font-size:15px;font-weight:600;cursor:pointer;">
      Copy again
    </button>
  </div>
  <script>
    (function () {
      var c = ${jsonCode};
      function setMsg(t) { var el = document.getElementById('msg'); if (el) el.textContent = t; }
      function copy() {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          return navigator.clipboard.writeText(c).then(function () {
            setMsg('Copied to clipboard');
          }).catch(function () { fallback(); });
        }
        fallback();
      }
      function fallback() {
        var ta = document.createElement('textarea');
        ta.value = c;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        try {
          document.execCommand('copy');
          setMsg('Copied to clipboard');
        } catch (e) {
          setMsg('Select the code above to copy');
        }
        document.body.removeChild(ta);
      }
      document.getElementById('btn').addEventListener('click', copy);
      copy();
    })();
  </script>
</body>
</html>`);
  }
}
