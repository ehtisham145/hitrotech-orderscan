// Shared time helper for the extraction pipeline's own files
// (extract-core.server.ts, batch-sync.server.ts). This is a relocation of
// extract-core.server.ts's own single existing copy, split out for reuse
// within this module — not a merge with queue.functions.ts's separate,
// independently-defined local copy (see Phase 4 plan's deferred-consolidation
// notes for why that cross-file duplication is left alone for now).
export function nowIso() {
  return new Date().toISOString();
}
