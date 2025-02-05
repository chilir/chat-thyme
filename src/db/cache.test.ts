// src/db/cache.test.ts

import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { DbCache } from "../interfaces";
import {
  backgroundEvictExpiredDbs,
  clearUserDbCache,
  initUserDbCache,
} from "./cache";

describe("In-Memory Database Cache", () => {
  let userDbCache: DbCache;
  let mockDb: Database;
  const testDbConnectionCacheTtl = 100;
  const testDbConnectionCacheEvictionInterval = 50;
  const testUserId = "test-user";
  const testFilePath = "test-path";

  beforeEach(() => {
    userDbCache = initUserDbCache();
    mockDb = new Database(":memory:");
  });

  afterEach(async () => {
    await clearUserDbCache(userDbCache);
  });

  it("should create empty cache with mutex", () => {
    expect(userDbCache.cache.size).toBe(0);
    expect(userDbCache.mutex).toBeDefined();
    expect(userDbCache.evictionInterval).toBeUndefined();
  });

  describe("TTL and Expiration Policies", () => {
    it("should evict expired entries", async () => {
      userDbCache.cache.set(testUserId, {
        filePath: testFilePath,
        db: mockDb,
        lastAccessed: Date.now(),
        refCount: 0,
      });
      expect(userDbCache.cache.size).toBe(1);

      backgroundEvictExpiredDbs(
        userDbCache,
        testDbConnectionCacheTtl,
        testDbConnectionCacheEvictionInterval,
      );
      expect(userDbCache.evictionInterval).toBeDefined();

      // wait for TTL
      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(userDbCache.cache.size).toBe(0);
    });

    it("should not evict entries with active references", async () => {
      userDbCache.cache.set(testUserId, {
        filePath: testFilePath,
        db: mockDb,
        lastAccessed: Date.now(),
        refCount: 1,
      });
      backgroundEvictExpiredDbs(
        userDbCache,
        testDbConnectionCacheTtl,
        testDbConnectionCacheEvictionInterval,
      );
      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(userDbCache.cache.size).toBe(1);
    });
  });

  it("should clear all cache entries and stop maintenance", async () => {
    userDbCache.cache.set(testUserId, {
      filePath: testFilePath,
      db: mockDb,
      lastAccessed: Date.now(),
      refCount: 0,
    });
    const mockDb2 = new Database(":memory:");
    userDbCache.cache.set(`${testUserId}-2`, {
      filePath: `${testFilePath}-2`,
      db: mockDb2,
      lastAccessed: Date.now(),
      refCount: 1,
    });
    backgroundEvictExpiredDbs(
      userDbCache,
      testDbConnectionCacheTtl,
      testDbConnectionCacheEvictionInterval,
    );
    await clearUserDbCache(userDbCache);
    expect(userDbCache.cache.size).toBe(0);
    expect(userDbCache.evictionInterval).toBeUndefined();
  });

  describe("Background Maintenance Behavior", () => {
    it("should handle rapid maintenance cycles", async () => {
      userDbCache.cache.set(testUserId, {
        filePath: testFilePath,
        db: mockDb,
        lastAccessed: Date.now(),
        refCount: 0,
      });

      backgroundEvictExpiredDbs(userDbCache, testDbConnectionCacheTtl, 10);
      const evictionInterval = userDbCache.evictionInterval;
      expect(evictionInterval).toBeDefined();

      // second call should not create new interval
      backgroundEvictExpiredDbs(userDbCache, testDbConnectionCacheTtl, 10);
      expect(userDbCache.evictionInterval).toBe(evictionInterval as Timer);
    });

    it("should handle future lastAccessed timestamps", async () => {
      const futureTime = Date.now() + 1000000; // Future timestamp
      const futureUserId = "future-user";

      userDbCache.cache.set(futureUserId, {
        filePath: testFilePath,
        db: mockDb,
        lastAccessed: futureTime,
        refCount: 0,
      });
      backgroundEvictExpiredDbs(
        userDbCache,
        testDbConnectionCacheTtl,
        testDbConnectionCacheEvictionInterval,
      );
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Entry should still be in cache since its lastAccessed is in the future
      expect(userDbCache.cache.size).toBe(1);
      expect(userDbCache.cache.has(futureUserId)).toBe(true);
    });
  });

  describe("Concurrent Cache Access Patterns", () => {
    it("should handle concurrent maintenance and cleanup", async () => {
      const promises = [];
      const mockDbs = Array(5)
        .fill(null)
        .map(() => new Database(":memory:"));
      mockDbs.forEach((db, i) => {
        userDbCache.cache.set(`${testUserId}-${i}`, {
          filePath: `${testFilePath}-${i}`,
          db,
          lastAccessed: Date.now(),
          refCount: 0,
        });
      });
      backgroundEvictExpiredDbs(
        userDbCache,
        testDbConnectionCacheTtl,
        testDbConnectionCacheEvictionInterval,
      );

      // concurrent operations to clear cache
      promises.push(clearUserDbCache(userDbCache));
      promises.push(clearUserDbCache(userDbCache));
      await Promise.all(promises);
      expect(userDbCache.cache.size).toBe(0);
      expect(userDbCache.evictionInterval).toBeUndefined();
    });

    it("should prevent memory leaks during rapid cache operations", async () => {
      const operations = 100;

      // Rapid add/remove operations
      for (let i = 0; i < operations; i++) {
        userDbCache.cache.set(`${testUserId}-${i}`, {
          filePath: `${testFilePath}-${i}`,
          db: mockDb,
          lastAccessed: Date.now(),
          refCount: 0,
        });

        if (i % 2 === 0) {
          await clearUserDbCache(userDbCache);
        }
      }

      const finalMemoryUsage = process.memoryUsage().heapUsed;
      expect(finalMemoryUsage).toBeLessThan(1024 * 1024 * 100); // <100MB
    });
  });

  it("should handle large number of entries efficiently", async () => {
    const entriesCount = 1000;

    // Add many entries
    for (let i = 0; i < entriesCount; i++) {
      userDbCache.cache.set(`${testUserId}-${i}`, {
        filePath: `${testFilePath}-${i}`,
        db: new Database(":memory:"),
        lastAccessed: Date.now(),
        refCount: 0,
      });
    }

    backgroundEvictExpiredDbs(
      userDbCache,
      testDbConnectionCacheTtl,
      testDbConnectionCacheEvictionInterval,
    );
    await clearUserDbCache(userDbCache);
  }, 1000);
});
