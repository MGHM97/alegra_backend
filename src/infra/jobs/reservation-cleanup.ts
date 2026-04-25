import cron, { type ScheduledTask } from 'node-cron';
import { InventoryService } from '../../application/services/inventory-service.js';
import { prisma } from '../database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';

const inventoryService = new InventoryService();

let task: ScheduledTask | null = null;

export function startReservationCleanupJob(): void {
  task = cron.schedule('*/2 * * * *', async () => {
    try {
      const released = await inventoryService.releaseExpiredReservations();
      if (released > 0) {
        logger.info({ released }, 'Released expired reservation(s)');
      }
    } catch (error) {
      logger.error(error, 'Failed to release expired reservations');
    }

    try {
      const deleted = await prisma.idempotencyRecord.deleteMany({
        where: { expiresAt: { lt: new Date() } },
      });
      if (deleted.count > 0) {
        logger.info({ count: deleted.count }, 'Deleted expired idempotency record(s)');
      }
    } catch (error) {
      logger.error(error, 'Failed to delete expired idempotency records');
    }
  });

  logger.info('Cron job started (every 2 minutes)');
}

export function stopReservationCleanupJob(): void {
  if (task) {
    task.stop();
    task = null;
  }
}
