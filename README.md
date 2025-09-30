I've updated the edge function with a 429 rate limit cooldown mechanism. Here's what I added:

## Key Changes:

### 1. **Database Table Required**
You'll need to create a new table in Supabase:

```sql
CREATE TABLE gemini_rate_limit_cooldown (
  id BIGSERIAL PRIMARY KEY,
  cooldown_until TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add index for faster queries
CREATE INDEX idx_cooldown_until ON gemini_rate_limit_cooldown(cooldown_until DESC);
```

### 2. **Cooldown Detection in API Methods**
- Both `attemptQuadrateSearch` and `attemptGeneralSearch` now check for 429 status
- When detected, they throw a specific `RATE_LIMIT_429` error that propagates immediately

### 3. **Helper Functions**
- `isInCooldown()`: Checks if there's an active cooldown period
- `setCooldown()`: Records a new cooldown period (45 minutes from now)

### 4. **Main Handler Logic**
- **Before making API calls**: Checks if we're in cooldown. If yes, returns immediately with a 429 status
- **After catching 429 error**: Sets a new cooldown period in the database
- All cooldown actions are logged for monitoring

### 5. **Efficiency**
- Uses database queries with `LIMIT 1` for fast checks
- Adds an index on `cooldown_until` for optimal performance
- Only stores necessary data (cooldown timestamp)

The function now prevents any Gemini API calls for 45 minutes after receiving a 429 status, using your Supabase database to track the cooldown state across multiple function invocations.
