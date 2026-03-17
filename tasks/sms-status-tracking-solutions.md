# SMS Status Tracking: Backend Solutions

## Problem Statement

Text messages get stuck in "queued" status because:
1. Frontend `setTimeout` polling is lost on page close/refresh
2. No persistent retry mechanism exists
3. No webhook endpoint to receive push notifications from EZ Texting
4. No maximum retry limit or timeout to transition stale messages

---

## Proposed Solutions

### Option A: Webhook-Based (Recommended if EZ Texting supports it)

**How it works**: EZ Texting pushes delivery status updates to your server in real-time.

**Pros**:
- Real-time updates (no polling delay)
- No API rate limit concerns
- Most reliable and efficient

**Cons**:
- Requires EZ Texting webhook support (needs verification with their support)
- Requires publicly accessible endpoint

**Implementation**:
```
POST /api/webhooks/eztexting
- Receives delivery status callbacks
- Updates winner.sms.status based on event type
- HMAC signature validation for security
```

---

### Option B: Backend Scheduler with Polling (Recommended)

**How it works**: A `node-cron` job runs every N minutes to check all pending messages.

**Pros**:
- Works with existing EZ Texting API
- Doesn't require external dependencies beyond node-cron
- Persistent across server restarts

**Cons**:
- Not real-time (delayed by polling interval)
- API rate limit considerations

**Implementation Components**:

1. **Scheduler Service** (`backend/services/sms-scheduler.ts`)
   - Runs every 2 minutes
   - Queries winners with `sms.status` in ['queued', 'sending', 'pending']
   - Applies exponential backoff based on `sms.retryCount`
   - Transitions to 'failed' after max retries or timeout

2. **Status Transition Rules**:
   ```
   queued (< 1 hour, < 10 retries) → check again
   queued (> 1 hour OR >= 10 retries) → unknown
   sending (> 5 minutes) → check status
   pending (> 5 minutes) → check status
   ```

3. **Backoff Strategy**:
   ```
   Retry 1: wait 1 min
   Retry 2: wait 2 min
   Retry 3: wait 4 min
   Retry 4: wait 8 min
   ... exponential up to 30 min max
   ```

---

### Option C: Hybrid (Webhook + Polling Fallback)

Combine both approaches:
- Primary: Webhook receives real-time updates
- Fallback: Scheduler catches any missed updates

This provides maximum reliability.

---

## Recommended Implementation: Option B (Backend Scheduler)

### New Files to Create

#### 1. `backend/services/sms-scheduler.ts`
```typescript
// Core scheduler service
- startSmsScheduler(): Initialize cron job
- stopSmsScheduler(): Graceful shutdown
- checkPendingMessages(): Main job logic
- processMessage(): Check single message status
- shouldRetry(): Determine if message should be retried
- calculateNextCheck(): Exponential backoff calculation
```

#### 2. `backend/services/sms-status.ts`
```typescript
// Status management utilities
- getPendingMessages(): Query winners with pending SMS
- updateMessageStatus(): Update winner.sms with new status
- transitionStaleMessages(): Mark old queued messages as unknown
- getRetryDelay(): Calculate backoff delay
```

### Changes to Existing Files

#### `backend/server.ts`
```typescript
import { startSmsScheduler } from './services/sms-scheduler.js';

async function startServer(): Promise<void> {
  await ensureDataDir();
  startSmsScheduler(); // Add this line
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}
```

#### `backend/services/texting.ts`
Add batch status check function:
```typescript
export async function checkMultipleMessageStatuses(
  messageIds: string[]
): Promise<Map<string, TextingResult>>
```

### Winner SMS Data Structure Enhancement

Current:
```typescript
sms: {
  status: string;
  messageId?: string;
  sentAt?: number;
  // ...
}
```

Enhanced:
```typescript
sms: {
  status: string;
  messageId?: string;
  sentAt?: number;
  retryCount: number;        // NEW: Track retry attempts
  nextCheckAt?: number;      // NEW: Scheduled next check time
  lastCheckedAt?: number;    // NEW: Last status check timestamp
  staleSince?: number;       // NEW: When message became stale
  // ...
}
```

---

## Configuration

Add to `.env`:
```env
# SMS Scheduler Configuration
SMS_SCHEDULER_ENABLED=true
SMS_SCHEDULER_INTERVAL_MINUTES=2
SMS_MAX_RETRIES=10
SMS_STALE_TIMEOUT_HOURS=1
SMS_MAX_BACKOFF_MINUTES=30
```

---

## API Endpoints (Optional)

### Manual Status Check
```
POST /api/sms/check-pending
- Triggers immediate check of all pending messages
- Useful for admin/debugging
```

### Scheduler Status
```
GET /api/sms/scheduler-status
- Returns scheduler state, last run time, pending count
```

---

## Monitoring & Logging

The scheduler should log:
- Job start/end times
- Number of messages checked
- Status transitions (queued → delivered, queued → failed, etc.)
- API errors and retry decisions
- Rate limit warnings

---

## Dependencies

```json
{
  "node-cron": "^3.0.3"
}
```

No Redis, no database changes required - works with existing JSON file storage.

---

## Timeline Considerations

- Option B can be implemented incrementally
- Start with scheduler + basic polling
- Add exponential backoff
- Add stale message handling
- Optionally add webhook endpoint later

---

## Decision Required

Which option would you like to implement?
- [ ] Option A: Webhook-only (requires EZ Texting verification)
- [ ] Option B: Backend Scheduler (recommended, works now)
- [ ] Option C: Hybrid approach
