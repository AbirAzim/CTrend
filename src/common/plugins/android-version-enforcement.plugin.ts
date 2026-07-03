import { GraphQLError } from 'graphql';
import type { ApolloServerPlugin } from '@apollo/server';
import { PlatformSettingsService } from '../../platform-settings/platform-settings.service';
import { UsersService } from '../../users/users.service';

/** GraphQL operations allowed while an Android update is required. */
const ALLOWED_WHILE_UPDATE_REQUIRED = new Set([
  'PlatformSettings',
  'IntrospectionQuery',
]);

type GqlContext = {
  req?: {
    headers?: Record<string, string | string[] | undefined>;
    user?: { id: string };
  };
};

function headerValue(
  headers: Record<string, string | string[] | undefined> | undefined,
  name: string,
): string | undefined {
  const raw = headers?.[name] ?? headers?.[name.toLowerCase()];
  if (Array.isArray(raw)) return raw[0];
  return typeof raw === 'string' ? raw : undefined;
}

function parseClientAndroidVersion(
  headers: Record<string, string | string[] | undefined> | undefined,
): number {
  const raw = headerValue(headers, 'x-android-version-code');
  const parsed = parseInt(String(raw ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function isAndroidClient(
  headers: Record<string, string | string[] | undefined> | undefined,
): boolean {
  const platform = headerValue(headers, 'x-app-platform')?.toLowerCase();
  if (platform === 'android') return true;
  const ua = headerValue(headers, 'user-agent')?.toLowerCase() ?? '';
  return (
    ua.includes('android') && (ua.includes('okhttp') || ua.includes('react'))
  );
}

export function createAndroidVersionEnforcementPlugin(
  platformSettingsService: PlatformSettingsService,
  usersService: UsersService,
): ApolloServerPlugin<GqlContext> {
  return {
    async requestDidStart() {
      return {
        async didResolveOperation(requestContext) {
          const opName = requestContext.operationName ?? '';
          if (ALLOWED_WHILE_UPDATE_REQUIRED.has(opName)) return;

          const ctx = requestContext.contextValue as GqlContext;
          const req = ctx.req;
          const headers = req?.headers;
          const userId = req?.user?.id;

          const settings = await platformSettingsService.toGql();
          const minRequired = settings.minAndroidVersionCode ?? 0;
          if (minRequired <= 0) return;

          const clientVersion = parseClientAndroidVersion(headers);
          const androidClient = isAndroidClient(headers);

          if (userId && clientVersion > 0) {
            void usersService.updateLastAndroidVersionCode(
              userId,
              clientVersion,
            );
          }

          let recordedVersion = 0;
          if (userId) {
            const user = await usersService.findById(userId);
            recordedVersion = user?.lastAndroidVersionCode ?? 0;
          }

          const effectiveVersion = Math.max(clientVersion, recordedVersion);

          // Only block when we know the client is below min — never guess from missing headers.
          if (effectiveVersion <= 0) return;
          if (effectiveVersion >= minRequired) return;

          if (!androidClient && !userId) return;

          throw new GraphQLError('Android app update required', {
            extensions: {
              code: 'ANDROID_UPDATE_REQUIRED',
              minAndroidVersionCode: minRequired,
              title: settings.androidUpdateTitle?.trim() || 'Update required',
              body:
                settings.androidUpdateBody?.trim() ||
                'A newer version of Ke Jitbe is available. Please update from Google Play.',
            },
          });
        },
      };
    },
  };
}
