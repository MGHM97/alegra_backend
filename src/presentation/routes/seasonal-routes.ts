import type { FastifyInstance } from 'fastify';
import { getActiveCampaignHandler } from '../controllers/seasonal-campaign-controller.js';

export async function seasonalRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/active', {
    handler: getActiveCampaignHandler,
  });
}
