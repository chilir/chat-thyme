// src/db/sqlite.test.ts

import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import tmp from "tmp";
import type { DbCacheEntry, dbCache } from "../interfaces";
import { clearUserDbCache, initUserDbCache } from "./cache";
import { getOrInitUserDb, releaseUserDb } from "./sqlite";

describe("SQLite Database Operations", () => {
  const userId = "test-user";
  let userDbCache: dbCache;
  const tmpDir = tmp.dirSync({
    prefix: "chat-thyme-test-",
    unsafeCleanup: true,
  });
  const testDbConnectionCacheSize = 2;

  beforeEach(() => {
    userDbCache = initUserDbCache();
  });

  afterEach(async () => {
    await clearUserDbCache(userDbCache);
  });

  describe("Basic Database Operations", () => {
    it("should initialize new database for user", async () => {
      const db = await getOrInitUserDb(
        userId,
        userDbCache,
        tmpDir.name,
        testDbConnectionCacheSize,
      );
      expect(db).toBeInstanceOf(Database);
      expect(userDbCache.cache.has(userId)).toBe(true);

      const cacheEntry = userDbCache.cache.get(userId) as DbCacheEntry;
      expect(cacheEntry.refCount).toBe(1);

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
      const db1 = await getOrInitUserDb(
        userId,
        userDbCache,
        tmpDir.name,
        testDbConnectionCacheSize,
      );

      // Second request for same user
      const db2 = await getOrInitUserDb(
        userId,
        userDbCache,
        tmpDir.name,
        testDbConnectionCacheSize,
      );

      expect(db1).toBe(db2);
      const cacheEntry = userDbCache.cache.get(userId) as DbCacheEntry;
      expect(cacheEntry.refCount).toBe(2);
    });

    it("should handle database connection cache size limit", async () => {
      const userId2 = `${userId}-2`;
      const userId3 = `${userId}-3`;

      // Fill cache to limit
      await getOrInitUserDb(
        userId,
        userDbCache,
        tmpDir.name,
        testDbConnectionCacheSize,
      );
      await getOrInitUserDb(
        userId2,
        userDbCache,
        tmpDir.name,
        testDbConnectionCacheSize,
      );

      await releaseUserDb(userId, userDbCache);

      // Add another connection that should evict user 1
      await getOrInitUserDb(
        userId3,
        userDbCache,
        tmpDir.name,
        testDbConnectionCacheSize,
      );

      expect(userDbCache.cache.has(userId)).toBe(false);
      expect(userDbCache.cache.has(userId2)).toBe(true);
      expect(userDbCache.cache.has(userId3)).toBe(true);
      expect(userDbCache.cache.size).toBe(2);
    });
  });

  it("should handle database corruption", async () => {
    const db = await getOrInitUserDb(
      userId,
      userDbCache,
      tmpDir.name,
      testDbConnectionCacheSize,
    );

    expect(() => db.prepare("CORRUPTED SQL STATEMENT").run()).toThrow();

    // Database should still be usable
    const validQuery = db.prepare("SELECT 1").get();
    expect(validQuery).toBeDefined();
  });

  describe("Multi-threaded Access and Race Conditions", () => {
    it("should handle concurrent database access", async () => {
      const firstDb = await getOrInitUserDb(
        userId,
        userDbCache,
        tmpDir.name,
        testDbConnectionCacheSize,
      );
      if (!firstDb) throw new Error("First database connection is undefined");

      const concurrentAccesses = 10;

      // Create multiple concurrent requests for the first db
      const requests = Array(concurrentAccesses)
        .fill(null)
        .map(() =>
          getOrInitUserDb(
            userId,
            userDbCache,
            tmpDir.name,
            testDbConnectionCacheSize,
          ),
        );

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
      const promises = [];

      // Create more concurrent connections than cache size
      for (let i = 0; i < testDbConnectionCacheSize + 2; i++) {
        promises.push(async () => {
          await getOrInitUserDb(
            `${userId}-${i}`,
            userDbCache,
            tmpDir.name,
            testDbConnectionCacheSize,
          );
          await releaseUserDb(`${userId}-${i}`, userDbCache);
        });
      }

      await Promise.all(promises);
      expect(userDbCache.cache.size).toBeLessThanOrEqual(
        testDbConnectionCacheSize,
      );
    });
  });

  describe("Database Schema and Constraints", () => {
    it("should create all required indexes", async () => {
      const db = await getOrInitUserDb(
        userId,
        userDbCache,
        tmpDir.name,
        testDbConnectionCacheSize,
      );

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
      const db = await getOrInitUserDb(
        userId,
        userDbCache,
        tmpDir.name,
        testDbConnectionCacheSize,
      );

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
