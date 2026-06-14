import type { SeasonalCampaign } from '../../domain/entities/seasonal-campaign.js';

/** Converte mês/dia em índice comparável (MMDD). */
function toMMDD(month: number, day: number): number {
  return month * 100 + day;
}

/**
 * Verifica se a campanha está dentro da janela de datas para `today`.
 * Suporta vigências que cruzam o fim do ano (ex.: 26/12 → 06/01).
 */
function isWithinDateWindow(campaign: SeasonalCampaign, today: Date): boolean {
  // Filtro de ano pontual (ex.: Copa 2026 — só vale em 2026).
  if (campaign.year !== null && today.getFullYear() !== campaign.year) {
    return false;
  }

  const cur = toMMDD(today.getMonth() + 1, today.getDate());
  const start = toMMDD(campaign.startMonth, campaign.startDay);
  const end = toMMDD(campaign.endMonth, campaign.endDay);

  // Vigência normal (não cruza o fim do ano).
  if (start <= end) {
    return cur >= start && cur <= end;
  }

  // Vigência que cruza o ano (ex.: 26/12 → 06/01).
  return cur >= start || cur <= end;
}

/**
 * Resolve a campanha vigente para a data informada.
 * Recebe apenas campanhas com `isActive=true` (filtro feito no repositório).
 * Em caso de sobreposição, vence a de maior `priority`.
 * Retorna `null` se nenhuma campanha estiver ativa na data.
 */
export function resolveActiveCampaign(
  campaigns: readonly SeasonalCampaign[],
  today: Date,
): SeasonalCampaign | null {
  const matching = campaigns.filter((c) => isWithinDateWindow(c, today));

  if (matching.length === 0) {
    return null;
  }

  return matching.reduce((best, c) => (c.priority > best.priority ? c : best));
}

/**
 * Gera um slug estável a partir de um texto livre.
 * Usado para derivar `key` automaticamente quando não fornecido pelo admin.
 * Ex.: "Especial de Natal" → "especial-de-natal"
 */
export function generateCampaignKey(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // remove diacríticos
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-{2,}/g, '-')
    .slice(0, 64);
}
