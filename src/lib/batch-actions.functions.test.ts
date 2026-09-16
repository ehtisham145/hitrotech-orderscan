import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockSupabase } from "./test-utils/mock-supabase";

// ext-client.server is dynamically imported inside createBatchWithExtractionsCore
// for the privileged supabaseAdmin client. Mocked so it never touches the
// real EXT_SUPABASE_* project.
//
// `adminMock` is reassigned fresh in beforeEach (below) so each test starts
// with empty queues/chain-history — a getter export means every `.from(...)`
// call inside the code under test always reads whatever `adminMock` current
// points to, rather than freezing a single instance for the whole file (that
// was tried first and silently accumulated chain history across tests,
// making index-based getChain(...) assertions from a later test see chains
// left over from an earlier one).
let adminMock = createMockSupabase();
vi.mock("@/integrations/supabase/ext-client.server", () => ({
  get supabaseAdmin() {
    return adminMock.client;
  },
}));

import { createBatchWithExtractionsCore } from "./batch-actions.functions";

const VALID_INPUT = {
  name: "Test batch",
  workspace_id: "11111111-1111-1111-1111-111111111111",
  files: [
    { name: "order1.png", type: "image/png" },
    { name: "order2.jpg", type: "image/jpeg" },
  ],
  defaults: { store_id: "S1", employee_name: "Ehtisham", branch_name: "Lahore", partner_id: null },
};

describe("createBatchWithExtractionsCore", () => {
  beforeEach(() => {
    adminMock = createMockSupabase();
  });

  it("throws before any writes if the caller doesn't have access to the workspace", async () => {
    const { client, queueResponse } = createMockSupabase();
    queueResponse("workspaces", { data: null, error: null }); // maybeSingle finds nothing

    await expect(
      createBatchWithExtractionsCore(VALID_INPUT, { supabase: client as any, userId: "u1" }),
    ).rejects.toThrow("Workspace not found or access denied");

    // No batch/extraction writes were attempted on the admin client — the
    // access check must short-circuit before any of that.
    expect(() => adminMock.getChain("batches", 0)).toThrow();
  });

  it("creates the batch and every extraction+upload-token on the happy path", async () => {
    const { client, queueResponse } = createMockSupabase();
    queueResponse("workspaces", { data: { id: VALID_INPUT.workspace_id }, error: null });

    adminMock.queueResponse("batches", { data: { id: "batch1" }, error: null });
    adminMock.queueResponse("extractions", { data: { id: "ext1" }, error: null });
    adminMock.queueResponse("extractions", { data: { id: "ext2" }, error: null });
    adminMock.createSignedUploadUrl.mockResolvedValue({ data: { token: "tok" }, error: null });

    const result = await createBatchWithExtractionsCore(VALID_INPUT, { supabase: client as any, userId: "u1" });

    expect(result.batchId).toBe("batch1");
    expect(result.extractions).toHaveLength(2);
    expect(result.uploadTokens).toHaveLength(2);
    expect(adminMock.createSignedUploadUrl).toHaveBeenCalledTimes(2);
  });

  it("skips a file whose extraction-record insert fails, but still succeeds for the others", async () => {
    const { client, queueResponse } = createMockSupabase();
    queueResponse("workspaces", { data: { id: VALID_INPUT.workspace_id }, error: null });

    adminMock.queueResponse("batches", { data: { id: "batch1" }, error: null });
    adminMock.queueResponse("extractions", { data: null, error: { message: "insert failed" } }); // file 1 fails
    adminMock.queueResponse("extractions", { data: { id: "ext2" }, error: null }); // file 2 succeeds
    adminMock.createSignedUploadUrl.mockResolvedValue({ data: { token: "tok" }, error: null });

    const result = await createBatchWithExtractionsCore(VALID_INPUT, { supabase: client as any, userId: "u1" });

    expect(result.extractions).toHaveLength(1);
    expect(result.extractions[0].fileName).toBe("order2.jpg");
  });

  it("skips a file whose signed-upload-url creation fails, but still succeeds for the others", async () => {
    const { client, queueResponse } = createMockSupabase();
    queueResponse("workspaces", { data: { id: VALID_INPUT.workspace_id }, error: null });

    adminMock.queueResponse("batches", { data: { id: "batch1" }, error: null });
    adminMock.queueResponse("extractions", { data: { id: "ext1" }, error: null });
    adminMock.queueResponse("extractions", { data: { id: "ext2" }, error: null });
    adminMock.createSignedUploadUrl
      .mockResolvedValueOnce({ data: null, error: { message: "storage down" } }) // file 1's signed URL fails
      .mockResolvedValueOnce({ data: { token: "tok" }, error: null }); // file 2 succeeds

    const result = await createBatchWithExtractionsCore(VALID_INPUT, { supabase: client as any, userId: "u1" });

    expect(result.extractions).toHaveLength(1);
    expect(result.extractions[0].fileName).toBe("order2.jpg");
  });

  it("marks the batch failed and throws when every single file fails, instead of leaving it stuck", async () => {
    const { client, queueResponse } = createMockSupabase();
    queueResponse("workspaces", { data: { id: VALID_INPUT.workspace_id }, error: null });

    adminMock.queueResponse("batches", { data: { id: "batch1" }, error: null }); // create
    adminMock.queueResponse("extractions", { data: null, error: { message: "boom" } });
    adminMock.queueResponse("extractions", { data: null, error: { message: "boom" } });
    adminMock.queueResponse("batches", { data: null, error: null }); // the status:"failed" cleanup update

    await expect(
      createBatchWithExtractionsCore(VALID_INPUT, { supabase: client as any, userId: "u1" }),
    ).rejects.toThrow("Failed to initialize any extraction records");

    expect(adminMock.getChain("batches", 1).update).toHaveBeenCalledWith(expect.objectContaining({ status: "failed" }));
  });
});
