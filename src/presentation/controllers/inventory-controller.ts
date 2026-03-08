import type { FastifyReply, FastifyRequest } from 'fastify';
import { InventoryService } from '../../application/services/inventory-service.js';
import type { InventorySyncInput } from '../schemas/inventory-schemas.js';
import { successResponse } from '../../shared/utils/response.js';

const inventoryService = new InventoryService();

export async function fetchStockHandler(
  request: FastifyRequest<{ Params: { productId: string } }>,
  reply: FastifyReply,
): Promise<void> {
  const stock = await inventoryService.fetchStock(request.params.productId);
  void reply.status(200).send(successResponse(stock));
}

export async function syncInventoryHandler(
  request: FastifyRequest<{ Body: InventorySyncInput }>,
  reply: FastifyReply,
): Promise<void> {
  const result = await inventoryService.syncInventory(request.body);
  void reply.status(200).send(successResponse(result));
}
