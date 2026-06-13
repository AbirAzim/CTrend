import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UsersService } from '../users/users.service';

/** FCM error codes that mean a token is permanently dead and should be purged. */
const DEAD_TOKEN_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
  'messaging/invalid-argument',
]);

/**
 * Sends data-only, high-priority FCM messages to a user's registered devices.
 *
 * Lazily initialised (mirrors the Stripe pattern in BillingService): if no
 * `FIREBASE_SERVICE_ACCOUNT` is configured, every send becomes a no-op so the
 * app still boots and runs in environments without push credentials.
 *
 * Messages are sent data-only (no `notification` block) so the app's native
 * FirebaseMessagingService renders them itself (round avatar largeIcon + sender
 * name + body, deep-link on tap). A `notification` block would make Firebase
 * auto-display its own big-picture version and bypass that service. Sent with
 * `android.priority: 'high'` so frozen/backgrounded Android apps are woken.
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
   * Send a data-only high-priority push to every device registered to `userId`.
   * All values are coerced to strings (FCM data payloads must be string maps).
   * Invalid/unregistered tokens reported by FCM are pruned from the user.
   */
  async sendDataToUser(
    userId: string,
    data: Record<string, string | undefined | null>,
  ): Promise<void> {
    if (!this.messaging || !userId) return;

    const tokens = await this.usersService.getPushTokens(userId);
    if (!tokens.length) return;

    const stringData: Record<string, string> = {};
    for (const [key, value] of Object.entries(data)) {
      stringData[key] = value == null ? '' : String(value);
    }

    try {
      const res = await this.messaging.sendEachForMulticast({
        tokens,
        data: stringData,
        android: { priority: 'high' },
        apns: {
          headers: { 'apns-priority': '10', 'apns-push-type': 'background' },
          payload: { aps: { 'content-available': 1 } },
        },
      });

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

  /**
   * Platform-wide broadcast: sends a data-only FCM push to every registered
   * device. Batches in groups of 500 (FCM multicast limit). Dead tokens are
   * pruned after each batch. Runs fully async — never blocks the caller.
   */
  async broadcastDataToAll(data: Record<string, string>): Promise<void> {
    if (!this.messaging) return;

    const allTokens = await this.usersService.getAllPushTokens();
    if (!allTokens.length) return;

    const BATCH = 500;
    const dead: string[] = [];

    for (let i = 0; i < allTokens.length; i += BATCH) {
      const batch = allTokens.slice(i, i + BATCH);
      try {
        const res = await this.messaging.sendEachForMulticast({
          tokens: batch,
          data,
          android: { priority: 'high' },
          apns: {
            headers: { 'apns-priority': '10', 'apns-push-type': 'background' },
            payload: { aps: { 'content-available': 1 } },
          },
        });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        res.responses.forEach((r: any, idx: number) => {
          if (!r.success && DEAD_TOKEN_CODES.has(r.error?.code)) {
            dead.push(batch[idx]);
          }
        });
      } catch (err) {
        this.logger.error(`Broadcast batch failed: ${(err as Error).message}`);
      }
    }

    if (dead.length) {
      await this.usersService.removePushTokensEverywhere(dead);
    }
  }
}
