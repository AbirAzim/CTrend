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
    'Pick the outcome you think will happen — Home team, Away team, or Draw (group stage matches only). You can change your vote any time before voting closes.\n' +
    'After the final whistle, the result is confirmed. Only voters who correctly predicted the outcome enter the prize draw — the winning team, or Draw if the match ends in a tie (group stage only). Knockout matches have no Draw option.\n' +
    'Before kickoff, you can also predict the exact score. Among eligible voters, exact-score predictors get first priority in the prize draw. Knockout matches are graded on the score after 90 minutes plus extra time — penalty shootouts do not count.\n' +
    'One lucky winner is randomly selected from all eligible voters for that match and receives a cash prize via bKash — 100 BDT for group and knockout matches, 500 BDT for semi-finals, 1,000 BDT for the final, and 200 BDT for the third-place match.\n' +
    'You must vote with your account — anonymous votes are not eligible for the prize draw.\n' +
    'One vote per account per match. Make it count!';

  private readonly WC_RULES_BN =
    'প্রতিটি ম্যাচ শুরুর ঠিক ২৪ ঘণ্টা আগে আপনার ফিডে একটি নতুন ভোটিং পোস্ট আসবে — উদাহরণস্বরূপ, ব্রাজিল বনাম আর্জেন্টিনা রাত ৯:০০টায় শুরু হলে, আগের রাত ৯:০০টা থেকে ভোট দেওয়া যাবে।\n' +
    'ম্যাচ শুরুর মুহূর্তে (কিক-অফে) ভোটিং বন্ধ হয়ে যাবে। কিক-অফের পরে দেওয়া কোনো ভোট গণনা করা হবে না।\n' +
    'আপনি যে ফলাফল হবে বলে মনে করেন তা বেছে নিন — হোম টিম, অ্যাওয়ে টিম, অথবা ড্র (শুধু গ্রুপ স্টেজের ম্যাচে)। ভোটিং বন্ধ হওয়ার আগে যেকোনো সময় ভোট পরিবর্তন করা যাবে।\n' +
    'ম্যাচ শেষে ফলাফল নিশ্চিত হলে, যারা সঠিক ফলাফল বেছে নিয়েছেন (জয়ী দল, অথবা গ্রুপ স্টেজে ড্র) তারাই পুরস্কার ড্রতে অংশ নেবেন। নকআউট ম্যাচে ড্র অপশন নেই — যে দল এগোবে তা বেছে নিন।\n' +
    'কিক-অফের আগে আপনি সঠিক স্কোরও প্রেডিক্ট করতে পারেন। যোগ্য ভোটারদের মধ্যে সঠিক স্কোর প্রেডিক্ট করেছেন তাদের পুরস্কার ড্রতে অগ্রাধিকার পাবেন। নকআউট ম্যাচে স্কোর গণনা হয় ৯০ মিনিট ও এক্সট্রা টাইমের পর — পেনাল্টি শুটআউট গণনায় আসে না।\n' +
    'যোগ্য ভোটারদের মধ্য থেকে একজন ভাগ্যবান বিজয়ী র‍্যান্ডমলি বেছে নেওয়া হবে এবং বিকাশের মাধ্যমে নগদ পুরস্কার পাবেন — গ্রুপ ও নকআউট ম্যাচে ১০০ টাকা, সেমি-ফাইনালে ৫০০ টাকা, ফাইনালে ১,০০০ টাকা এবং তৃতীয় স্থান নির্ধারণী ম্যাচে ২০০ টাকা।\n' +
    'আপনার অ্যাকাউন্ট দিয়ে ভোট দিতে হবে — বেনামী ভোট পুরস্কার ড্রর জন্য গণ্য হবে না।\n' +
    'প্রতিটি ম্যাচে প্রতি অ্যাকাউন্টে একটি মাত্র ভোট। সঠিকভাবে ব্যবহার করুন!';

  private async seedWorldCupCampaign() {
    const existing = await this.campaignsService.findBySlug('world-cup-2026');

    if (existing) {
      // Always keep rules, text and URLs up to date
      await this.campaignsService.update(existing._id.toHexString(), {
        name: 'World Cup Fever 2026',
        bannerText:
          'Predict match winners — win up to 1,000 BDT! Vote before kickoff.',
        description:
          'FIFA World Cup 2026 is here! Predict the winner of each match before kickoff. Prizes range from 100 BDT (group & knockout) to 1,000 BDT for the final.',
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
        'FIFA World Cup 2026 is here! Predict the winner of each match before kickoff. Prizes range from 100 BDT (group & knockout) to 1,000 BDT for the final.',
      bannerText:
        'Predict match winners — win up to 1,000 BDT! Vote before kickoff.',
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
      this.logger.log(
        'World Cup Fever 2026 campaign seeded and activated (dev)',
      );
    } else {
      this.logger.log(
        'World Cup Fever 2026 campaign seeded (activate via Admin → Campaigns)',
      );
    }
  }
}
