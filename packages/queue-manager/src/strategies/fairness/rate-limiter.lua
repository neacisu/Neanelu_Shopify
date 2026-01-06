-- Atomic token bucket rate limiter (per shop).
--
-- KEYS[1] = bucketKey
--
-- ARGV[1] = nowMs
-- ARGV[2] = costToConsume
-- ARGV[3] = maxTokens
-- ARGV[4] = refillPerSecond
-- ARGV[5] = ttlMs (optional)
--
-- Returns array:
-- [1] allowed (0/1)
-- [2] delayMs
-- [3] tokensRemaining (after possible consumption)
-- [4] tokensNow (before consumption, after refill)

local bucketKey = KEYS[1]

local nowMs = tonumber(ARGV[1])
local cost = tonumber(ARGV[2])
local maxTokens = tonumber(ARGV[3])
local refillPerSecond = tonumber(ARGV[4])
local ttlMs = tonumber(ARGV[5])

if not nowMs then
  return {0, 60000, 0, 0}
end

if not cost or cost < 0 then
  cost = 0
end

if not maxTokens or maxTokens <= 0 then
  maxTokens = cost
end

if not refillPerSecond or refillPerSecond < 0 then
  refillPerSecond = 0
end

local lastMs = tonumber(redis.call('HGET', bucketKey, 'ts'))
local tokens = tonumber(redis.call('HGET', bucketKey, 'tokens'))

if not lastMs then
  lastMs = nowMs
end

if not tokens then
  tokens = maxTokens
end

-- Refill based on elapsed time
local deltaMs = nowMs - lastMs
if deltaMs < 0 then
  deltaMs = 0
end

local refill = (deltaMs / 1000.0) * refillPerSecond
if refill > 0 then
  tokens = tokens + refill
end

if tokens > maxTokens then
  tokens = maxTokens
end

local tokensNow = tokens
local allowed = 0
local delayMs = 0

if tokens >= cost then
  allowed = 1
  tokens = tokens - cost
else
  allowed = 0
  if refillPerSecond <= 0 then
    delayMs = 60000
  else
    local deficit = cost - tokens
    delayMs = math.ceil((deficit / refillPerSecond) * 1000)
  end
end

redis.call('HSET', bucketKey, 'ts', nowMs, 'tokens', tokens)

if ttlMs and ttlMs > 0 then
  redis.call('PEXPIRE', bucketKey, ttlMs)
end

return {allowed, delayMs, tokens, tokensNow}
