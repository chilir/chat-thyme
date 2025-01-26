import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Mutex } from "async-mutex";
import tmp from "tmp";
import type { ChatThymeConfig } from "../config/schema";
import type { dbCache } from "../interfaces";
import { clearUserDbCache, initUserDbCache } from "./cache";
import { getOrInitUserDb, releaseUserDb } from "./sqlite";

const tmpDir = tmp.dirSync({
  prefix: "chat-thyme-test-",
  unsafeCleanup: true,
});

const testConfig: ChatThymeConfig = {
  discordBotToken: "test-token",
  model: "test-model",
  serverUrl: "http://localhost:11434",
  systemPrompt: "test prompt",
  dbDir: tmpDir.name,
  dbConnectionCacheSize: 2,
  dbConnectionCacheTtl: 1000,
  dbConnectionCacheCheckInterval: 100,
  discordSlowModeInterval: 10,
};

describe("SQLite Database Operations", () => {
  let userDbCache: dbCache;

  beforeEach(() => {
    userDbCache = initUserDbCache();
  });

  afterEach(async () => {
    await clearUserDbCache(userDbCache);
  });

  describe("Basic Database Operations", () => {
    it("should initialize new database for user", async () => {
      const userId = "test-user-1";
      const db = await getOrInitUserDb(userId, testConfig, userDbCache);

      expect(db).toBeInstanceOf(Database);
      expect(userDbCache.cache.has(userId)).toBe(true);

      const cacheEntry = userDbCache.cache.get(userId);
      expect(cacheEntry?.refCount).toBe(1);

      // Verify schema creation
      const tables = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='chat_messages'",
        )
        .all();
      expect(tables.length).toBe(1);

      const indexes = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_chat_messages_chat_id_id'",
        )
        .all();
      expect(indexes.length).toBe(1);
    });

    it("should reuse cached database connection", async () => {
      const userId = "test-user-2";

      // First initialization
      const db1 = await getOrInitUserDb(userId, testConfig, userDbCache);

      // Second request for same user
      const db2 = await getOrInitUserDb(userId, testConfig, userDbCache);

      expect(db1).toBe(db2);
      expect(userDbCache.cache.get(userId)?.refCount).toBe(2);
    });

    it("should handle database connection cache size limit", async () => {
      const userId1 = "test-user-3";
      const userId2 = "test-user-4";
      const userId3 = "test-user-5";

      // Fill cache to limit
      await getOrInitUserDb(userId1, testConfig, userDbCache);
      await getOrInitUserDb(userId2, testConfig, userDbCache);

      // Release first connection
      await releaseUserDb(userId1, userDbCache);

      // Add another connection that should evict userId1
      await getOrInitUserDb(userId3, testConfig, userDbCache);

      expect(userDbCache.cache.has(userId1)).toBe(false);
      expect(userDbCache.cache.has(userId2)).toBe(true);
      expect(userDbCache.cache.has(userId3)).toBe(true);
      expect(userDbCache.cache.size).toBe(2);
    });
  });

  it("should handle database corruption", async () => {
    const userId = "test-corrupt-user";
    const db = await getOrInitUserDb(userId, testConfig, userDbCache);

    // Simulate corruption by executing invalid SQL
    expect(() => db.prepare("CORRUPTED SQL STATEMENT").run()).toThrow();

    // Database should still be usable
    const validQuery = db.prepare("SELECT 1").get();
    expect(validQuery).toBeDefined();
  });

  describe("Multi-threaded Access and Race Conditions", () => {
    it("should handle concurrent database access", async () => {
      const userId = "test-concurrent-user";
      const firstDb = await getOrInitUserDb(userId, testConfig, userDbCache);
      if (!firstDb) throw new Error("First database connection is undefined");

      const concurrentAccesses = 10;

      // Create multiple concurrent requests
      const requests = Array(concurrentAccesses)
        .fill(null)
        .map(() => getOrInitUserDb(userId, testConfig, userDbCache));

      const results = await Promise.all(requests);

      // All requests should return the same database instance
      for (const db of results) {
        if (!db) throw new Error("Database connection is undefined");
        expect(db).toBe(firstDb);
      }

      // Reference count should match concurrent access count
      expect(userDbCache.cache.get(userId)?.refCount).toBe(
        concurrentAccesses + 1,
      );
    });

    it("should handle concurrent cache eviction", async () => {
      const baseUserId = "test-concurrent-evict-user";
      const promises = [];

      // Create more concurrent connections than cache size
      for (let i = 0; i < testConfig.dbConnectionCacheSize + 2; i++) {
        promises.push(async () => {
          await getOrInitUserDb(`${baseUserId}-${i}`, testConfig, userDbCache);
          await releaseUserDb(`${baseUserId}-${i}`, userDbCache);
        });
      }

      await Promise.all(promises);
      expect(userDbCache.cache.size).toBeLessThanOrEqual(
        testConfig.dbConnectionCacheSize,
      );
    });
  });

  describe("Database Schema and Constraints", () => {
    it("should create all required indexes", async () => {
      const userId = "test-schema-user";
      const db = await getOrInitUserDb(userId, testConfig, userDbCache);

      const indexes = db
        .prepare(`
        SELECT name, sql FROM sqlite_master
        WHERE type='index' AND tbl_name='chat_messages'
      `)
        .all();

      expect(indexes).toContainEqual(
        expect.objectContaining({
          name: "idx_chat_messages_chat_id_id",
        }),
      );
    });

    it("should enforce schema constraints", async () => {
      const userId = "test-constraints-user";
      const db = await getOrInitUserDb(userId, testConfig, userDbCache);

      // Test NOT NULL constraints
      expect(() =>
        db
          .prepare(
            "INSERT INTO chat_messages (chat_id, role, content) VALUES (?, ?, ?)",
          )
          .run(null, "user", "test"),
      ).toThrow();
    });
  });
});
