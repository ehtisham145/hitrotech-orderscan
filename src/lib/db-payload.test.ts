import { describe, it, expect } from "vitest";
import { omitNulls } from "./db-payload";

describe("omitNulls", () => {
  it("drops a key whose value is explicitly null", () => {
    const out = omitNulls({ name: "Ali", join_date: null }, ["join_date"]);
    expect(out).toEqual({ name: "Ali" });
    expect("join_date" in out).toBe(false);
  });

  it("keeps a real value, including falsy ones that are not null", () => {
    expect(omitNulls({ commission_per_activation: 0 }, ["commission_per_activation"]))
      .toEqual({ commission_per_activation: 0 });
    expect(omitNulls({ join_date: "" }, ["join_date"])).toEqual({ join_date: "" });
    expect(omitNulls({ active: false }, ["active"])).toEqual({ active: false });
  });

  it("leaves nulls alone on keys it was not asked about", () => {
    const out = omitNulls({ join_date: null, city: null }, ["join_date"]);
    expect(out).toEqual({ city: null });
  });

  it("leaves undefined alone — absent is already what the database wants", () => {
    const out = omitNulls({ join_date: undefined }, ["join_date"]);
    expect("join_date" in out).toBe(true);
    expect(out.join_date).toBeUndefined();
  });

  it("does not mutate the payload it was given", () => {
    const input = { join_date: null, name: "Ali" };
    omitNulls(input, ["join_date"]);
    expect(input).toEqual({ join_date: null, name: "Ali" });
  });

  it("tolerates at runtime a key the payload does not have", () => {
    // The signature constrains keys to `keyof T`, so a mistyped column name is
    // a compile error rather than a silently ignored one — which is most of
    // the point. The cast here deliberately steps around that to confirm the
    // runtime behaviour is still harmless if it ever is reached dynamically.
    const out = (omitNulls as (p: Record<string, unknown>, k: readonly string[]) => Record<string, unknown>)(
      { name: "Ali" },
      ["join_date", "commission_per_activation"],
    );
    expect(out).toEqual({ name: "Ali" });
  });

  // ── The two regressions this exists for ─────────────────────────────────
  // Both columns are NOT NULL with a database default, while their input
  // schemas accept null for "the user left the field blank". Sending that null
  // made the whole insert/update fail on a constraint, so clearing an optional
  // -looking field in the UI broke the save. Neither was visible to the
  // typechecker while the payloads were cast with `as any`.
  it("makes a blank employee commission fall back to the column default", () => {
    const payload = omitNulls(
      { workspace_id: "ws1", name: "Ali", role: "bdo", commission_per_activation: null },
      ["commission_per_activation"],
    );
    expect(payload).toEqual({ workspace_id: "ws1", name: "Ali", role: "bdo" });
  });

  it("makes a blank partner join date fall back to the column default", () => {
    const payload = omitNulls(
      { workspace_id: "ws1", created_by: "u1", name: "Acme", join_date: null },
      ["join_date"],
    );
    expect(payload).toEqual({ workspace_id: "ws1", created_by: "u1", name: "Acme" });
  });
});
