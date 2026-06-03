import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UsersService } from '../users/users.service';

/** FCM error codes that mean a token is permanently dead and should be purged. */
const DEAD_TOKEN_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
  'messaging/invalid-argument',
]);

/** Notification-block fields the OS renders directly (even when the app is killed). */
export interface PushNotification {
  /** Sender display name (system/announcement: brand name or announcement title). */
  title: string;
  /** Action sentence / chat message text. */
  body: string;
  /** Absolute https avatar URL → big-picture image. Omit for system/announcement. */
  imageUrl?: string | null;
}

/**
 * Sends hybrid (notification + data), high-priority FCM messages to a user's
 * registered devices.
 *
 * Lazily initialised (mirrors the Stripe pattern in BillingService): if no
 * `FIREBASE_SERVICE_ACCOUNT` is configured, every send becomes a no-op so the
 * app still boots and runs in environments without push credentials.
 *
 * Each message carries a `notification` block so the OS renders it instantly —
 * reliable even when the RN app is terminated (waking a killed app to render
 * from JS is throttled/dropped on Android) — plus a `data` block the app reads
 * on tap for deep-linking. Sent with `android.priority: 'high'`.
 */
@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private messaging: any = null;

  constructor(
    private config: ConfigService,
    private usersService: UsersService,
  ) {
    this.init();
  }

  private init(): void {
    const raw = this.config.get<string>('FIREBASE_SERVICE_ACCOUNT');
    if (!raw) {
      this.logger.warn(
        'FIREBASE_SERVICE_ACCOUNT not set — push notifications are disabled.',
      );
      return;
    }
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
      const admin = require('firebase-admin');
      const trimmed = raw.trim();
      const json = trimmed.startsWith('{')
        ? trimmed
        : Buffer.from(trimmed, 'base64').toString('utf8');
      const serviceAccount = JSON.parse(json);
      const app = admin.apps?.length
        ? admin.app()
        : admin.initializeApp({
            credential: admin.credential.cert(serviceAccount),
          });
      this.messaging = app.messaging();
      this.logger.log(
        'Firebase Admin initialised — push notifications enabled.',
      );
    } catch (err) {
      this.logger.error(
        `Failed to initialise Firebase Admin: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Send a hybrid (notification + data) high-priority push to every device
   * registered to `userId`. The OS renders `notification` directly; `data` is
   * delivered to the app on tap for deep-linking. All `data` values are coerced
   * to strings (FCM data payloads must be string maps). Invalid/unregistered
   * tokens reported by FCM are pruned from the user.
   *
   * `notification` is optional: when omitted (or with no title/body), the
   * message falls back to data-only.
   */
  async sendDataToUser(
    userId: string,
    data: Record<string, string | undefined | null>,
    notification?: PushNotification,
  ): Promise<void> {
    if (!this.messaging || !userId) return;

    const tokens = await this.usersService.getPushTokens(userId);
    if (!tokens.length) return;

    const stringData: Record<string, string> = {};
    for (const [key, value] of Object.entries(data)) {
      stringData[key] = value == null ? '' : String(value);
    }

    const hasNotification = !!(
      notification &&
      (notification.title || notification.body)
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const message: any = {
      tokens,
      data: stringData,
      android: { priority: 'high' },
    };

    if (hasNotification) {
      message.notification = {
        title: notification!.title || '',
        body: notification!.body || '',
        ...(notification!.imageUrl ? { imageUrl: notification!.imageUrl } : {}),
      };
      // OS-rendered alert on iOS too (no silent/background push when visible).
      message.apns = {
        headers: { 'apns-priority': '10', 'apns-push-type': 'alert' },
      };
    } else {
      // Data-only fallback: wake the app to render it itself.
      message.apns = {
        headers: { 'apns-priority': '10', 'apns-push-type': 'background' },
        payload: { aps: { 'content-available': 1 } },
      };
    }

    try {
      const res = await this.messaging.sendEachForMulticast(message);

      if (res.failureCount > 0) {
        const dead: string[] = [];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        res.responses.forEach((r: any, i: number) => {
          if (!r.success && DEAD_TOKEN_CODES.has(r.error?.code)) {
            dead.push(tokens[i]);
          }
        });
        if (dead.length) {
          await this.usersService.removePushTokensEverywhere(dead);
        }
      }
    } catch (err) {
      // Never let a push failure break the originating mutation.
      this.logger.error(
        `FCM send failed for user ${userId}: ${(err as Error).message}`,
      );
    }
  }
}
