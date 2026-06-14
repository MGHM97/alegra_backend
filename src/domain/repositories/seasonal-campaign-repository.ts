import type { SeasonalCampaign } from '../entities/seasonal-campaign.js';

export interface CreateSeasonalCampaignInput {
  key: string;
  ribbon: string;
  eyebrow: string;
  emoji: string;
  accent: string;
  accentText: string;
  startMonth: number;
  startDay: number;
  endMonth: number;
  endDay: number;
  year?: number | null;
  priority: number;
  isActive: boolean;
}

export interface UpdateSeasonalCampaignInput {
  key?: string;
  ribbon?: string;
  eyebrow?: string;
  emoji?: string;
  accent?: string;
  accentText?: string;
  startMonth?: number;
  startDay?: number;
  endMonth?: number;
  endDay?: number;
  year?: number | null;
  priority?: number;
  isActive?: boolean;
}

export interface SeasonalCampaignRepository {
  findById(id: string): Promise<SeasonalCampaign | null>;
  findAllActive(): Promise<SeasonalCampaign[]>;
  listAll(): Promise<SeasonalCampaign[]>;
  create(input: CreateSeasonalCampaignInput): Promise<SeasonalCampaign>;
  update(id: string, input: UpdateSeasonalCampaignInput): Promise<SeasonalCampaign>;
  delete(id: string): Promise<void>;
}
