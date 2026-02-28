import { describe, expect, it, vi, beforeEach } from 'vitest';

const { createSecondaryPoolMock, mockPool, rotateMock, closeMock, getConnMock } = vi.hoisted(() => {
  const rotate = vi.fn().mockResolvedValue(undefined);
  const close = vi.fn().mockResolvedValue(undefined);
  const getCurrentConnectionString = vi
    .fn()
    .mockReturnValue('postgresql://user:pass@localhost:5432/testdb');
  const pool = { query: vi.fn() };
  const createSecondaryPool = vi.fn().mockReturnValue({
    pool,
    rotate,
    close,
    getCurrentConnectionString,
  });

  return {
    createSecondaryPoolMock: createSecondaryPool,
    mockPool: pool,
    rotateMock: rotate,
    closeMock: close,
    getConnMock: getCurrentConnectionString,
  };
});

vi.mock('@app/database', () => {
  return {
    createSecondaryPool: createSecondaryPoolMock,
  };
});

import { getDbPool, rotatePimPool, getCurrentPimConnectionString, closePimPool } from '../db.js';

describe('PIM pool rotation', () => {
  beforeEach(() => {
    vi.stubEnv('DATABASE_URL', 'postgresql://user:pass@localhost:5432/testdb');
    createSecondaryPoolMock.mockClear();
    rotateMock.mockClear();
    closeMock.mockClear();
    getConnMock.mockClear();
  });

  it('getDbPool returns a proxy (same reference on repeated calls)', () => {
    const pool1 = getDbPool();
    const pool2 = getDbPool();
    expect(pool1).toBe(pool2);
    expect(pool1).toBe(mockPool);
    expect(createSecondaryPoolMock).toHaveBeenCalledTimes(1);
  });

  it('getCurrentPimConnectionString returns the initial URL after getDbPool', () => {
    getDbPool();
    expect(getCurrentPimConnectionString()).toBe('postgresql://user:pass@localhost:5432/testdb');
    expect(getConnMock).toHaveBeenCalledTimes(1);
  });

  it('rotatePimPool swaps the connection string', async () => {
    getDbPool();
    const newUrl = 'postgresql://newuser:newpass@localhost:5432/testdb';
    await rotatePimPool(newUrl);
    expect(rotateMock).toHaveBeenCalledWith(newUrl);
  });

  it('closePimPool ends the pool', async () => {
    getDbPool();
    await expect(closePimPool()).resolves.toBeUndefined();
    expect(closeMock).toHaveBeenCalledTimes(1);
  });
});
