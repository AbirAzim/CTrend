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

  async findActive(): Promise<CampaignDocument[]> {
    return this.campaignModel.find({ isActive: true }).sort({ createdAt: -1 }).exec();
  }

  async findAll(): Promise<CampaignDocument[]> {
    return this.campaignModel.find().sort({ createdAt: -1 }).exec();
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
      throw new BadRequestException(`Campaign with slug "${input.slug}" already exists`);
    }
    return this.campaignModel.create({
      name: input.name,
      slug: input.slug.toLowerCase(),
      description: input.description,
      bannerText: input.bannerText,
      bannerImageUrl: input.bannerImageUrl,
      ctaLabel: input.ctaLabel,
      ctaUrl: input.ctaUrl,
      isActive: false,
      prizePerWinner: input.prizePerWinner ?? 100,
      rules: input.rules,
      rulesBn: input.rulesBn,
      fixturesEnabled: input.fixturesEnabled ?? false,
      startDate: input.startDate,
      endDate: input.endDate,
    });
  }

  async update(id: string, input: UpdateCampaignInput): Promise<CampaignDocument> {
    const doc = await this.findById(id);
    if (!doc) throw new NotFoundException('Campaign not found');
    Object.assign(doc, input);
    await doc.save();
    return doc;
  }

  async toggle(id: string, isActive: boolean): Promise<CampaignDocument> {
    const doc = await this.findById(id);
    if (!doc) throw new NotFoundException('Campaign not found');
    doc.isActive = isActive;
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
      prizePerWinner: doc.prizePerWinner,
      rules: doc.rules,
      rulesBn: doc.rulesBn,
      fixturesEnabled: doc.fixturesEnabled ?? false,
      startDate: doc.startDate,
      endDate: doc.endDate,
      createdAt: doc.createdAt,
    };
  }
}
