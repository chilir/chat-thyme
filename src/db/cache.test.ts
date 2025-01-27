// src/db/cache.test.ts

import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import tmp from "tmp";
import type { ChatThymeConfig } from "../config/schema";
import type { DbCacheEntry, dbCache } from "../interfaces";
import {
  backgroundEvictExpiredDbs,
  clearUserDbCache,
  initUserDbCache,
} from "./cache";

const tmpDir = tmp.dirSync({
  prefix: "chat-thyme-test-",
  unsafeCleanup: true,
});

const testConfig: ChatThymeConfig = {
  discordBotToken: "test-token",
  apiKey: "ollama",
  model: "test-model",
  serverUrl: "http://localhost:11434",
  systemPrompt: "test prompt",
  dbDir: tmpDir.name,
  dbConnectionCacheSize: 2,
  dbConnectionCacheTtl: 100, // 100ms for faster testing
  dbConnectionCacheCheckInterval: 50, // 50ms for faster testing
  discordSlowModeInterval: 10,
};

describe("In-Memory Database Cache", () => {
  let userDbCache: dbCache;

  beforeEach(() => {
    userDbCache = initUserDbCache();
  });

  afterEach(async () => {
    await clearUserDbCache(userDbCache);
  });

  it("should create empty cache with mutex", () => {
    const initTestCache = initUserDbCache();
    expect(initTestCache.cache.size).toBe(0);
    expect(initTestCache.mutex).toBeDefined();
    expect(initTestCache.checkIntervalId).toBeUndefined();
  });

  describe("TTL and Expiration Policies", () => {
    it("should evict expired entries", async () => {
      // Create a mock database entry
      const mockDb = new Database(":memory:");
      const userId = "test-user";
      const cacheEntry: DbCacheEntry = {
        filePath: "test-path",
        db: mockDb,
        lastAccessed: Date.now(),
        refCount: 0,
      };

      userDbCache.cache.set(userId, cacheEntry);
      expect(userDbCache.cache.size).toBe(1);

      // Start background eviction
      backgroundEvictExpiredDbs(testConfig, userDbCache);
      expect(userDbCache.checkIntervalId).toBeDefined();

      // Wait for TTL to expire
      await new Promise((resolve) => setTimeout(resolve, 150));

      expect(userDbCache.cache.size).toBe(0);
    });

    it("should not evict entries with active references", async () => {
      const mockDb = new Database(":memory:");
      const userId = "test-user";
      const cacheEntry: DbCacheEntry = {
        filePath: "test-path",
        db: mockDb,
        lastAccessed: Date.now(),
        refCount: 1, // Active reference
      };

      userDbCache.cache.set(userId, cacheEntry);
      backgroundEvictExpiredDbs(testConfig, userDbCache);

      // Wait for TTL to expire
      await new Promise((resolve) => setTimeout(resolve, 150));

      expect(userDbCache.cache.size).toBe(1);
    });
  });

  it("should clear all cache entries and stop maintenance", async () => {
    // Add some test entries
    const mockDb1 = new Database(":memory:");
    const mockDb2 = new Database(":memory:");

    userDbCache.cache.set("user1", {
      filePath: "test-path-1",
      db: mockDb1,
      lastAccessed: Date.now(),
      refCount: 0,
    });

    userDbCache.cache.set("user2", {
      filePath: "test-path-2",
      db: mockDb2,
      lastAccessed: Date.now(),
      refCount: 1,
    });

    // Start maintenance
    backgroundEvictExpiredDbs(testConfig, userDbCache);
    expect(userDbCache.checkIntervalId).toBeDefined();

    // Clear cache
    await clearUserDbCache(userDbCache);

    expect(userDbCache.cache.size).toBe(0);
    expect(userDbCache.checkIntervalId).toBeUndefined();
  });

  describe("Background Maintenance Behavior", () => {
    it("should handle rapid maintenance cycles", async () => {
      const quickConfig = { ...testConfig, dbConnectionCacheCheckInterval: 10 };
      const mockDb = new Database(":memory:");
      userDbCache.cache.set("test-user", {
        filePath: "test-path",
        db: mockDb,
        lastAccessed: Date.now(),
        refCount: 0,
      });

      backgroundEvictExpiredDbs(quickConfig, userDbCache);
      backgroundEvictExpiredDbs(quickConfig, userDbCache); // Second call should not create new interval

      const intervalId = userDbCache.checkIntervalId;
      expect(intervalId).toBeDefined();

      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(userDbCache.checkIntervalId).toBeDefined();
      expect(userDbCache.checkIntervalId).toBe(intervalId as Timer); // Should maintain same interval, safe to compare since we checked both are defined
    });

    it("should handle future lastAccessed timestamps", async () => {
      const mockDb = new Database(":memory:");
      const futureTime = Date.now() + 1000000; // Future timestamp

      userDbCache.cache.set("future-user", {
        filePath: "test-path",
        db: mockDb,
        lastAccessed: futureTime,
        refCount: 0,
      });

      backgroundEvictExpiredDbs(testConfig, userDbCache);
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Entry should still be in cache since its lastAccessed is in the future
      expect(userDbCache.cache.size).toBe(1);
      expect(userDbCache.cache.has("future-user")).toBe(true);
    });
  });

  describe("Concurrent Cache Access Patterns", () => {
    it("should handle concurrent maintenance and cleanup", async () => {
      const promises = [];
      const mockDbs = Array(5)
        .fill(null)
        .map(() => new Database(":memory:"));

      // Setup initial cache entries
      mockDbs.forEach((db, i) => {
        userDbCache.cache.set(`user${i}`, {
          filePath: `test-path-${i}`,
          db,
          lastAccessed: Date.now(),
          refCount: 0,
        });
      });

      // Start maintenance
      backgroundEvictExpiredDbs(testConfig, userDbCache);

      // Concurrent operations
      promises.push(clearUserDbCache(userDbCache));
      promises.push(clearUserDbCache(userDbCache));

      await Promise.all(promises);
      expect(userDbCache.cache.size).toBe(0);
      expect(userDbCache.checkIntervalId).toBeUndefined();
    });

    it("should prevent memory leaks during rapid cache operations", async () => {
      const operations = 100;
      const mockDb = new Database(":memory:");

      // Rapid add/remove operations
      for (let i = 0; i < operations; i++) {
        userDbCache.cache.set(`user${i}`, {
          filePath: `test-path-${i}`,
          db: mockDb,
          lastAccessed: Date.now(),
          refCount: 0,
        });

        if (i % 2 === 0) {
          await clearUserDbCache(userDbCache);
        }
      }

      const finalMemoryUsage = process.memoryUsage().heapUsed;
      expect(finalMemoryUsage).toBeLessThan(1024 * 1024 * 100); // Less than 100MB
    });
  });

  it("should handle large number of entries efficiently", async () => {
    const entriesCount = 1000;

    // Add many entries
    for (let i = 0; i < entriesCount; i++) {
      userDbCache.cache.set(`user${i}`, {
        filePath: `test-path-${i}`,
        db: new Database(":memory:"),
        lastAccessed: Date.now(),
        refCount: 0,
      });
    }

    backgroundEvictExpiredDbs(testConfig, userDbCache);
    await clearUserDbCache(userDbCache);
  }, 1000);
});
