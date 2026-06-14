import type { FastifyReply, FastifyRequest } from 'fastify';
import { PrismaSeasonalCampaignRepository } from '../../infra/database/prisma-seasonal-campaign-repository.js';
import { generateCampaignKey } from '../../application/services/seasonal-campaign-service.js';
import { invalidateActiveCache } from './seasonal-campaign-controller.js';
import { successResponse } from '../../shared/utils/response.js';
import { ConflictError, NotFoundError } from '../../domain/errors/app-error.js';
import type {
  CreateSeasonalCampaignInput,
  UpdateSeasonalCampaignInput,
  ToggleCampaignStatusInput,
} from '../schemas/seasonal-campaign-schemas.js';
import type { SeasonalCampaign } from '../../domain/entities/seasonal-campaign.js';

const repository = new PrismaSeasonalCampaignRepository();

function serializeAdmin(campaign: SeasonalCampaign) {
  return {
    id: campaign.id,
    key: campaign.key,
    ribbon: campaign.ribbon,
    eyebrow: campaign.eyebrow,
    emoji: campaign.emoji,
    accent: campaign.accent,
    accentText: campaign.accentText,
    startMonth: campaign.startMonth,
    startDay: campaign.startDay,
    endMonth: campaign.endMonth,
    endDay: campaign.endDay,
    year: campaign.year,
    priority: campaign.priority,
    isActive: campaign.isActive,
    createdAt: campaign.createdAt.toISOString(),
    updatedAt: campaign.updatedAt.toISOString(),
  };
}

function isPrismaUniqueViolation(err: unknown): boolean {
  return (
    err !== null &&
    typeof err === 'object' &&
    'code' in err &&
    (err as { code: string }).code === 'P2002'
  );
}

/**
 * GET /v1/admin/seasonal-campaigns
 * Lista todas as campanhas, ordenadas por priority desc, startMonth/startDay asc.
 */
export async function listCampaignsHandler(
  _request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const campaigns = await repository.listAll();
  void reply.status(200).send(successResponse(campaigns.map(serializeAdmin)));
}

/**
 * POST /v1/admin/seasonal-campaigns
 * Cria uma nova campanha. Se `key` não for fornecida, gera via slug do `eyebrow`.
 */
export async function createCampaignHandler(
  request: FastifyRequest<{ Body: CreateSeasonalCampaignInput }>,
  reply: FastifyReply,
): Promise<void> {
  const body = request.body;

  const key = body.key ?? generateCampaignKey(body.eyebrow);

  try {
    const campaign = await repository.create({
      key,
      ribbon: body.ribbon,
      eyebrow: body.eyebrow,
      emoji: body.emoji,
      accent: body.accent,
      accentText: body.accentText,
      startMonth: body.startMonth,
      startDay: body.startDay,
      endMonth: body.endMonth,
      endDay: body.endDay,
      year: body.year ?? null,
      priority: body.priority,
      isActive: body.isActive,
    });

    await invalidateActiveCache();

    void reply.status(201).send(successResponse(serializeAdmin(campaign)));
  } catch (err) {
    if (isPrismaUniqueViolation(err)) {
      throw new ConflictError(`Já existe uma campanha com a chave "${key}".`);
    }
    throw err;
  }
}

/**
 * PUT /v1/admin/seasonal-campaigns/:id
 * Atualiza uma campanha existente. Todos os campos são opcionais.
 */
export async function updateCampaignHandler(
  request: FastifyRequest<{ Params: { id: string }; Body: UpdateSeasonalCampaignInput }>,
  reply: FastifyReply,
): Promise<void> {
  const existing = await repository.findById(request.params.id);
  if (!existing) {
    throw new NotFoundError('Campanha');
  }

  try {
    const campaign = await repository.update(request.params.id, {
      key: request.body.key,
      ribbon: request.body.ribbon,
      eyebrow: request.body.eyebrow,
      emoji: request.body.emoji,
      accent: request.body.accent,
      accentText: request.body.accentText,
      startMonth: request.body.startMonth,
      startDay: request.body.startDay,
      endMonth: request.body.endMonth,
      endDay: request.body.endDay,
      year: request.body.year,
      priority: request.body.priority,
      isActive: request.body.isActive,
    });

    await invalidateActiveCache();

    void reply.status(200).send(successResponse(serializeAdmin(campaign)));
  } catch (err) {
    if (isPrismaUniqueViolation(err)) {
      throw new ConflictError(
        `Já existe uma campanha com a chave "${request.body.key ?? existing.key}".`,
      );
    }
    throw err;
  }
}

/**
 * PATCH /v1/admin/seasonal-campaigns/:id/status
 * Ativa ou desativa uma campanha (toggle isActive).
 */
export async function toggleCampaignStatusHandler(
  request: FastifyRequest<{ Params: { id: string }; Body: ToggleCampaignStatusInput }>,
  reply: FastifyReply,
): Promise<void> {
  const existing = await repository.findById(request.params.id);
  if (!existing) {
    throw new NotFoundError('Campanha');
  }

  const campaign = await repository.update(request.params.id, {
    isActive: request.body.isActive,
  });

  await invalidateActiveCache();

  void reply.status(200).send(successResponse(serializeAdmin(campaign)));
}

/**
 * DELETE /v1/admin/seasonal-campaigns/:id
 * Remove permanentemente uma campanha.
 */
export async function deleteCampaignHandler(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
): Promise<void> {
  const existing = await repository.findById(request.params.id);
  if (!existing) {
    throw new NotFoundError('Campanha');
  }

  await repository.delete(request.params.id);
  await invalidateActiveCache();

  void reply.status(204).send();
}
