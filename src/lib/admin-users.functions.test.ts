import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockSupabase } from "./test-utils/mock-supabase";

// deleteUsersCore dynamically imports the privileged admin client for
// auth.admin.deleteUser — mocked so no real account is ever touched.
const deleteUser = vi.fn();
vi.mock("@/integrations/supabase/ext-client.server", () => ({
  supabaseAdmin: {
    auth: { admin: { deleteUser: (...a: unknown[]) => deleteUser(...a) } },
  },
}));

import { deleteUsersCore } from "./admin-users.functions";

const ctx = (client: unknown) => ({ supabase: client as never, userId: "admin1" });

beforeEach(() => {
  deleteUser.mockReset();
});

describe("deleteUsersCore", () => {
  it("deletes the given users and reports how many succeeded", async () => {
    const { client, queueResponse } = createMockSupabase();
    queueResponse("user_roles", { data: [{ role: "admin" }], error: null });
    deleteUser.mockResolvedValue({ error: null });

    const result = await deleteUsersCore({ userIds: ["u2", "u3"] }, ctx(client));

    expect(result).toEqual({ deleted: 2, skippedSelf: 0, errors: [] });
    expect(deleteUser).toHaveBeenCalledWith("u2");
    expect(deleteUser).toHaveBeenCalledWith("u3");
  });

  it("skips the caller's own id rather than deleting it", async () => {
    const { client, queueResponse } = createMockSupabase();
    queueResponse("user_roles", { data: [{ role: "admin" }], error: null });
    deleteUser.mockResolvedValue({ error: null });

    const result = await deleteUsersCore({ userIds: ["admin1", "u2"] }, ctx(client));

    expect(result).toEqual({ deleted: 1, skippedSelf: 1, errors: [] });
    expect(deleteUser).toHaveBeenCalledTimes(1);
    expect(deleteUser).toHaveBeenCalledWith("u2");
  });

  it("refuses a request that would only delete the caller's own account", async () => {
    const { client, queueResponse } = createMockSupabase();
    queueResponse("user_roles", { data: [{ role: "admin" }], error: null });
    await expect(deleteUsersCore({ userIds: ["admin1"] }, ctx(client))).rejects.toThrow("You cannot delete your own account.");
    expect(deleteUser).not.toHaveBeenCalled();
  });

  it("refuses a caller without admin or super_admin role", async () => {
    const { client, queueResponse } = createMockSupabase();
    queueResponse("user_roles", { data: [{ role: "member" }], error: null });
    await expect(deleteUsersCore({ userIds: ["u2"] }, ctx(client))).rejects.toThrow(/Forbidden/);
    expect(deleteUser).not.toHaveBeenCalled();
  });

  it("allows a super_admin even without the admin role", async () => {
    const { client, queueResponse } = createMockSupabase();
    queueResponse("user_roles", { data: [{ role: "super_admin" }], error: null });
    deleteUser.mockResolvedValue({ error: null });
    await expect(deleteUsersCore({ userIds: ["u2"] }, ctx(client))).resolves.toMatchObject({ deleted: 1 });
  });

  it("surfaces the role-check query error rather than reporting a plain refusal", async () => {
    const { client, queueError } = createMockSupabase();
    queueError("user_roles", "role boom");
    await expect(deleteUsersCore({ userIds: ["u2"] }, ctx(client))).rejects.toThrow("role boom");
  });

  it("collects per-user errors instead of failing the whole batch", async () => {
    const { client, queueResponse } = createMockSupabase();
    queueResponse("user_roles", { data: [{ role: "admin" }], error: null });
    deleteUser
      .mockResolvedValueOnce({ error: null })
      .mockResolvedValueOnce({ error: { message: "not found" } });

    const result = await deleteUsersCore({ userIds: ["u2", "u3"] }, ctx(client));

    expect(result).toEqual({ deleted: 1, skippedSelf: 0, errors: [{ userId: "u3", message: "not found" }] });
  });
});
