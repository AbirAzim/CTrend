export interface MatchContext {
  home: string;
  away: string;
  group?: string | null;
  stage: string;
  kickoff: Date;
}

const GROUP_TEMPLATES = [
  ({ home, away }: MatchContext) =>
    `⚽ Who takes the W? ${home} vs ${away} — cast your vote before kickoff!`,
  ({ home, away }: MatchContext) =>
    `🔥 Battle of the Group Stage! ${home} takes on ${away}. Who are you backing?`,
  ({ home, away }: MatchContext) =>
    `🌍 World Cup Drama incoming! ${home} 🆚 ${away} — your prediction counts.`,
  ({ home, away }: MatchContext) =>
    `⚡ ${home} vs ${away}: 90 minutes of glory or heartbreak. Who wins?`,
  ({ home, away }: MatchContext) =>
    `🏟️ The group stage heats up! ${home} faces ${away} — pick your winner!`,
  ({ home, away }: MatchContext) =>
    `🎯 Points on the line! ${home} vs ${away}. Vote before the first whistle.`,
  ({ home, away }: MatchContext) =>
    `🌟 ${home} vs ${away}: every goal matters at this stage. Who advances?`,
  ({ home, away }: MatchContext) =>
    `💥 Big clash alert! ${home} and ${away} battle it out. Your call?`,
];

const KNOCKOUT_TEMPLATES = [
  ({ home, away }: MatchContext) =>
    `🏆 No second chances — ${home} vs ${away}. Who makes the next round?`,
  ({ home, away }: MatchContext) =>
    `⚔️ Knockout time! ${home} vs ${away}: one team goes home. Who survives?`,
  ({ home, away }: MatchContext) =>
    `🚨 ${home} or ${away}? One match, winner takes all. Place your vote!`,
  ({ home, away }: MatchContext) =>
    `🔴 Win or go home — ${home} faces ${away} in a must-win clash!`,
  ({ home, away }: MatchContext) =>
    `🌠 The road to glory narrows. ${home} vs ${away} — who moves forward?`,
];

const FINAL_TEMPLATES = [
  ({ home, away }: MatchContext) =>
    `🏆🌍 THE FINAL IS HERE! ${home} vs ${away} — who lifts the World Cup?`,
  ({ home, away }: MatchContext) =>
    `👑 One match for eternal glory. ${home} 🆚 ${away}. Vote for your champions!`,
  ({ home, away }: MatchContext) =>
    `🎆 World Cup Final: ${home} vs ${away}. History will be made — who writes it?`,
];

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function generateMatchCaption(ctx: MatchContext): string {
  const s = ctx.stage.toUpperCase();
  if (s === 'FINAL') {
    return pickRandom(FINAL_TEMPLATES)(ctx);
  }
  if (s === 'GROUP_STAGE') {
    return pickRandom(GROUP_TEMPLATES)(ctx);
  }
  return pickRandom(KNOCKOUT_TEMPLATES)(ctx);
}
