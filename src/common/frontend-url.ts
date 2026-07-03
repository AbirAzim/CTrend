import { ConfigService } from '@nestjs/config';

export const PRODUCTION_FRONTEND_URL = 'https://www.kejitbe.app';

const LEGACY_FRONTEND_HOSTS = new Set(['c-trend.vercel.app', 'kejitbe.app']);

/** Resolve the public web app origin for emails and redirects. */
export function resolveFrontendUrl(config: ConfigService): string {
  const raw = (config.get<string>('FRONTEND_URL') ?? '')
    .trim()
    .replace(/\/$/, '');
  if (!raw) {
    return process.env.NODE_ENV === 'production'
      ? PRODUCTION_FRONTEND_URL
      : 'http://localhost:5173';
  }
  try {
    const url = new URL(raw.startsWith('http') ? raw : `https://${raw}`);
    if (LEGACY_FRONTEND_HOSTS.has(url.hostname)) {
      return PRODUCTION_FRONTEND_URL;
    }
    return url.origin;
  } catch {
    return raw;
  }
}
