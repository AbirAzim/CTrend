import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Campaign, CampaignDocument } from './campaign.schema';
import {
  CampaignGql,
  CreateCampaignInput,
  UpdateCampaignInput,
} from './graphql/campaign.types';

@Injectable()
export class CampaignsService {
  constructor(
    @InjectModel(Campaign.name) private campaignModel: Model<CampaignDocument>,
  ) {}

  private async clearDefaultExcept(exceptId?: Types.ObjectId): Promise<void> {
    const filter = exceptId
      ? { _id: { $ne: exceptId }, isDefault: true }
      : { isDefault: true };
    await this.campaignModel
      .updateMany(filter, { $set: { isDefault: false } })
      .exec();
  }

  async findActive(): Promise<CampaignDocument[]> {
    return this.campaignModel
      .find({ isActive: true })
      .sort({ isDefault: -1, createdAt: -1 })
      .exec();
  }

  async findAllPublic(): Promise<CampaignDocument[]> {
    return this.campaignModel
      .find({ isActive: true, isPublic: true })
      .sort({ createdAt: -1 })
      .exec();
  }

  async findAll(): Promise<CampaignDocument[]> {
    return this.campaignModel
      .find()
      .sort({ isDefault: -1, isActive: -1, createdAt: -1 })
      .exec();
  }

  async findById(id: string): Promise<CampaignDocument | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    return this.campaignModel.findById(id).exec();
  }

  async findBySlug(slug: string): Promise<CampaignDocument | null> {
    return this.campaignModel.findOne({ slug: slug.toLowerCase() }).exec();
  }

  async create(input: CreateCampaignInput): Promise<CampaignDocument> {
    const existing = await this.findBySlug(input.slug);
    if (existing) {
      throw new BadRequestException(
        `Campaign with slug "${input.slug}" already exists`,
      );
    }
    const makeDefault = !!input.isDefault;
    const isPublic = !!input.isPublic;
    const created = await this.campaignModel.create({
      name: input.name,
      slug: input.slug.toLowerCase(),
      description: input.description,
      bannerText: input.bannerText,
      bannerImageUrl: input.bannerImageUrl,
      ctaLabel: input.ctaLabel,
      ctaUrl: input.ctaUrl,
      isActive: makeDefault ? true : false,
      isDefault: makeDefault,
      prizePerWinner: input.prizePerWinner ?? 100,
      rules: input.rules,
      rulesBn: input.rulesBn,
      fixturesEnabled: input.fixturesEnabled ?? false,
      isPublic,
      hasWinner: !!input.hasWinner,
      hasRewards: isPublic ? false : !!input.hasRewards,
      startDate: input.startDate,
      endDate: input.endDate,
    });
    if (makeDefault) {
      await this.clearDefaultExcept(created._id);
    }
    return created;
  }

  async update(
    id: string,
    input: UpdateCampaignInput,
  ): Promise<CampaignDocument> {
    const doc = await this.findById(id);
    if (!doc) throw new NotFoundException('Campaign not found');
    Object.assign(doc, input);
    if (input.isActive === false) {
      doc.isDefault = false;
    }
    if (input.isDefault === true) {
      doc.isActive = true;
    }
    // public campaigns can never have monetary rewards
    if (doc.isPublic) {
      doc.hasRewards = false;
    }
    await doc.save();
    if (doc.isDefault) {
      await this.clearDefaultExcept(doc._id);
    }
    return doc;
  }

  async toggle(id: string, isActive: boolean): Promise<CampaignDocument> {
    const doc = await this.findById(id);
    if (!doc) throw new NotFoundException('Campaign not found');
    doc.isActive = isActive;
    if (!isActive) {
      doc.isDefault = false;
    }
    await doc.save();
    return doc;
  }

  toGql(doc: CampaignDocument): CampaignGql {
    return {
      id: doc._id.toHexString(),
      name: doc.name,
      slug: doc.slug,
      description: doc.description,
      bannerText: doc.bannerText,
      bannerImageUrl: doc.bannerImageUrl,
      ctaLabel: doc.ctaLabel,
      ctaUrl: doc.ctaUrl,
      isActive: doc.isActive,
      isDefault: !!doc.isDefault,
      prizePerWinner: doc.prizePerWinner,
      rules: doc.rules,
      rulesBn: doc.rulesBn,
      fixturesEnabled: doc.fixturesEnabled ?? false,
      isPublic: doc.isPublic ?? false,
      hasWinner: doc.hasWinner ?? false,
      hasRewards: doc.hasRewards ?? false,
      startDate: doc.startDate,
      endDate: doc.endDate,
      createdAt: doc.createdAt,
    };
  }
}
