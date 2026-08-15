import cron, { type ScheduledTask } from 'node-cron';
import { ReviewReminderService } from '../../application/services/review-reminder-service.js';
import { logger } from '../../shared/utils/logger.js';

const reviewReminderService = new ReviewReminderService();

let task: ScheduledTask | null = null;

export function startReviewReminderJob(): void {
  task = cron.schedule('0 */6 * * *', async () => {
    try {
      const { sent, failed } = await reviewReminderService.run();
      if (sent > 0 || failed > 0) {
        logger.info({ sent, failed }, 'Review reminder job finished');
      }
    } catch (error) {
      logger.error(error, 'Failed to run review reminder job');
    }
  });

  logger.info('Review reminder cron job started (every 6 hours)');
}

export function stopReviewReminderJob(): void {
  if (task) {
    task.stop();
    task = null;
  }
}
