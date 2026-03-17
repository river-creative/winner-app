import express from 'express';
import type { Request, Response } from 'express';

import {
  sendMessage,
  getMessageReport,
  queueAndSend,
  readJobs,
  processQueue,
  getJobStats
} from '../services/texting.js';
import { strictLimiter } from '../middleware.js';

export const textingRouter = express.Router();

// Texting API endpoint
textingRouter.post('/texting', strictLimiter, async (req: Request, res: Response) => {
  if (process.env.NODE_ENV !== 'production') {
    console.log('Texting endpoint called:', req.body.action);
  }
  try {
    const { action, data } = req.body;

    let result: any;

    switch (action) {
      case 'sendMessage':
        result = await sendMessage(data);
        break;

      case 'getMessageReport':
        result = await getMessageReport(data);
        break;

      // New: Queue and send with server-side tracking
      case 'queueAndSend':
        if (!data.winnerId || !data.phoneNumber || !data.message) {
          throw new Error('winnerId, phoneNumber, and message are required');
        }
        result = await queueAndSend(data.winnerId, data.phoneNumber, data.message);
        break;

      // New: Get all jobs
      case 'getJobs':
        result = await readJobs();
        break;

      // New: Process pending jobs manually
      case 'processQueue':
        const processed = await processQueue();
        result = { processed };
        break;

      // New: Get job statistics
      case 'getJobStats':
        result = await getJobStats();
        break;

      default:
        throw new Error(`Unknown action: ${action}`);
    }

    res.json(result);

  } catch (error: any) {
    console.error('Texting error:', error.message);
    res.status(500).json({
      success: false,
      error: error.message || 'An unexpected error occurred'
    });
  }
});
