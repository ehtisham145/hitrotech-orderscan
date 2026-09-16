import { describe, it, expect } from "vitest";
import { createMockSupabase } from "./test-utils/mock-supabase";
import {
  listNotificationsCore,
  markNotificationReadCore,
  listNotificationsPageCore,
  getNotificationPrefsCore,
  updateNotificationPrefsCore,
} from "./notifications.functions";

const ctx = (client: unknown) => ({ supabase: client as never, userId: "u1" });

describe("listNotificationsCore", () => {
  it("scopes to the caller and resolves workspace/actor names plus the unread count", async () => {
    const { client, queueResponse, getChain } = createMockSupabase();
    queueResponse("notifications", {
      data: [{ id: "n1", workspace_id: "ws1", actor_id: "u2", action: "x", entity_type: null, entity_id: null, title: "T", body: null, data: null, read_at: null, created_at: "t" }],
      error: null,
    });
    queueResponse("workspaces", { data: [{ id: "ws1", name: "Alpha" }], error: null });
    queueResponse("profiles", { data: [{ id: "u2", full_name: "Jane", email: "j@x.com" }], error: null });
    queueResponse("notifications", { data: null, error: null, count: 3 } as never);

    const result = await listNotificationsCore(undefined, ctx(client));

    expect(result.unreadCount).toBe(3);
    expect(result.notifications[0]).toMatchObject({ workspace_name: "Alpha", actor_name: "Jane" });
    expect(getChain("notifications").eq).toHaveBeenCalledWith("user_id", "u1");
  });

  it("skips the workspace/actor lookups entirely when there are no notifications", async () => {
    const { client, queueResponse, getChain } = createMockSupabase();
    queueResponse("notifications", { data: [], error: null });
    queueResponse("notifications", { data: null, error: null, count: 0 } as never);

    const result = await listNotificationsCore(undefined, ctx(client));
    expect(result).toEqual({ notifications: [], unreadCount: 0 });
    expect(() => getChain("workspaces")).toThrow();
  });

  it("surfaces the main list query error", async () => {
    const { client, queueError } = createMockSupabase();
    queueError("notifications", "boom");
    await expect(listNotificationsCore(undefined, ctx(client))).rejects.toThrow("boom");
  });

  it("surfaces the unread-count query error instead of reporting zero", async () => {
    const { client, queueResponse, queueError } = createMockSupabase();
    queueResponse("notifications", { data: [], error: null });
    queueError("notifications", "count boom");
    await expect(listNotificationsCore(undefined, ctx(client))).rejects.toThrow("count boom");
  });

  it("surfaces the workspace-name lookup error", async () => {
    const { client, queueResponse, queueError } = createMockSupabase();
    queueResponse("notifications", {
      data: [{ id: "n1", workspace_id: "ws1", actor_id: null, action: "x", entity_type: null, entity_id: null, title: "T", body: null, data: null, read_at: null, created_at: "t" }],
      error: null,
    });
    queueError("workspaces", "ws boom");
    queueResponse("notifications", { data: null, error: null, count: 0 } as never);
    await expect(listNotificationsCore(undefined, ctx(client))).rejects.toThrow("ws boom");
  });
});

describe("markNotificationReadCore", () => {
  it("marks only the caller's own unread notifications", async () => {
    const { client, queueResponse, getChain } = createMockSupabase();
    queueResponse("notifications", { data: null, error: null });

    await expect(markNotificationReadCore({ all: true }, ctx(client))).resolves.toEqual({ ok: true });
    const chain = getChain("notifications");
    expect(chain.eq).toHaveBeenCalledWith("user_id", "u1");
    expect(chain.is).toHaveBeenCalledWith("read_at", null);
  });

  it("narrows to a single id when given one", async () => {
    const { client, queueResponse, getChain } = createMockSupabase();
    queueResponse("notifications", { data: null, error: null });
    await markNotificationReadCore({ id: "n1" }, ctx(client));
    expect(getChain("notifications").eq).toHaveBeenCalledWith("id", "n1");
  });

  it("surfaces an update error", async () => {
    const { client, queueError } = createMockSupabase();
    queueError("notifications", "boom");
    await expect(markNotificationReadCore({}, ctx(client))).rejects.toThrow("boom");
  });
});

describe("listNotificationsPageCore", () => {
  it("paginates and reports the total count", async () => {
    const { client, queueResponse } = createMockSupabase();
    queueResponse("notifications", { data: [], error: null, count: 42 } as never);

    const result = await listNotificationsPageCore({ offset: 20, limit: 20 }, ctx(client));
    expect(result.total).toBe(42);
  });

  it("filters to unread only when asked", async () => {
    const { client, queueResponse, getChain } = createMockSupabase();
    queueResponse("notifications", { data: [], error: null, count: 0 } as never);
    await listNotificationsPageCore({ filter: "unread" }, ctx(client));
    expect(getChain("notifications").is).toHaveBeenCalledWith("read_at", null);
  });

  it("surfaces the main query error", async () => {
    const { client, queueError } = createMockSupabase();
    queueError("notifications", "boom");
    await expect(listNotificationsPageCore(undefined, ctx(client))).rejects.toThrow("boom");
  });

  it("surfaces the actor-lookup error", async () => {
    const { client, queueResponse, queueError } = createMockSupabase();
    queueResponse("notifications", {
      data: [{ id: "n1", workspace_id: null, actor_id: "u2", action: "x", entity_type: null, entity_id: null, title: "T", body: null, data: null, read_at: null, created_at: "t" }],
      error: null,
      count: 1,
    } as never);
    queueError("profiles", "actor boom");
    await expect(listNotificationsPageCore(undefined, ctx(client))).rejects.toThrow("actor boom");
  });
});

describe("getNotificationPrefsCore", () => {
  it("normalises stored prefs, filling in defaults for unset fields", async () => {
    const { client, queueResponse } = createMockSupabase();
    queueResponse("profiles", { data: { notification_prefs: { anomalyAlerts: false } }, error: null });
    const prefs = await getNotificationPrefsCore(ctx(client));
    expect(prefs).toEqual({ emailDigest: false, anomalyAlerts: false, batchComplete: true });
  });

  it("returns all defaults when no prefs have ever been saved", async () => {
    const { client, queueResponse } = createMockSupabase();
    queueResponse("profiles", { data: { notification_prefs: null }, error: null });
    const prefs = await getNotificationPrefsCore(ctx(client));
    expect(prefs).toEqual({ emailDigest: false, anomalyAlerts: true, batchComplete: true });
  });

  it("surfaces a query error", async () => {
    const { client, queueError } = createMockSupabase();
    queueError("profiles", "boom");
    await expect(getNotificationPrefsCore(ctx(client))).rejects.toThrow("boom");
  });
});

describe("updateNotificationPrefsCore", () => {
  it("merges the partial update onto the caller's existing prefs, not the defaults", async () => {
    const { client, queueResponse, getChain } = createMockSupabase();
    queueResponse("profiles", { data: { notification_prefs: { emailDigest: true, anomalyAlerts: false, batchComplete: false } }, error: null });
    queueResponse("profiles", { data: null, error: null });

    const result = await updateNotificationPrefsCore({ anomalyAlerts: true }, ctx(client));

    // emailDigest and batchComplete must survive from the existing record,
    // not fall back to DEFAULT_PREFS.
    expect(result).toEqual({ emailDigest: true, anomalyAlerts: true, batchComplete: false });
    expect(getChain("profiles", 1).update).toHaveBeenCalledWith({ notification_prefs: result });
  });

  it("fails instead of silently resetting other prefs when the existing-prefs read errors", async () => {
    const { client, queueError } = createMockSupabase();
    queueError("profiles", "read boom");
    await expect(updateNotificationPrefsCore({ anomalyAlerts: true }, ctx(client))).rejects.toThrow("read boom");
  });

  it("surfaces the update error", async () => {
    const { client, queueResponse, queueError } = createMockSupabase();
    queueResponse("profiles", { data: { notification_prefs: {} }, error: null });
    queueError("profiles", "update boom");
    await expect(updateNotificationPrefsCore({ anomalyAlerts: true }, ctx(client))).rejects.toThrow("update boom");
  });
});
