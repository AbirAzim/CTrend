import { registerEnumType } from '@nestjs/graphql';

export enum UserRole {
  USER = 'user',
  ORG = 'org',
  ADMIN = 'admin',
}

export enum PostType {
  USER = 'user',
  ORG = 'org',
  SYSTEM = 'system',
}

export enum Visibility {
  PUBLIC = 'public',
  PRIVATE = 'private',
}

export enum OrgPostReach {
  CONNECTED = 'connected',
  GLOBAL = 'global',
}

export enum FeedScope {
  GLOBAL = 'global',
  PERSONALIZED = 'personalized',
}

export enum FeedSort {
  TRENDING = 'trending',
  LATEST = 'latest',
  ADMIN_PRIORITY = 'admin_priority',
}

export enum SubscriptionPlan {
  FREE = 'free',
  PREMIUM = 'premium',
}

export enum SubscriptionStatus {
  ACTIVE = 'active',
  CANCELED = 'canceled',
  EXPIRED = 'expired',
}

export enum PaymentProvider {
  STRIPE = 'stripe',
  BKASH = 'bkash',
}

registerEnumType(UserRole, { name: 'UserRole' });
registerEnumType(PostType, { name: 'PostType' });
registerEnumType(Visibility, { name: 'Visibility' });
registerEnumType(OrgPostReach, { name: 'OrgPostReach' });
registerEnumType(FeedScope, { name: 'FeedScope' });
registerEnumType(FeedSort, { name: 'FeedSort' });
registerEnumType(SubscriptionPlan, { name: 'SubscriptionPlan' });
registerEnumType(SubscriptionStatus, { name: 'SubscriptionStatus' });
registerEnumType(PaymentProvider, { name: 'PaymentProvider' });
