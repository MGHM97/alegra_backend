import type { FastifyInstance } from 'fastify';
import {
  listCampaignsHandler,
  createCampaignHandler,
  updateCampaignHandler,
  toggleCampaignStatusHandler,
  deleteCampaignHandler,
} from '../controllers/admin-seasonal-campaign-controller.js';
import {
  createSeasonalCampaignSchema,
  updateSeasonalCampaignSchema,
  toggleCampaignStatusSchema,
} from '../schemas/seasonal-campaign-schemas.js';
import { validateBody } from '../../shared/middlewares/validate.js';
import { authGuard, requireRole } from '../../shared/middlewares/auth-guard.js';

export async function adminSeasonalCampaignRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.addHook('preHandler', authGuard);
  fastify.addHook('preHandler', requireRole('ADMIN'));

  fastify.get('/', {
    handler: listCampaignsHandler,
  });

  fastify.post('/', {
    preHandler: [validateBody(createSeasonalCampaignSchema)],
    handler: createCampaignHandler,
  });

  fastify.put('/:id', {
    preHandler: [validateBody(updateSeasonalCampaignSchema)],
    handler: updateCampaignHandler,
  });

  fastify.patch('/:id/status', {
    preHandler: [validateBody(toggleCampaignStatusSchema)],
    handler: toggleCampaignStatusHandler,
  });

  fastify.delete('/:id', {
    handler: deleteCampaignHandler,
  });
}
