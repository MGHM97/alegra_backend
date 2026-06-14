import type { FastifyReply, FastifyRequest } from 'fastify';
import { PrismaSeasonalCampaignRepository } from '../../infra/database/prisma-seasonal-campaign-repository.js';
import { resolveActiveCampaign } from '../../application/services/seasonal-campaign-service.js';
import { successResponse } from '../../shared/utils/response.js';
import { cacheGet, cacheSet, cacheInvalidatePattern } from '../../infra/cache/cache-utils.js';
import type { SeasonalCampaign, SeasonalCampaignPublic } from '../../domain/entities/seasonal-campaign.js';

const repository = new PrismaSeasonalCampaignRepository();

// Chave Redis para cache do resultado público.
// TTL curto (5 min) — aceitável para campanhas sazonais que não mudam com frequência.
const CACHE_KEY_ACTIVE = 'seasonal:active';
const CACHE_TTL_SECONDS = 300;

function serializePublic(campaign: SeasonalCampaign): SeasonalCampaignPublic {
  return {
    id: campaign.id,
    key: campaign.key,
    ribbon: campaign.ribbon,
    eyebrow: campaign.eyebrow,
    emoji: campaign.emoji,
    accent: campaign.accent,
    accentText: campaign.accentText,
  };
}

/**
 * GET /v1/seasonal/active
 * Resolve no servidor a campanha vigente para "hoje" (data do servidor).
 * Resposta cacheada no Redis por CACHE_TTL_SECONDS.
 */
export async function getActiveCampaignHandler(
  _request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const cached = await cacheGet<SeasonalCampaignPublic | null>(CACHE_KEY_ACTIVE);
  if (cached !== null) {
    void reply.status(200).send(successResponse(cached));
    return;
  }

  const activeCampaigns = await repository.findAllActive();
  const resolved = resolveActiveCampaign(activeCampaigns, new Date());
  const result = resolved ? serializePublic(resolved) : null;

  await cacheSet(CACHE_KEY_ACTIVE, result, CACHE_TTL_SECONDS);

  void reply.status(200).send(successResponse(result));
}

/**
 * Invalida o cache do endpoint público após qualquer mutação admin.
 */
async function invalidateActiveCache(): Promise<void> {
  await cacheInvalidatePattern('seasonal:active');
}

export { invalidateActiveCache };
