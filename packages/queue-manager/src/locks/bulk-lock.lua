-- Atomic bulk lock operations (per shop).
--
-- Key pattern MUST be aligned with BullMQ group id: bulk-lock:${shopId}
--
-- KEYS[1] = lockKey
--
-- ARGV[1] = op ('acquire' | 'renew' | 'release')
-- ARGV[2] = token
-- ARGV[3] = ttlMs (required for acquire/renew)
--
-- Returns 1 on success, 0 otherwise.

local lockKey = KEYS[1]
local op = ARGV[1]
local token = ARGV[2]
local ttlMs = tonumber(ARGV[3])

if not lockKey or lockKey == '' then
  return 0
end

if not op or op == '' then
  return 0
end

if not token or token == '' then
  return 0
end

if op == 'acquire' then
  if not ttlMs or ttlMs <= 0 then
    return 0
  end
  if redis.call('SET', lockKey, token, 'NX', 'PX', ttlMs) then
    return 1
  end
  return 0
end

if op == 'renew' then
  if not ttlMs or ttlMs <= 0 then
    return 0
  end
  local current = redis.call('GET', lockKey)
  if current == token then
    redis.call('PEXPIRE', lockKey, ttlMs)
    return 1
  end
  return 0
end

if op == 'release' then
  local current = redis.call('GET', lockKey)
  if current == token then
    redis.call('DEL', lockKey)
    return 1
  end
  return 0
end

return 0
