export interface SeasonalCampaign {
  id: string;
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
  year: number | null;
  priority: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Projeção pública: exposta no endpoint GET /v1/seasonal/active.
 * Não contém dados operacionais (datas de vigência, prioridade, isActive).
 */
export interface SeasonalCampaignPublic {
  id: string;
  key: string;
  ribbon: string;
  eyebrow: string;
  emoji: string;
  accent: string;
  accentText: string;
}
