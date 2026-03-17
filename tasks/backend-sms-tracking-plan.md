# Backend SMS Tracking System

## Goal
Move SMS message tracking to the backend so client issues (browser close, network errors, page refresh) don't affect delivery status tracking.

## Architecture

```
┌─────────────┐     POST /api/sms/send      ┌─────────────────┐
│   Frontend  │ ──────────────────────────► │    Backend      │
│  (trigger)  │                             │                 │
└─────────────┘                             │  1. Send to EZ  │
       │                                    │  2. Store job   │
       │ GET /api/sms/status/:winnerId      │  3. Return ID   │
       │◄───────────────────────────────────│                 │
       │                                    └────────┬────────┘
       │                                             │
       │                                    ┌────────▼────────┐
       │                                    │   SMS Scheduler │
       │                                    │  (node-cron)    │
       │                                    │                 │
       │                                    │  - Check queued │
       │                                    │  - Update status│
       │                                    │  - Retry logic  │
       │                                    └─────────────────┘
```

## New Backend Components

### 1. SMS Job Storage (`data/sms-jobs.json`)
```typescript
interface SmsJob {
  jobId: string;
  winnerId: string;
  messageId: string | null;      // From EZ Texting
  phoneNumber: string;
  message: string;
  status: 'pending' | 'sending' | 'queued' | 'sent' | 'delivered' | 'bounced' | 'failed';
  createdAt: number;
  sentAt: number | null;
  lastCheckedAt: number | null;
  retryCount: number;
  nextCheckAt: number | null;
  error: string | null;
}
```

### 2. SMS Service (`backend/services/sms-service.ts`)
- `queueMessage(winnerId, phoneNumber, message)` - Create job, send to EZ Texting
- `checkJobStatus(jobId)` - Check status via EZ Texting API
- `processQueue()` - Check all pending jobs (called by scheduler)
- `getJobsByWinner(winnerId)` - Get job status for frontend

### 3. SMS Scheduler (`backend/services/sms-scheduler.ts`)
- Runs every 2 minutes via node-cron
- Processes jobs with status in ['queued', 'sending']
- Exponential backoff: 1m → 2m → 4m → 8m → 16m → 30m max
- Max retries: 10 (then mark as 'unknown')
- Stale timeout: 2 hours

### 4. SMS Routes (`backend/routes/sms.ts`)
- `POST /api/sms/send` - Queue message for sending
- `POST /api/sms/send-batch` - Queue multiple messages
- `GET /api/sms/status/:winnerId` - Get status for a winner
- `GET /api/sms/jobs` - List all jobs (admin)
- `POST /api/sms/retry/:jobId` - Manual retry

## Changes to Existing Code

### Frontend (`texting.js`)
- Remove fire-and-forget pattern
- Call `POST /api/sms/send` and let backend handle everything
- Poll or receive status updates from backend
- Remove status checking logic (backend handles it)

### Winner Records
- `winner.sms` still stores final status for display
- Backend updates winner records when status changes

## Implementation Order

1. [ ] Create `sms-jobs.json` collection
2. [ ] Create `backend/services/sms-service.ts`
3. [ ] Create `backend/services/sms-scheduler.ts`
4. [ ] Create `backend/routes/sms.ts`
5. [ ] Update `backend/routes/router.ts` to mount SMS routes
6. [ ] Update `backend/server.ts` to start scheduler
7. [ ] Simplify frontend `texting.js`
8. [ ] Add npm dependency: `node-cron`

## Retry Strategy

```
Attempt 1: Check immediately after send
Attempt 2: +1 minute
Attempt 3: +2 minutes
Attempt 4: +4 minutes
Attempt 5: +8 minutes
Attempt 6: +16 minutes
Attempt 7-10: +30 minutes each
After 10: Mark as 'unknown', stop retrying
```

## Error Handling

- EZ Texting API error → Store error, retry with backoff
- No messageId returned → Mark as 'failed', log error
- Status check fails → Increment retry, continue
- Max retries exceeded → Mark as 'unknown'
