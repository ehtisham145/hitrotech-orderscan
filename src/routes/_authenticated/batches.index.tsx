import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/ext-client";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuLabel, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { Upload, Download, Loader2, ChevronDown } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/batches/")({
  head: () => ({
    meta: [
      { title: "Batches — HitroTech OrderScan" },
      { name: "description", content: "All uploaded batches of telecom order screenshots with their extraction status and results." },
      { property: "og:title", content: "Batches — HitroTech OrderScan" },
      { property: "og:description", content: "All uploaded batches of telecom order screenshots with their extraction status and results." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: BatchesList,
});

function BatchesList() {
  const { data: batches, isLoading } = useQuery({
    queryKey: ["batches"],
    queryFn: async () => {
      const { data, error } = await supabase.from("batches").select("*").not("status", "is", null).order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const [downloading, setDownloading] = useState<string | null>(null);

  async function exportBatch(id: string, name: string, filter: "all" | "success" | "failed" | "duplicates") {
    setDownloading(id);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) {
        toast.error("Not signed in");
        return;
      }
      const res = await fetch(`/api/export/${id}?filter=${filter}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        toast.error("Export failed");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${name}${filter === "all" ? "" : `-${filter}`}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success("Downloaded");
    } catch (err) {
      console.error(err);
      toast.error("Export failed");
    } finally {
      setDownloading(null);
    }
  }

  return (
    <div className="p-4 md:p-8 max-w-[1600px] mx-auto space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-3xl font-extrabold tracking-tight text-foreground">Batches</h1>
          <p className="text-sm text-slate-500/80 mt-1">Manage and export your import batches</p>
        </div>
        <Button asChild className="w-full sm:w-auto gradient-brand font-bold rounded-2xl px-8 shadow-lg hover:shadow-xl transition-all">
          <Link to="/batches/new"><Upload className="w-4 h-4 mr-2" /> New Import</Link>
        </Button>
      </div>

      <Card className="rounded-2xl border-slate-200/60 shadow-sm overflow-hidden">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4 space-y-3" role="status" aria-label="Loading batches">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4">
                  <Skeleton className="h-9 w-9 rounded-2xl" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-1/3" />
                    <Skeleton className="h-3 w-1/5" />
                  </div>
                  <Skeleton className="h-6 w-20" />
                </div>
              ))}
            </div>
          ) : (batches?.length ?? 0) === 0 ? (
            <div className="p-12 text-center">
              <p className="text-sm text-muted-foreground mb-4">You haven't imported anything yet.</p>
              <Button asChild className="gradient-brand font-bold rounded-2xl px-6 shadow-sm"><Link to="/batches/new">Start your first import</Link></Button>
            </div>
          ) : (
            <div className="overflow-x-auto">
            <table className="w-full text-[11px] min-w-[800px] border-collapse">
              <thead className="bg-slate-50/80 text-[11px] uppercase tracking-wider text-slate-500/80 font-bold border-b border-slate-200/60">
                <tr>
                  <th className="text-left p-3">Batch</th>
                  <th className="text-left p-3">Created</th>
                  <th className="text-right p-3">Images</th>
                  <th className="text-right p-3">Done</th>
                  <th className="text-right p-3">Failed</th>
                  <th className="text-right p-3">Dup</th>
                  <th className="text-left p-3">Status</th>
                  <th className="text-right p-3">Export</th>
                </tr>
              </thead>
              <tbody>
                {batches!.map((b) => (
                  <tr key={b.id} className="border-t border-slate-100 hover:bg-slate-50/30 transition-colors">
                    <td className="p-3">
                      <Link to="/batches/$id" params={{ id: b.id }} className="text-primary hover:underline font-bold text-[10px] uppercase">
                        {b.name}
                      </Link>
                    </td>
                    <td className="p-3 text-slate-500/80">{formatDistanceToNow(new Date(b.created_at), { addSuffix: true })}</td>
                    <td className="p-3 text-right">{b.total_images}</td>
                    <td className="p-3 text-right text-emerald-600">{b.processed_count}</td>
                    <td className="p-3 text-right">{b.failed_count > 0 ? <span className="text-destructive">{b.failed_count}</span> : "—"}</td>
                    <td className="p-3 text-right">{b.duplicate_count > 0 ? <span className="text-amber-600">{b.duplicate_count}</span> : "—"}</td>
                    <td className="p-3"><span className="uppercase text-[9px] font-bold tracking-wider px-2 py-0.5 rounded-2xl bg-slate-100 text-slate-600 border border-slate-200/50">{b.status}</span></td>
                    <td className="p-3 text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-8 px-2 text-slate-500 hover:text-primary font-bold"
                            disabled={downloading === b.id || b.total_images === 0}
                          >
                            {downloading === b.id ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <>
                                <Download className="w-3.5 h-3.5 mr-1" />
                                <ChevronDown className="w-3 h-3" />
                              </>
                            )}
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="rounded-2xl shadow-xl border-slate-200/60 min-w-[180px]">
                          <DropdownMenuLabel>Export orders</DropdownMenuLabel>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onClick={() => exportBatch(b.id, b.name, "all")}>
                            All orders
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => exportBatch(b.id, b.name, "success")}>
                            Success only ({b.processed_count - (b.duplicate_count ?? 0)})
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => exportBatch(b.id, b.name, "failed")}
                            disabled={!b.failed_count}
                          >
                            Failed only ({b.failed_count ?? 0})
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => exportBatch(b.id, b.name, "duplicates")}
                            disabled={!b.duplicate_count}
                          >
                            Duplicates only ({b.duplicate_count ?? 0})
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
