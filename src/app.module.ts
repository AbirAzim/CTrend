import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { GraphQLModule } from '@nestjs/graphql';
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { MongooseModule } from '@nestjs/mongoose';
import { ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { join } from 'path';
import { GqlThrottlerGuard } from './common/guards/gql-throttler.guard';
import { UserRole } from './common/enums';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from './users/users.service';
import { UsersModule } from './users/users.module';
import { AuthModule } from './auth/auth.module';
import { CategoriesModule } from './categories/categories.module';
import { OrganizationsModule } from './organizations/organizations.module';
import { FollowsModule } from './follows/follows.module';
import { VotesModule } from './votes/votes.module';
import { PostsModule } from './posts/posts.module';
import { CommentsModule } from './comments/comments.module';
import { FeedModule } from './feed/feed.module';
import { BillingModule } from './billing/billing.module';
import { SeedModule } from './seed/seed.module';
import { MailModule } from './mail/mail.module';
import { UploadsModule } from './uploads/uploads.module';
import { InvitationsModule } from './invitations/invitations.module';
import { PromotionTokensModule } from './promotion-tokens/promotion-tokens.module';
import { FixturesModule } from './fixtures/fixtures.module';
import { WorldCupCampaignModule } from './world-cup-campaign/world-cup-campaign.module';
import { CampaignsModule } from './campaigns/campaigns.module';
import { MessagesModule } from './messages/messages.module';
import { NotificationsModule } from './notifications/notifications.module';
import { PresenceModule } from './presence/presence.module';
import { PresenceService } from './presence/presence.service';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (c: ConfigService) => ({
        uri: c.getOrThrow<string>('MONGODB_URI'),
      }),
    }),
    ThrottlerModule.forRoot([
      {
        ttl: 60000,
        limit: 120,
      },
    ]),
    GraphQLModule.forRootAsync<ApolloDriverConfig>({
      driver: ApolloDriver,
      imports: [ConfigModule, UsersModule, AuthModule, PresenceModule],
      inject: [ConfigService, JwtService, UsersService, PresenceService],
      useFactory: (
        config: ConfigService,
        jwtService: JwtService,
        usersService: UsersService,
        presenceService: PresenceService,
      ) => ({
        autoSchemaFile: join(process.cwd(), 'src/schema.gql'),
        sortSchema: true,
        context: async ({
          req,
          res,
          connectionParams,
        }: {
          req?: {
            headers?: Record<string, string | string[] | undefined>;
            user?: unknown;
          };
          res?: unknown;
          connectionParams?: Record<string, unknown>;
        }) => {
          const ctxReq = req ?? { headers: {} };
          const tokenFromHeader =
            typeof ctxReq.headers?.authorization === 'string'
              ? ctxReq.headers.authorization
              : typeof ctxReq.headers?.Authorization === 'string'
                ? ctxReq.headers.Authorization
                : undefined;
          const tokenFromWsParams =
            typeof connectionParams?.Authorization === 'string'
              ? connectionParams.Authorization
              : typeof connectionParams?.authorization === 'string'
                ? connectionParams.authorization
                : undefined;
          const bearer = tokenFromHeader ?? tokenFromWsParams;
          // For WS subscriptions there is no HTTP req, so ctxReq.headers has no
          // Authorization header.  Passport's fromAuthHeaderAsBearerToken() only
          // reads from req.headers.authorization, so we back-fill it here so that
          // GqlAuthGuard (which delegates to the JWT passport strategy) can
          // extract the token the same way it does for HTTP requests.
          if (bearer && !ctxReq.headers?.authorization) {
            (ctxReq.headers as Record<string, string>).authorization = bearer;
          }
          const token = bearer?.startsWith('Bearer ')
            ? bearer.slice('Bearer '.length)
            : undefined;
          if (token) {
            try {
              const payload = await jwtService.verifyAsync<{
                sub: string;
                activeRole?: string;
              }>(token);
              const user = await usersService.findById(payload.sub);
              if (user) {
                const roles = usersService.resolveRoles(user);
                // Use the JWT-embedded activeRole if the user still holds it.
                const activeRole =
                  payload.activeRole &&
                  roles.includes(payload.activeRole as never)
                    ? payload.activeRole
                    : roles.includes(UserRole.ADMIN)
                      ? UserRole.ADMIN
                      : UserRole.USER;
                ctxReq.user = {
                  id: user._id.toHexString(),
                  role: activeRole,
                  roles,
                  email: user.email,
                  username: user.username,
                  interests: user.interests ?? [],
                };
              }
            } catch {
              // Ignore invalid tokens in context; guards still enforce auth where required.
            }
          }
          return { req: ctxReq, res };
        },
        subscriptions: {
          'graphql-ws': {
            keepAlive: 10_000, // ping clients every 10 s — keeps Safari from dropping idle WS connections
            onConnect: async (ctx) => {
              const params = (ctx.connectionParams ?? {}) as Record<
                string,
                string
              >;
              const bearer =
                params['Authorization'] ?? params['authorization'] ?? '';
              const token = bearer.startsWith('Bearer ')
                ? bearer.slice(7)
                : bearer;
              if (token) {
                try {
                  const payload = await jwtService.verifyAsync<{ sub: string }>(
                    token,
                  );
                  const socket = (ctx.extra as { socket: unknown }).socket;
                  presenceService.markOnline(
                    socket as import('ws').WebSocket,
                    payload.sub,
                  );
                } catch {
                  /* invalid token */
                }
              }
            },
            onDisconnect: (ctx) => {
              const socket = (ctx.extra as { socket: unknown }).socket;
              presenceService.markOffline(socket as import('ws').WebSocket);
            },
          },
        },
        playground: config.get('NODE_ENV') !== 'production',
      }),
    }),
    MailModule,
    UsersModule,
    AuthModule,
    CategoriesModule,
    OrganizationsModule,
    FollowsModule,
    VotesModule,
    PostsModule,
    CommentsModule,
    FeedModule,
    BillingModule,
    SeedModule,
    UploadsModule,
    InvitationsModule,
    PromotionTokensModule,
    FixturesModule,
    WorldCupCampaignModule,
    CampaignsModule,
    PresenceModule,
    NotificationsModule,
    MessagesModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: GqlThrottlerGuard,
    },
  ],
})
export class AppModule {}
