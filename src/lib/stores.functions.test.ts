import { describe, it, expect } from "vitest";
import { createMockSupabase } from "./test-utils/mock-supabase";
import { listStoresCore, createStoreCore, updateStoreCore, deleteStoreCore } from "./stores.functions";

const PROFILE = { data: { active_workspace_id: "ws1" }, error: null };
const ctx = (client: unknown) => ({ supabase: client as never, userId: "u1" });

describe("listStoresCore", () => {
  it("returns the workspace's stores", async () => {
    const { client, queueResponse, getChain } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    queueResponse("stores", { data: [{ id: "s1", code: "FD4001", label: null, sort_order: 0 }], error: null });

    const rows = await listStoresCore(ctx(client));

    expect(rows).toEqual([{ id: "s1", code: "FD4001", label: null, sort_order: 0 }]);
    // Scoped to the caller's workspace, never the whole table.
    expect(getChain("stores").eq).toHaveBeenCalledWith("workspace_id", "ws1");
  });

  it("returns an empty array rather than null when there are no stores", async () => {
    const { client, queueResponse } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    queueResponse("stores", { data: null, error: null });
    await expect(listStoresCore(ctx(client))).resolves.toEqual([]);
  });

  it("surfaces a query error instead of returning an empty list", async () => {
    const { client, queueResponse, queueError } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    queueError("stores", "boom");
    await expect(listStoresCore(ctx(client))).rejects.toThrow("boom");
  });

  it("refuses when the caller has no active workspace", async () => {
    const { client, queueResponse } = createMockSupabase();
    queueResponse("profiles", { data: { active_workspace_id: null }, error: null });
    await expect(listStoresCore(ctx(client))).rejects.toThrow(/No active workspace/);
  });
});

describe("createStoreCore", () => {
  it("uppercases and trims the code, and scopes the row to the workspace", async () => {
    const { client, queueResponse, allowRole, getChain } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    allowRole();
    queueResponse("stores", { data: { id: "s1", code: "FD4001", label: "Main", sort_order: 0 }, error: null });

    const row = await createStoreCore({ code: "  fd4001 ", label: "  Main  " }, ctx(client));

    expect(row).toMatchObject({ code: "FD4001" });
    expect(getChain("stores").insert).toHaveBeenCalledWith({
      workspace_id: "ws1",
      code: "FD4001",
      label: "Main",
    });
  });

  it("stores a blank label as null, not as an empty string", async () => {
    const { client, queueResponse, allowRole, getChain } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    allowRole();
    queueResponse("stores", { data: { id: "s1", code: "A1", label: null, sort_order: 0 }, error: null });

    await createStoreCore({ code: "A1", label: "   " }, ctx(client));

    expect(getChain("stores").insert).toHaveBeenCalledWith(
      expect.objectContaining({ label: null }),
    );
  });

  it("rejects an empty code before touching the database", async () => {
    const { client, queueResponse, allowRole } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    allowRole();
    await expect(createStoreCore({ code: "   " }, ctx(client))).rejects.toThrow("Store code is required");
  });

  it("rejects a code longer than 32 characters", async () => {
    const { client, queueResponse, allowRole } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    allowRole();
    await expect(createStoreCore({ code: "X".repeat(33) }, ctx(client))).rejects.toThrow("too long");
  });

  it("turns a unique-violation into a readable duplicate message", async () => {
    const { client, queueResponse, allowRole } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    allowRole();
    queueResponse("stores", { data: null, error: { message: "dup", code: "23505" } as never });

    await expect(createStoreCore({ code: "FD4001" }, ctx(client)))
      .rejects.toThrow('Store "FD4001" already exists in this workspace');
  });

  it("refuses a caller without the owner/admin role", async () => {
    const { client, queueResponse, allowRole } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    allowRole(false);
    await expect(createStoreCore({ code: "FD4001" }, ctx(client))).rejects.toThrow(/Forbidden/);
  });
});

describe("updateStoreCore", () => {
  it("normalises the code exactly as create does, and scopes by workspace and id", async () => {
    const { client, queueResponse, allowRole, getChain } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    allowRole();
    queueResponse("stores", { data: { id: "s1", code: "FD9", label: null, sort_order: 0 }, error: null });

    await updateStoreCore({ id: "s1", code: " fd9 ", label: "" }, ctx(client));

    const chain = getChain("stores");
    expect(chain.update).toHaveBeenCalledWith({ code: "FD9", label: null });
    expect(chain.eq).toHaveBeenCalledWith("workspace_id", "ws1");
    expect(chain.eq).toHaveBeenCalledWith("id", "s1");
  });

  it("fails loudly when no row comes back, rather than reporting a phantom edit", async () => {
    // maybeSingle() returns null when the id belongs to another workspace, or
    // RLS refused the write. Returning success there would leave the UI showing
    // a change the database never took.
    const { client, queueResponse, allowRole } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    allowRole();
    queueResponse("stores", { data: null, error: null });

    await expect(updateStoreCore({ id: "other-ws", code: "A1" }, ctx(client)))
      .rejects.toThrow("Store not found in this workspace");
  });

  it("turns a unique-violation into the same duplicate message create uses", async () => {
    const { client, queueResponse, allowRole } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    allowRole();
    queueResponse("stores", { data: null, error: { message: "dup", code: "23505" } as never });

    await expect(updateStoreCore({ id: "s1", code: "FD4001" }, ctx(client)))
      .rejects.toThrow('Store "FD4001" already exists in this workspace');
  });

  it("rejects an empty code", async () => {
    const { client, queueResponse, allowRole } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    allowRole();
    await expect(updateStoreCore({ id: "s1", code: "" }, ctx(client))).rejects.toThrow("Store code is required");
  });

  it("refuses a caller without the owner/admin role", async () => {
    const { client, queueResponse, allowRole } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    allowRole(false);
    await expect(updateStoreCore({ id: "s1", code: "A1" }, ctx(client))).rejects.toThrow(/Forbidden/);
  });
});

describe("deleteStoreCore", () => {
  it("deletes only within the caller's workspace", async () => {
    const { client, queueResponse, allowRole, getChain } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    allowRole();
    queueResponse("stores", { data: null, error: null });

    await expect(deleteStoreCore({ id: "s1" }, ctx(client))).resolves.toEqual({ ok: true });

    const chain = getChain("stores");
    expect(chain.delete).toHaveBeenCalled();
    expect(chain.eq).toHaveBeenCalledWith("workspace_id", "ws1");
    expect(chain.eq).toHaveBeenCalledWith("id", "s1");
  });

  it("surfaces a delete error", async () => {
    const { client, queueResponse, allowRole, queueError } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    allowRole();
    queueError("stores", "nope");
    await expect(deleteStoreCore({ id: "s1" }, ctx(client))).rejects.toThrow("nope");
  });

  it("refuses a caller without the owner/admin role", async () => {
    const { client, queueResponse, allowRole } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    allowRole(false);
    await expect(deleteStoreCore({ id: "s1" }, ctx(client))).rejects.toThrow(/Forbidden/);
  });
});
