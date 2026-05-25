import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { CampaignsService } from '../campaigns/campaigns.service';

@Injectable()
export class CampaignSeedService implements OnModuleInit {
  private readonly logger = new Logger(CampaignSeedService.name);

  constructor(private readonly campaignsService: CampaignsService) {}

  async onModuleInit() {
    try {
      await this.seedWorldCupCampaign();
    } catch (err) {
      this.logger.error('Campaign seed failed', err);
    }
  }

  private readonly WC_RULES =
    'A new voting post appears on your feed exactly 24 hours before each match kicks off — for example, if Brazil vs Argentina starts at 9:00 PM, you can start voting from 9:00 PM the night before.\n' +
    'Voting closes the moment the match begins (at kickoff time). Any votes placed after kickoff will not be counted.\n' +
    'Choose the team you think will win — Home team or Away team. You can change your vote any time before voting closes.\n' +
    'After the final whistle, the result is confirmed. Voters who predicted the winning team enter the prize draw. If the match ends in a draw, all voters are eligible for the prize — every vote counts.\n' +
    'One lucky winner is randomly selected from all eligible voters for that match and receives 100 BDT via bKash.\n' +
    'You must vote with your account — anonymous votes are not eligible for the prize draw.\n' +
    'One vote per account per match. Make it count!';

  private readonly WC_RULES_BN =
    'প্রতিটি ম্যাচ শুরুর ঠিক ২৪ ঘণ্টা আগে আপনার ফিডে একটি নতুন ভোটিং পোস্ট আসবে — উদাহরণস্বরূপ, ব্রাজিল বনাম আর্জেন্টিনা রাত ৯:০০টায় শুরু হলে, আগের রাত ৯:০০টা থেকে ভোট দেওয়া যাবে।\n' +
    'ম্যাচ শুরুর মুহূর্তে (কিক-অফে) ভোটিং বন্ধ হয়ে যাবে। কিক-অফের পরে দেওয়া কোনো ভোট গণনা করা হবে না।\n' +
    'আপনি যে দল জিতবে বলে মনে করেন তা বেছে নিন — হোম টিম বা অ্যাওয়ে টিম। ভোটিং বন্ধ হওয়ার আগে যেকোনো সময় ভোট পরিবর্তন করা যাবে।\n' +
    'ম্যাচ শেষে ফলাফল নিশ্চিত হলে, যারা জয়ী দল বেছে নিয়েছেন তারা পুরস্কার ড্রতে অংশ নেবেন। ম্যাচ ড্রতে শেষ হলে, সকল ভোটার পুরস্কারের জন্য যোগ্য — প্রতিটি ভোটই গুরুত্বপূর্ণ।\n' +
    'যোগ্য ভোটারদের মধ্য থেকে একজন ভাগ্যবান বিজয়ী র‍্যান্ডমলি বেছে নেওয়া হবে এবং তিনি বিকাশের মাধ্যমে ১০০ টাকা পাবেন।\n' +
    'আপনার অ্যাকাউন্ট দিয়ে ভোট দিতে হবে — বেনামী ভোট পুরস্কার ড্রর জন্য গণ্য হবে না।\n' +
    'প্রতিটি ম্যাচে প্রতি অ্যাকাউন্টে একটি মাত্র ভোট। সঠিকভাবে ব্যবহার করুন!';

  private async seedWorldCupCampaign() {
    const existing = await this.campaignsService.findBySlug('world-cup-2026');

    if (existing) {
      // Always keep rules, text and URLs up to date
      await this.campaignsService.update(existing._id.toHexString(), {
        name: 'World Cup Fever 2026',
        bannerText: 'Predict match winners and win 100 BDT! Vote before kickoff.',
        ctaLabel: 'World Cup 2026',
        ctaUrl: '/campaign/world-cup-2026',
        rules: this.WC_RULES,
        rulesBn: this.WC_RULES_BN,
        fixturesEnabled: true,
      });
      this.logger.log('World Cup Fever 2026 campaign updated');
      return;
    }

    const doc = await this.campaignsService.create({
      name: 'World Cup Fever 2026',
      slug: 'world-cup-2026',
      description:
        'FIFA World Cup 2026 is here! Predict the winner of each match, vote before kickoff, and stand a chance to win 100 BDT for every correct prediction.',
      bannerText: 'Predict match winners and win 100 BDT! Vote before kickoff.',
      ctaLabel: 'World Cup 2026',
      ctaUrl: '/campaign/world-cup-2026',
      prizePerWinner: 100,
      fixturesEnabled: true,
      rules: this.WC_RULES,
      rulesBn: this.WC_RULES_BN,
      startDate: new Date('2026-06-11'),
      endDate: new Date('2026-07-19'),
    });

    // Auto-activate in non-production environments so the banner shows immediately
    if (process.env.NODE_ENV !== 'production') {
      await this.campaignsService.toggle(doc._id.toHexString(), true);
      this.logger.log('World Cup Fever 2026 campaign seeded and activated (dev)');
    } else {
      this.logger.log('World Cup Fever 2026 campaign seeded (activate via Admin → Campaigns)');
    }
  }
}
