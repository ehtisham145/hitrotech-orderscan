import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockSupabase } from "./test-utils/mock-supabase";

let adminMock = createMockSupabase();
vi.mock("@/integrations/supabase/ext-client.server", () => ({
  get supabaseAdmin() {
    return adminMock.client;
  },
}));

import { createScreenshotUploadCore } from "./screenshot-upload.functions";

const ctx = (client: unknown) => ({ supabase: client as never, userId: "u1" });

beforeEach(() => {
  adminMock = createMockSupabase();
});

describe("createScreenshotUploadCore", () => {
  it("issues a signed upload url for the caller's own batch", async () => {
    const { client, queueResponse } = createMockSupabase();
    queueResponse("batches", { data: { id: "b1", created_by: "u1" }, error: null });
    adminMock.createSignedUploadUrl.mockResolvedValue({ data: { token: "tok" }, error: null });

    const result = await createScreenshotUploadCore({ batch_id: "b1", file_name: "order.png" }, ctx(client));

    expect(result).toEqual({ path: expect.stringMatching(/^u1\/b1\/.+\.png$/), token: "tok" });
  });

  it("falls back to jpg for an unrecognised extension", async () => {
    const { client, queueResponse } = createMockSupabase();
    queueResponse("batches", { data: { id: "b1", created_by: "u1" }, error: null });
    adminMock.createSignedUploadUrl.mockResolvedValue({ data: { token: "tok" }, error: null });

    const result = await createScreenshotUploadCore({ batch_id: "b1", file_name: "order.heic" }, ctx(client));
    expect(result.path).toMatch(/\.jpg$/);
  });

  it("rejects missing batch_id or file_name before touching the database", async () => {
    const { client } = createMockSupabase();
    await expect(createScreenshotUploadCore({ batch_id: "", file_name: "x.png" }, ctx(client))).rejects.toThrow("Missing upload details");
    await expect(createScreenshotUploadCore({ batch_id: "b1", file_name: "  " }, ctx(client))).rejects.toThrow("Missing upload details");
  });

  it("refuses a batch that doesn't exist", async () => {
    const { client, queueResponse } = createMockSupabase();
    queueResponse("batches", { data: null, error: null });
    await expect(createScreenshotUploadCore({ batch_id: "gone", file_name: "x.png" }, ctx(client))).rejects.toThrow("Batch not found");
  });

  it("refuses a batch created by someone else", async () => {
    const { client, queueResponse } = createMockSupabase();
    queueResponse("batches", { data: { id: "b1", created_by: "someone-else" }, error: null });
    await expect(createScreenshotUploadCore({ batch_id: "b1", file_name: "x.png" }, ctx(client))).rejects.toThrow("Batch not found");
  });

  it("surfaces a batch lookup error", async () => {
    const { client, queueError } = createMockSupabase();
    queueError("batches", "boom");
    await expect(createScreenshotUploadCore({ batch_id: "b1", file_name: "x.png" }, ctx(client))).rejects.toThrow("boom");
  });

  it("surfaces a signed-url creation failure", async () => {
    const { client, queueResponse } = createMockSupabase();
    queueResponse("batches", { data: { id: "b1", created_by: "u1" }, error: null });
    adminMock.createSignedUploadUrl.mockResolvedValue({ data: null, error: { message: "storage down" } });
    await expect(createScreenshotUploadCore({ batch_id: "b1", file_name: "x.png" }, ctx(client))).rejects.toThrow("storage down");
  });
});
