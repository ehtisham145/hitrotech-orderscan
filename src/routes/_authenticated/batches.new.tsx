/**
 * DO NOT REMOVE THIS COMMENT. 
 * FIXED UPLOAD LOGIC AND DB PERMISSIONS.
 * THE SCOPE AND WORKFLOW NEVER SHOULD BE CHANGED AS PLAN WAS DISCUSSED BEFORE.
 */
import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Sparkles } from "lucide-react";
import { useState, useCallback, useRef } from "react";
import { useDropzone } from "react-dropzone";
import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/ext-client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { UploadCloud, X, Loader2, Folder } from "lucide-react";
import { toast } from "sonner";
import { processInputFiles } from "@/lib/import-processing";
import { useServerFn } from "@tanstack/react-start";
import { checkActivationBudget } from "@/lib/usage.functions";
import { queueExtractions } from "@/lib/queue.functions";
import { createBatchWithExtractions } from "@/lib/batch-actions.functions";

export const Route = createFileRoute("/_authenticated/batches/new")({
  head: () => ({
    meta: [
      { title: "New Import — HitroTech OrderScan" },
      { name: "description", content: "Upload a new batch of telecom order screenshots for AI extraction." },
      { property: "og:title", content: "New Import — HitroTech OrderScan" },
      { property: "og:description", content: "Upload a new batch of telecom order screenshots for AI extraction." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: NewBatch,
});

const MAX_FILES = 500;
const ACCEPT = {
  "image/*": [".png", ".jpg", ".jpeg", ".webp", ".heic", ".heif"],
  "application/zip": [".zip"],
  "application/pdf": [".pdf"],
};

// Fallback lists used only if the settings tables are empty (e.g. fresh DB).

function NewBatch() {
  const navigate = useNavigate();
  const budgetCheck = useServerFn(checkActivationBudget);
  const queueExtractionsFn = useServerFn(queueExtractions);
  const createBatchWithExtractionsFn = useServerFn(createBatchWithExtractions);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [storeId, setStoreId] = useState<string>("");
  const [employeeName, setEmployeeName] = useState<string>("");
  const [branchName, setBranchName] = useState<string>("");
  const [files, setFiles] = useState<File[]>([]);
  const [preparing, setPreparing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);

  const [partnerId, setPartnerId] = useState<string>("");
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [upgradeMessage, setUpgradeMessage] = useState<string>("");

  const { data: partners } = useQuery({
    queryKey: ["settings", "partners-list"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("partners")
        .select("id, name, store_id, city")
        .eq("active", true)
        .order("name", { ascending: true });
      if (error) return [];
      return (data ?? []) as Array<{ id: string; name: string; store_id: string | null; city: string | null }>;
    },
  });
  const [statusText, setStatusText] = useState("");

  async function addFiles(incoming: File[]) {
    if (incoming.length === 0) return;
    setPreparing(true);
    try {
      const expanded = await processInputFiles(incoming, (msg) => setStatusText(msg));
      setFiles((prev) => {
        const combined = [...prev, ...expanded].slice(0, MAX_FILES);
        if (prev.length + expanded.length > MAX_FILES) {
          toast.warning(`Batch capped at ${MAX_FILES} images`);
        }
        return combined;
      });
    } catch (err) {
      console.error("addFiles error", err);
      toast.error("Error processing files. Please ensure they are valid images, ZIPs, or PDFs.");
    } finally {
      setPreparing(false);
      setStatusText("");
    }
  }

  const onDrop = useCallback((accepted: File[]) => {
    void addFiles(accepted);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: ACCEPT,
    disabled: preparing || uploading,
  });

  async function start() {
    if (!partnerId) {
      return toast.error("Select a partner before starting the import");
    }
    if (!storeId || !employeeName || !branchName) {
      return toast.error("Select Store ID, Employee Name, and Branch Name before starting");
    }
    if (files.length === 0) return toast.error("Add at least one screenshot");
    if (!name.trim()) return toast.error("Give the batch a name");

    // Plan-cap preflight before we start uploading anything
    try {
      await budgetCheck({ data: { requested: files.length } });
    } catch (e) {
      const msg = (e as Error).message;
      if (/plan|activation|limit|upgrade/i.test(msg)) {
        setUpgradeMessage(msg);
        setUpgradeOpen(true);
        return;
      }
      return toast.error(msg);
    }

    setUploading(true);
    setProgress(0);
    setStatusText("Creating batch…");

    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;
    if (!userId) {
      setUploading(false);
      return toast.error("Not signed in");
    }

    const { data: profile, error: profileErr } = await supabase.from("profiles").select("active_workspace_id").eq("id", userId).maybeSingle();
    const workspaceId = profile?.active_workspace_id;
    
    if (profileErr) {
      console.error("Profile fetch error:", profileErr);
    }

    if (!workspaceId) {
      setUploading(false);
      return toast.error("No active workspace found. Please refresh or set one in Settings.");
    }

    console.log("[NewBatch] Initializing batch and extractions on server...");
    
    const initResult = await createBatchWithExtractionsFn({
      data: {
        name: name.trim(),
        workspace_id: workspaceId,
        files: files.map(f => ({ name: f.name, type: f.type })),
        defaults: {
          store_id: storeId || null,
          employee_name: employeeName || null,
          branch_name: branchName || null,
          partner_id: partnerId || null,
        }
      }
    });

    // useServerFn returns the result directly, and handles errors via throwing
    const batchId = initResult?.batchId;
    const uploadTokens = initResult?.uploadTokens || [];
    const extractions = initResult?.extractions || [];

    if (!batchId) {
      console.error("[NewBatch] Initialization failed - no batchId");
      setUploading(false);
      return toast.error("Failed to initialize import");
    }
    const extractionIds = extractions.map((e: { id: string }) => e.id);

    setStatusText("Uploading images…");
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const tokenData = uploadTokens.find((t: { fileName: string }) => t.fileName === f.name);
      
      if (!tokenData) {
        console.error("No upload token found for file:", f.name);
        continue;
      }

      try {
        const { error: upErr } = await supabase.storage
          .from("screenshots")
          .uploadToSignedUrl(tokenData.path, tokenData.token, f, {
            contentType: f.type || "image/jpeg",
            cacheControl: "3600",
          });
        
        if (upErr) {
          console.error("Upload error for file:", f.name, upErr);
          toast.error(`Failed to upload ${f.name}: ${upErr.message}`);
          continue;
        }

        console.log("[NewBatch] File uploaded successfully:", f.name);
      } catch (err) {
        console.error("Unexpected error during upload loop:", f.name, err);
        toast.error(`Unexpected error with ${f.name}`);
      }
      setProgress(Math.round(((i + 1) / files.length) * 80));
    }

    if (extractionIds.length === 0) {
      setUploading(false);
      await supabase.from("batches").update({ 
        status: "failed", 
        failed_count: files.length,
      }).eq("id", batchId);
      return toast.error("The images could not be uploaded. Please try again or contact your administrator.");
    }

    setStatusText("Queueing images…");
    let queuedCount = 0;
    let directCount = 0;
    try {
      const result = await queueExtractionsFn({ data: { extraction_ids: extractionIds } });
      queuedCount = result.queued ?? 0;
      directCount = result.failed_to_queue ?? 0;
      if ((result.queued ?? 0) === 0 && (result.failed_to_queue ?? 0) === 0) throw new Error("No images were queued");
      if ((result.failed_to_queue ?? 0) > 0) {
        toast.warning(
          queuedCount > 0
            ? `${queuedCount} image${queuedCount === 1 ? "" : "s"} queued; ${directCount} will process directly on the batch page`
            : "Background queue unavailable; processing will continue directly on the batch page",
          {
            id: `queue-partial-${batchId}`,
          },
        );
      }
    } catch (e) {
      console.error(e);
      setUploading(false);
      setProgress(100);
      setStatusText("Queueing failed");
      toast.error("Images uploaded, but processing failed to start. Open the batch and press Requeue failed.", {
        id: `batch-failed-${batchId}`,
      });
      navigate({ to: "/batches/$id", params: { id: batchId } });
      return;
    }
    setProgress(95);
    setProgress(100);
    setStatusText("Processing started…");
    if (queuedCount > 0) {
      toast.success(`${queuedCount} image${queuedCount === 1 ? "" : "s"} queued for processing`, {
        id: `queue-success-${batchId}`,
      });
    }
    navigate({ to: "/batches/$id", params: { id: batchId } });
  }

  const busy = preparing || uploading;

  return (
    <div className="p-4 md:p-8 max-w-[1600px] mx-auto space-y-8">
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight text-foreground">New Import</h1>
        <p className="text-sm text-muted-foreground">
          Upload screenshots, HEIC photos, ZIP archives, PDF files, or drop a whole folder — we'll handle the rest.
        </p>
      </div>

      <Card className="rounded-2xl border-slate-200/60 shadow-sm overflow-hidden">
        <CardHeader>
          <CardTitle className="text-base">Batch details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name" className="text-[10px] font-bold uppercase tracking-wider text-slate-500/80">Batch name</Label>
            <Input id="name" className="rounded-2xl" value={name} onChange={(e) => setName(e.target.value)} disabled={busy} />
          </div>

          <div className="space-y-2">
            <Label className="text-[10px] font-bold uppercase tracking-wider text-slate-500/80">Partner <span className="text-destructive">*</span></Label>
            {(partners ?? []).length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-200 p-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-slate-50/50">
                <div className="text-sm text-muted-foreground">
                  No partners yet. Add one to continue with this import.
                </div>
                <Button
                  type="button"
                  onClick={() =>
                    navigate({
                      to: "/admin/partners/$id",
                      params: { id: "new" },
                      search: { returnTo: "/batches/new" },
                    })
                  }
                  className="rounded-2xl font-bold"
                >
                  Add your first partner
                </Button>
              </div>
            ) : (
              <Select
                value={partnerId}
                onValueChange={(v) => {
                  setPartnerId(v);
                  const p = (partners ?? []).find((x) => x.id === v);
                  if (p) {
                    setStoreId(p.store_id ?? "");
                    setEmployeeName(p.name ?? "");
                    setBranchName(p.city ?? "");
                  }
                }}
                disabled={busy}
              >
                <SelectTrigger className="rounded-2xl"><SelectValue placeholder="Select partner" /></SelectTrigger>
                <SelectContent className="rounded-2xl">
                  {(partners ?? []).map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}{p.store_id ? ` · ${p.store_id}` : ""}{p.city ? ` · ${p.city}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <p className="text-[11px] text-slate-500/80 leading-relaxed italic">
              Store ID, employee name, and branch will be filled from this partner for every order in this import.
            </p>
          </div>


          <div
            {...getRootProps()}
            className={`border-2 border-dashed rounded-2xl p-12 text-center transition-all cursor-pointer shadow-sm ${
              isDragActive ? "border-primary bg-primary/5 ring-4 ring-primary/10" : "border-slate-200 bg-white hover:border-primary/50 hover:bg-slate-50/50"
            } ${busy ? "opacity-50 pointer-events-none" : ""}`}
          >
            <input {...getInputProps()} />
            <UploadCloud className="w-10 h-10 mx-auto mb-3 text-slate-400" />
            <p className="text-sm font-bold text-foreground">Drop files, folders, ZIPs, or PDFs — or click to browse</p>
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500/70 mt-2">
              PNG · JPG · WEBP · HEIC · ZIP · PDF · up to {MAX_FILES} images per batch
            </p>
          </div>

          <div>
            <input
              ref={folderInputRef}
              type="file"
              className="hidden"
              multiple
              // @ts-expect-error non-standard but widely supported folder picker attributes
              webkitdirectory=""
              directory=""
              onChange={(e) => {
                const list = Array.from(e.target.files ?? []);
                if (list.length > 0) void addFiles(list);
                e.currentTarget.value = "";
              }}
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-slate-500 hover:text-slate-900 font-semibold"
              onClick={() => folderInputRef.current?.click()}
              disabled={busy}
            >
              <Folder className="w-4 h-4 mr-2" /> Choose folder
            </Button>
            <p className="text-[11px] text-muted-foreground mt-1.5">
              Picks an entire folder (including sub-folders). For individual files, use the drop box above.
            </p>
          </div>

          {files.length > 0 && (
            <div className="border border-slate-200/60 rounded-2xl p-6 bg-slate-50/20">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold">Selected files ({files.length})</h3>
                <Button 
                  variant="ghost" 
                  size="sm" 
                  className="h-8 text-xs text-destructive hover:text-destructive hover:bg-destructive/5 font-medium"
                  onClick={() => setFiles([])}
                  disabled={busy}
                >
                  Clear all
                </Button>
              </div>
              <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-3 max-h-[400px] overflow-auto pr-1">
                {files.map((f, i) => {
                  const isImage = f.type.startsWith("image/");
                  return (
                    <div key={i} className="relative aspect-square rounded-2xl overflow-hidden border border-slate-200 bg-white shadow-sm group">
                      {isImage ? (
                        <img src={URL.createObjectURL(f)} alt={f.name} className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex flex-col items-center justify-center p-2 text-[10px] text-center overflow-hidden">
                          <Folder className="w-6 h-6 mb-1 text-muted-foreground" />
                          <span className="truncate w-full">{f.name}</span>
                        </div>
                      )}
                      {!busy && (
                        <button
                          type="button"
                          onClick={() => setFiles((prev) => prev.filter((_, idx) => idx !== i))}
                          className="absolute top-1 right-1 rounded-2xl bg-white/90 p-1 hover:bg-white text-destructive shadow-sm opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {(preparing || uploading) && (
            <div className="space-y-2">
              <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500/80 flex items-center gap-2">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" /> {statusText || (preparing ? "Preparing files…" : "Working…")}
              </div>
              {uploading && <Progress value={progress} className="h-2 rounded-2xl" />}
            </div>
          )}

          <div className="flex gap-2 justify-end">
            <Button variant="ghost" className="font-bold text-slate-400 hover:text-slate-900 px-6" onClick={() => navigate({ to: "/batches" })} disabled={busy}>
              Cancel
            </Button>
            <Button className="gradient-brand px-8 font-bold rounded-2xl shadow-lg hover:shadow-xl transition-all h-11" onClick={start} disabled={busy || files.length === 0 || !storeId || !employeeName || !branchName}>
              {uploading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Uploading…
                </>
              ) : (
                `Start extraction (${files.length})`
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Dialog open={upgradeOpen} onOpenChange={setUpgradeOpen}>
        <DialogContent className="sm:max-w-md rounded-2xl">
          <DialogHeader>
            <div className="mx-auto mb-2 h-14 w-14 rounded-2xl gradient-brand text-primary-foreground grid place-items-center">
              <Sparkles className="w-7 h-7" />
            </div>
            <DialogTitle className="text-center text-xl">Activation limit reached</DialogTitle>
            <DialogDescription className="text-center">
              {upgradeMessage || "You've hit your plan's activation limit for this period."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="sm:justify-center gap-2">
            <Button variant="ghost" className="rounded-2xl" onClick={() => setUpgradeOpen(false)}>Not now</Button>
            <Button asChild className="rounded-2xl gradient-brand font-bold">
              <Link to="/admin/billing" onClick={() => setUpgradeOpen(false)}>
                Upgrade plan
              </Link>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
