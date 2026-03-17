import { promises as fs } from 'fs';
import path from 'path';
import { DATA_DIR } from '../config.js';
import { readCollection, writeCollection } from './collection.js';

export interface TextingResult {
  success: boolean;
  statusCode: number;
  data: any;
  rawResponse: string;
}

// Job interface for tracking SMS status server-side
export interface TextingJob {
  jobId: string;
  winnerId: string;
  messageId: string | null;
  phoneNumber: string;
  message: string;
  status: 'pending' | 'sending' | 'queued' | 'sent' | 'delivered' | 'bounced' | 'failed' | 'unknown';
  createdAt: number;
  sentAt: number | null;
  lastCheckedAt: number | null;
  retryCount: number;
  nextCheckAt: number | null;
  error: string | null;
}

export interface SendMessageData {
  message: string;
  phoneNumbers: string[];
  options?: Record<string, any>;
}

export interface MessageReportData {
  messageId: string;
}

function getCredentials(): { username: string; password: string } {
  const username = process.env.EZ_TEXTING_USERNAME;
  const password = process.env.EZ_TEXTING_PASSWORD;

  if (!username || !password) {
    throw new Error('Texting credentials not configured');
  }

  return { username, password };
}

function createAuthHeader(username: string, password: string): string {
  return 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');
}

export async function sendMessage(data: SendMessageData): Promise<TextingResult> {
  const { username, password } = getCredentials();
  const authHeader = createAuthHeader(username, password);

  if (!data.message || !data.phoneNumbers) {
    throw new Error('Message and phoneNumbers are required');
  }

  const requestBody = {
    message: data.message,
    toNumbers: data.phoneNumbers,
    ...data.options
  };

  console.log(`Sending SMS to ${data.phoneNumbers.length} recipient(s)`);

  const response = await fetch('https://a.eztexting.com/v1/messages', {
    method: 'POST',
    headers: {
      'Authorization': authHeader,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(requestBody)
  });

  const responseText = await response.text();
  let responseData: any;
  try {
    responseData = JSON.parse(responseText);
  } catch {
    responseData = responseText;
  }

  if (response.ok) {
    console.log(`SMS sent successfully: ${responseData.id}`);
  } else {
    console.error(`SMS failed: ${response.status}`, responseData);
  }

  return {
    success: response.ok,
    statusCode: response.status,
    data: responseData,
    rawResponse: responseText
  };
}

export async function getMessageReport(data: MessageReportData): Promise<TextingResult> {
  const { username, password } = getCredentials();
  const authHeader = createAuthHeader(username, password);

  if (!data.messageId) {
    throw new Error('messageId is required');
  }

  const response = await fetch(`https://a.eztexting.com/v1/message-reports/${data.messageId}`, {
    method: 'GET',
    headers: {
      'Authorization': authHeader,
      'Content-Type': 'application/json'
    }
  });

  const responseText = await response.text();
  let responseData: any;
  try {
    responseData = JSON.parse(responseText);
  } catch {
    responseData = responseText;
  }

  return {
    success: response.ok,
    statusCode: response.status,
    data: responseData,
    rawResponse: responseText
  };
}

// ============ Job Tracking Functions ============

const JOBS_FILE = path.join(DATA_DIR, 'texting-jobs.json');

async function ensureJobsFile(): Promise<void> {
  try {
    await fs.access(JOBS_FILE);
  } catch {
    await fs.writeFile(JOBS_FILE, '[]', 'utf8');
  }
}

export async function readJobs(): Promise<TextingJob[]> {
  await ensureJobsFile();
  const data = await fs.readFile(JOBS_FILE, 'utf8');
  if (!data || data.trim() === '') return [];
  return JSON.parse(data);
}

async function writeJobs(jobs: TextingJob[]): Promise<void> {
  await fs.writeFile(JOBS_FILE, JSON.stringify(jobs, null, 2), 'utf8');
}

function generateJobId(): string {
  return `job_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

function calculateNextCheckTime(retryCount: number): number {
  const baseDelay = 60 * 1000; // 1 minute
  const maxDelay = 30 * 60 * 1000; // 30 minutes
  const delay = Math.min(baseDelay * Math.pow(2, retryCount), maxDelay);
  return Date.now() + delay;
}

async function updateWinnerSmsStatus(winnerId: string, job: TextingJob): Promise<void> {
  try {
    const winners = await readCollection('winners');
    const winner = winners.find((w: any) => w.winnerId === winnerId);
    if (!winner) return;

    winner.sms = {
      ...winner.sms,
      status: job.status,
      messageId: job.messageId,
      sentAt: job.sentAt,
      lastChecked: job.lastCheckedAt,
      error: job.error,
      message: job.message,
      phoneNumber: job.phoneNumber
    };

    if (job.status === 'delivered') winner.sms.deliveredAt = Date.now();
    else if (job.status === 'bounced') winner.sms.bouncedAt = Date.now();
    else if (job.status === 'failed') winner.sms.failedAt = Date.now();

    await writeCollection('winners', winners);
  } catch (error) {
    console.error(`Failed to update winner SMS status: ${error}`);
  }
}

export async function updateJob(job: TextingJob): Promise<void> {
  const jobs = await readJobs();
  const index = jobs.findIndex(j => j.jobId === job.jobId);
  if (index >= 0) jobs[index] = job;
  else jobs.push(job);
  await writeJobs(jobs);
}

/**
 * Queue and send a message - handles everything server-side
 */
export async function queueAndSend(
  winnerId: string,
  phoneNumber: string,
  message: string
): Promise<TextingJob> {
  const job: TextingJob = {
    jobId: generateJobId(),
    winnerId,
    messageId: null,
    phoneNumber,
    message,
    status: 'sending',
    createdAt: Date.now(),
    sentAt: null,
    lastCheckedAt: null,
    retryCount: 0,
    nextCheckAt: null,
    error: null
  };

  // Save job immediately
  await updateJob(job);

  try {
    const result = await sendMessage({ message, phoneNumbers: [phoneNumber] });
    const messageId = result.data?.id || null;

    if (!messageId) {
      throw new Error('No messageId returned from EZ Texting');
    }

    job.messageId = messageId;
    job.status = 'queued';
    job.sentAt = Date.now();
    job.nextCheckAt = Date.now() + 30000; // First check in 30 seconds

    console.log(`SMS queued: jobId=${job.jobId}, messageId=${messageId}`);
  } catch (error: any) {
    job.status = 'failed';
    job.error = error.message;
    job.sentAt = Date.now();
    console.error(`SMS send failed: ${job.jobId} - ${error.message}`);
  }

  await updateJob(job);
  await updateWinnerSmsStatus(winnerId, job);

  return job;
}

/**
 * Check status of a single job
 */
export async function checkJobStatus(job: TextingJob): Promise<TextingJob> {
  if (!job.messageId) return job;

  try {
    const result = await getMessageReport({ messageId: job.messageId });
    job.lastCheckedAt = Date.now();
    job.retryCount++;

    const delivery = result.data?.delivery;
    if (delivery) {
      if (delivery.total_delivered?.data > 0) {
        job.status = 'delivered';
        job.nextCheckAt = null;
      } else if (delivery.bounced?.data > 0) {
        job.status = 'bounced';
        job.error = 'Message bounced';
        job.nextCheckAt = null;
      } else if (delivery.total_not_sent?.data > 0) {
        job.status = 'failed';
        job.error = 'Message not sent';
        job.nextCheckAt = null;
      } else if (delivery.queued?.data > 0) {
        job.status = 'queued';
        job.nextCheckAt = job.retryCount < 10
          ? calculateNextCheckTime(job.retryCount)
          : null;
        if (job.retryCount >= 10) {
          job.status = 'unknown';
          job.error = 'Max retries exceeded';
        }
      } else {
        job.status = 'sent';
        job.nextCheckAt = null;
      }
    }

    console.log(`Job ${job.jobId} status: ${job.status}`);
  } catch (error: any) {
    console.error(`Status check failed for ${job.jobId}: ${error.message}`);
    job.retryCount++;
    job.lastCheckedAt = Date.now();
    job.nextCheckAt = job.retryCount < 10
      ? calculateNextCheckTime(job.retryCount)
      : null;
    if (job.retryCount >= 10) {
      job.status = 'unknown';
      job.error = 'Max retries after API errors';
    }
  }

  await updateJob(job);
  await updateWinnerSmsStatus(job.winnerId, job);
  return job;
}

/**
 * Get jobs ready for status checking
 */
export async function getJobsToCheck(): Promise<TextingJob[]> {
  const jobs = await readJobs();
  const now = Date.now();
  return jobs.filter(j =>
    j.messageId &&
    j.nextCheckAt &&
    j.nextCheckAt <= now &&
    ['queued', 'sending'].includes(j.status)
  );
}

/**
 * Process all pending jobs - called by scheduler
 */
export async function processQueue(): Promise<number> {
  const jobsToCheck = await getJobsToCheck();
  console.log(`Processing ${jobsToCheck.length} pending SMS jobs`);

  for (const job of jobsToCheck) {
    await checkJobStatus(job);
    await new Promise(r => setTimeout(r, 100)); // Rate limit
  }

  return jobsToCheck.length;
}

/**
 * Get job stats for monitoring
 */
export async function getJobStats(): Promise<Record<string, number>> {
  const jobs = await readJobs();
  return {
    total: jobs.length,
    pending: jobs.filter(j => ['pending', 'sending'].includes(j.status)).length,
    queued: jobs.filter(j => j.status === 'queued').length,
    delivered: jobs.filter(j => ['delivered', 'sent'].includes(j.status)).length,
    failed: jobs.filter(j => ['failed', 'bounced'].includes(j.status)).length,
    unknown: jobs.filter(j => j.status === 'unknown').length
  };
}
