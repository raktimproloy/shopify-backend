# Fix Conflicting Recurring Jobs

## Problem
You currently have **two conflicting recurring inventory sync jobs**:
1. One running every 6 **hours** (`0 */6 * * *`)
2. One running every 6 **minutes** (`*/6 * * * *`)

This is causing conflicts and preventing proper inventory updates.

## Solution
Follow these steps to fix the issue:

### Step 1: Clear Existing Conflicting Jobs
```bash
DELETE http://localhost:3001/api/jobs/recurring-inventory-sync
```

This will remove ALL existing recurring inventory sync jobs.

### Step 2: Schedule New Job with 6-Minute Interval
```bash
POST http://localhost:3001/api/jobs/schedule-inventory-sync
```

**Body (optional):**
```json
{
  "cronExpression": "*/6 * * * *"
}
```

### Step 3: Verify the Fix
```bash
GET http://localhost:3001/api/jobs/recurring
```

You should now see **only one** recurring job with cron `*/6 * * * *` (every 6 minutes).

## Cron Expression Explanation

- **`0 */6 * * *`** = Every 6 **hours** (at minute 0 of hours 0, 6, 12, 18)
- **`*/6 * * * *`** = Every 6 **minutes** (at minutes 0, 6, 12, 18, 24, 30, 36, 42, 48, 54)

## Expected Behavior After Fix

1. **Every 6 minutes**: Your inventory will automatically sync between Shopify and local database
2. **No conflicts**: Only one recurring job will be running
3. **Proper logging**: You'll see clear logs when sync jobs start and complete
4. **Stock updates**: Changes in Shopify should reflect in your local DB within 6 minutes

## Monitor the Fix

Check your server logs for:
- `📅 Scheduled recurring inventory sync with pattern: */6 * * * *`
- `🔄 Job ID: [ID] - Will execute every 6 minutes`
- `🔄 Processing recurring inventory sync job [ID]`
- `✅ Recurring inventory sync job [ID] completed successfully`

## If You Still Have Issues

1. **Check Redis status**: `GET /api/jobs/status`
2. **View queue stats**: `GET /api/jobs/stats`
3. **Check recurring jobs**: `GET /api/jobs/recurring`
4. **Restart server**: Sometimes needed after clearing jobs

## Why This Happened

The issue occurred because:
1. Your `app.ts` was automatically scheduling a 6-hour job
2. You manually scheduled a 6-minute job via API
3. Both jobs were running simultaneously, causing conflicts

The fix ensures only one properly configured job runs at the desired interval.
