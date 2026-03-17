# Backend SMS Tracking System

## Overview

SMS status tracking is handled entirely on the backend. The frontend uses fire-and-forget requests to keep the UI responsive while the backend manages all status updates.

## Architecture

```
┌─────────────────┐     fire-and-forget      ┌──────────────────────┐
│    Frontend     │ ───────────────────────► │      Backend         │
│  (non-blocking) │                          │                      │
└─────────────────┘                          │  1. Save job         │
                                             │  2. Send to EZ Text  │
                                             │  3. Update winner    │
                                             └──────────┬───────────┘
                                                        │
                                             ┌──────────▼───────────┐
                                             │   Texting Scheduler  │
                                             │   (every 2 minutes)  │
                                             │                      │
                                             │  - Check pending     │
                                             │  - Update statuses   │
                                             │  - Exponential back  │
                                             └──────────────────────┘
```

## Data Storage

### Job Storage: `data/texting-jobs.json`

```typescript
interface TextingJob {
  jobId: string;           // Unique job identifier
  winnerId: string;        // Links to winner record
  messageId: string | null; // From EZ Texting response
  phoneNumber: string;
  message: string;
  status: 'pending' | 'sending' | 'queued' | 'sent' | 'delivered' | 'bounced' | 'failed' | 'unknown';
  createdAt: number;
  sentAt: number | null;
  lastCheckedAt: number | null;
  retryCount: number;
  nextCheckAt: number | null;  // When to check status next
  error: string | null;
}
```

### Winner SMS Data: `data/winners.json`

Each winner's `sms` field is updated automatically:

```typescript
winner.sms = {
  status: string;          // Current status
  messageId: string;       // EZ Texting message ID
  sentAt: number;          // Timestamp when sent
  lastChecked: number;     // Last status check timestamp
  error: string | null;    // Error message if failed
  message: string;         // The SMS content
  phoneNumber: string;     // Recipient phone
  deliveredAt?: number;    // If delivered
  bouncedAt?: number;      // If bounced
  failedAt?: number;       // If failed
}
```

## Backend Files

| File | Purpose |
|------|---------|
| `backend/services/texting.ts` | Core SMS functions + job tracking |
| `backend/services/texting-scheduler.ts` | Cron job (every 2 min) |
| `backend/routes/texting.ts` | API endpoints |

## API Actions

| Action | Description |
|--------|-------------|
| `queueAndSend` | Queue and send SMS, returns job immediately |
| `getJobs` | Get all jobs from storage |
| `processQueue` | Manually trigger pending job processing |
| `getJobStats` | Get job statistics by status |
| `sendMessage` | Direct send (legacy, no tracking) |
| `getMessageReport` | Check single message status |

## Scheduler Behavior

- **Interval**: Every 2 minutes
- **Startup**: Processes pending jobs 5 seconds after server start
- **Rate Limit**: 100ms delay between status checks

### Exponential Backoff

```
Retry 1:  1 minute
Retry 2:  2 minutes
Retry 3:  4 minutes
Retry 4:  8 minutes
Retry 5:  16 minutes
Retry 6+: 30 minutes (max)
```

After 10 retries → status = `unknown`

## Frontend Usage

### Send SMS (fire-and-forget)

```javascript
// Non-blocking - UI stays responsive
this.makeRequestFireAndForget({
  action: 'queueAndSend',
  data: {
    winnerId: recipient.winnerId,
    phoneNumber: recipient.phone,
    message: personalizedMessage
  }
});
```

### Manually Process Queue

```javascript
await Texting.checkAllPendingStatuses()
```

### Get Job Statistics

```javascript
const stats = await Texting.getJobStats()
// Returns: { total, pending, queued, delivered, failed, unknown }
```

### Refresh Winner Status in UI

```javascript
// Backend updates winners.json automatically
// Just reload from database to see updated status
const winners = await Database.getFromStore('winners')
```

## Status Flow

```
sending → queued → delivered
                 → bounced
                 → failed
                 → sent (if no delivery data)
                 → unknown (after 10 retries)
```

## EZ Texting API Reference

### Send Response
```json
{ "id": "272199890003" }
```

### Message Report Response
```json
{
  "delivery": {
    "total_delivered": { "data": 1, "percentage": 100 },
    "bounced": { "data": 0, "percentage": 0 },
    "queued": { "data": 0, "percentage": 0 },
    "total_not_sent": { "data": 0, "percentage": 0 }
  },
  "engagement": {
    "opted_out": { "data": 0 },
    "replied": { "data": 0 }
  }
}
```

## Console Commands (Debug)

```javascript
// Get statistics
await Texting.getJobStats()

// Force process pending jobs
await Texting.checkAllPendingStatuses()

// Mark old stuck messages as sent
await Texting.markUntrackableAsSent()
```
