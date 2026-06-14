import type { Prisma, SeasonalCampaign as PrismaSeasonalCampaign } from '@prisma/client';
import { prisma } from './prisma-client.js';
import type { SeasonalCampaign } from '../../domain/entities/seasonal-campaign.js';
import type {
  CreateSeasonalCampaignInput,
  SeasonalCampaignRepository,
  UpdateSeasonalCampaignInput,
} from '../../domain/repositories/seasonal-campaign-repository.js';

function mapCampaign(record: PrismaSeasonalCampaign): SeasonalCampaign {
  return {
    id: record.id,
    key: record.key,
    ribbon: record.ribbon,
    eyebrow: record.eyebrow,
    emoji: record.emoji,
    accent: record.accent,
    accentText: record.accentText,
    startMonth: record.startMonth,
    startDay: record.startDay,
    endMonth: record.endMonth,
    endDay: record.endDay,
    year: record.year,
    priority: record.priority,
    isActive: record.isActive,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export class PrismaSeasonalCampaignRepository implements SeasonalCampaignRepository {
  async findById(id: string): Promise<SeasonalCampaign | null> {
    const record = await prisma.seasonalCampaign.findUnique({ where: { id } });
    return record ? mapCampaign(record) : null;
  }

  async findAllActive(): Promise<SeasonalCampaign[]> {
    const records = await prisma.seasonalCampaign.findMany({
      where: { isActive: true },
      orderBy: [{ priority: 'desc' }, { startMonth: 'asc' }, { startDay: 'asc' }],
    });
    return records.map(mapCampaign);
  }

  async listAll(): Promise<SeasonalCampaign[]> {
    const records = await prisma.seasonalCampaign.findMany({
      orderBy: [{ priority: 'desc' }, { startMonth: 'asc' }, { startDay: 'asc' }],
    });
    return records.map(mapCampaign);
  }

  async create(input: CreateSeasonalCampaignInput): Promise<SeasonalCampaign> {
    const record = await prisma.seasonalCampaign.create({
      data: {
        key: input.key,
        ribbon: input.ribbon,
        eyebrow: input.eyebrow,
        emoji: input.emoji,
        accent: input.accent,
        accentText: input.accentText,
        startMonth: input.startMonth,
        startDay: input.startDay,
        endMonth: input.endMonth,
        endDay: input.endDay,
        year: input.year ?? null,
        priority: input.priority,
        isActive: input.isActive,
      },
    });
    return mapCampaign(record);
  }

  async update(id: string, input: UpdateSeasonalCampaignInput): Promise<SeasonalCampaign> {
    const data: Prisma.SeasonalCampaignUpdateInput = {};

    if (input.key !== undefined) data.key = input.key;
    if (input.ribbon !== undefined) data.ribbon = input.ribbon;
    if (input.eyebrow !== undefined) data.eyebrow = input.eyebrow;
    if (input.emoji !== undefined) data.emoji = input.emoji;
    if (input.accent !== undefined) data.accent = input.accent;
    if (input.accentText !== undefined) data.accentText = input.accentText;
    if (input.startMonth !== undefined) data.startMonth = input.startMonth;
    if (input.startDay !== undefined) data.startDay = input.startDay;
    if (input.endMonth !== undefined) data.endMonth = input.endMonth;
    if (input.endDay !== undefined) data.endDay = input.endDay;
    if (input.year !== undefined) data.year = input.year;
    if (input.priority !== undefined) data.priority = input.priority;
    if (input.isActive !== undefined) data.isActive = input.isActive;

    const record = await prisma.seasonalCampaign.update({ where: { id }, data });
    return mapCampaign(record);
  }

  async delete(id: string): Promise<void> {
    await prisma.seasonalCampaign.delete({ where: { id } });
  }
}
