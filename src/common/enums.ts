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

export enum PostStatus {
  PUBLISHED = 'published',
  SCHEDULED = 'scheduled',
}

export enum ContentReportTargetType {
  POST = 'post',
  COMMENT = 'comment',
  USER = 'user',
}

export enum ContentReportReasonId {
  SPAM = 'spam',
  HARASSMENT = 'harassment',
  VIOLENCE = 'violence',
  NUDITY = 'nudity',
  COPYRIGHT = 'copyright',
  OTHER = 'other',
}

export enum InvitationStatus {
  PENDING = 'pending',
  ACCEPTED = 'accepted',
}

registerEnumType(UserRole, { name: 'UserRole' });
registerEnumType(InvitationStatus, { name: 'InvitationStatus' });
registerEnumType(PostType, { name: 'PostType' });
registerEnumType(Visibility, { name: 'Visibility' });
registerEnumType(OrgPostReach, { name: 'OrgPostReach' });
registerEnumType(FeedScope, { name: 'FeedScope' });
registerEnumType(FeedSort, { name: 'FeedSort' });
registerEnumType(SubscriptionPlan, { name: 'SubscriptionPlan' });
registerEnumType(SubscriptionStatus, { name: 'SubscriptionStatus' });
registerEnumType(PaymentProvider, { name: 'PaymentProvider' });
registerEnumType(PostStatus, { name: 'PostStatus' });
registerEnumType(ContentReportTargetType, { name: 'ContentReportTargetType' });
registerEnumType(ContentReportReasonId, { name: 'ContentReportReasonId' });
