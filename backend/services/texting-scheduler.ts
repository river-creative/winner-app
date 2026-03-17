import * as cron from 'node-cron';
import { processQueue, getJobStats } from './texting.js';

let schedulerTask: ReturnType<typeof cron.schedule> | null = null;

/**
 * Start the texting status scheduler
 * Runs every 2 minutes to check pending message statuses
 */
export function startTextingScheduler(): void {
  if (schedulerTask) {
    console.log('Texting scheduler already running');
    return;
  }

  // Run every 2 minutes
  schedulerTask = cron.schedule('*/2 * * * *', async () => {
    try {
      const processed = await processQueue();
      if (processed > 0) {
        console.log(`Texting scheduler: processed ${processed} jobs`);
      }
    } catch (error) {
      console.error('Texting scheduler error:', error);
    }
  });

  console.log('Texting scheduler started (every 2 minutes)');

  // Run immediately on startup to catch any pending jobs
  setTimeout(async () => {
    try {
      const stats = await getJobStats();
      console.log('Texting job stats on startup:', stats);
      if (stats.queued > 0 || stats.pending > 0) {
        await processQueue();
      }
    } catch (error) {
      console.error('Initial queue processing error:', error);
    }
  }, 5000); // Wait 5 seconds after startup
}

/**
 * Stop the scheduler
 */
export function stopTextingScheduler(): void {
  if (schedulerTask) {
    schedulerTask.stop();
    schedulerTask = null;
    console.log('Texting scheduler stopped');
  }
}

/**
 * Check if scheduler is running
 */
export function isSchedulerRunning(): boolean {
  return schedulerTask !== null;
}
