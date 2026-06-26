export const VOTE_SOUND_IDS = [
  'silent',
  'buzz-in',
  'crowd-pop',
  'soft-pop',
  'coin-ping',
  'slot-tick',
  'thock',
  'whistle-chirp',
  'success-duo',
] as const;

export const NOTIFICATION_SOUND_IDS = [
  'ascending-chime',
  'success-duo',
  'coin-ping',
  'soft-chime',
  'gentle-bell',
  'whistle-chirp',
  'buzz-in',
] as const;

export const MESSAGE_SOUND_IDS = [
  'gentle-ping',
  'soft-pop',
  'coin-ping',
  'thock',
  'slot-tick',
  'buzz-in',
] as const;

export type VoteSoundId = (typeof VOTE_SOUND_IDS)[number];
export type NotificationSoundId = (typeof NOTIFICATION_SOUND_IDS)[number];
export type MessageSoundId = (typeof MESSAGE_SOUND_IDS)[number];

export const DEFAULT_VOTE_SOUND_ID: VoteSoundId = 'silent';
export const DEFAULT_NOTIFICATION_SOUND_ID: NotificationSoundId =
  'ascending-chime';
export const DEFAULT_MESSAGE_SOUND_ID: MessageSoundId = 'gentle-ping';

export function isVoteSoundId(value: string): value is VoteSoundId {
  return (VOTE_SOUND_IDS as readonly string[]).includes(value);
}

export function isNotificationSoundId(
  value: string,
): value is NotificationSoundId {
  return (NOTIFICATION_SOUND_IDS as readonly string[]).includes(value);
}

export function isMessageSoundId(value: string): value is MessageSoundId {
  return (MESSAGE_SOUND_IDS as readonly string[]).includes(value);
}
