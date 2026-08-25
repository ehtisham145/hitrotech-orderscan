import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Copy, Download, Printer, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  codes: string[];
  onConfirm?: () => void;
}

export function RecoveryCodesDialog({ open, onOpenChange, codes, onConfirm }: Props) {
  const [saved, setSaved] = useState(false);

  const codesText = codes.join("\n");
  const filename = `hitrotech-recovery-codes-${new Date().toISOString().slice(0, 10)}.txt`;
  const header = `HitroTech OrderScan — Recovery codes\nGenerated: ${new Date().toLocaleString()}\n\nEach code works ONCE. Store them somewhere safe (password manager, printed copy).\nIf you lose access to your 2FA methods, use any code below to sign in — this will disable all 2FA on your account so you can re-enroll.\n\n`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(codesText);
      toast.success("Codes copied to clipboard");
    } catch {
      toast.error("Could not copy — please copy manually");
    }
  }

  function download() {
    const blob = new Blob([header + codesText + "\n"], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  function print() {
    const w = window.open("", "_blank", "width=500,height=700");
    if (!w) return toast.error("Popup blocked — allow popups and try again");
    w.document.write(`<!doctype html><html><head><title>Recovery codes</title>
      <style>body{font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;padding:32px;color:#0f172a}
      h1{font-size:18px;margin:0 0 8px}p{color:#475569;font-size:13px;line-height:1.5}
      code{display:block;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:16px;padding:8px 12px;background:#f1f5f9;border-radius:6px;margin:6px 0;letter-spacing:1px}
      </style></head><body>
      <h1>HitroTech OrderScan — Recovery codes</h1>
      <p>Generated ${new Date().toLocaleString()}. Each code works once.</p>
      ${codes.map((c) => `<code>${c}</code>`).join("")}
      </body></html>`);
    w.document.close();
    setTimeout(() => w.print(), 250);
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) setSaved(false); onOpenChange(o); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><ShieldCheck className="w-5 h-5" /> Save your recovery codes</DialogTitle>
          <DialogDescription>
            Store these somewhere safe. If you lose access to your authenticator or email, any one of these codes will let you sign in — but each code works only <strong>once</strong>.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-md border bg-muted/40 p-4">
          <div className="grid grid-cols-2 gap-2 font-mono text-sm">
            {codes.map((c, i) => (
              <div key={i} className="bg-background rounded px-2 py-1.5 tracking-wider text-center select-all">{c}</div>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={copy}><Copy className="w-4 h-4 mr-1.5" />Copy</Button>
          <Button size="sm" variant="outline" onClick={download}><Download className="w-4 h-4 mr-1.5" />Download</Button>
          <Button size="sm" variant="outline" onClick={print}><Printer className="w-4 h-4 mr-1.5" />Print</Button>
        </div>

        <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-xs">
          <div className="text-amber-700 dark:text-amber-400">
            <strong>These codes will not be shown again.</strong> If you lose them and lose access to your 2FA methods, you'll need to ask a workspace admin to reset your account.
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Checkbox id="rc-saved" checked={saved} onCheckedChange={(v) => setSaved(!!v)} />
          <Label htmlFor="rc-saved" className="text-sm font-normal cursor-pointer">I've saved my recovery codes</Label>
        </div>

        <DialogFooter>
          <Button
            disabled={!saved}
            onClick={() => { onConfirm?.(); onOpenChange(false); setSaved(false); }}
          >
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
