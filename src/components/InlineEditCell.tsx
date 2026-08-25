import * as React from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Check, Pencil, X } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  value: string | null;
  onSave: (next: string) => Promise<void> | void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  monospace?: boolean;
};

/**
 * Click-to-edit cell. Enter to save, Escape to cancel. Read-only until clicked.
 * Uses the same update path as the rest of the app — the existing
 * `log_extraction_edit` trigger records the change to audit_logs automatically.
 */
export function InlineEditCell({ value, onSave, disabled, placeholder, className, monospace }: Props) {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(value ?? "");
  const [saving, setSaving] = React.useState(false);
  React.useEffect(() => setDraft(value ?? ""), [value]);

  const commit = async () => {
    const next = draft.trim();
    if (next === (value ?? "").trim()) { setEditing(false); return; }
    setSaving(true);
    try {
      await onSave(next);
    } finally {
      setSaving(false);
      setEditing(false);
    }
  };

  if (disabled) {
    return (
      <span className={cn("text-xs", !value && "text-muted-foreground", monospace && "font-mono", className)}>
        {value || "—"}
      </span>
    );
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className={cn(
          "group inline-flex items-center gap-1 text-left rounded-2xl px-1.5 py-0.5 -mx-1.5 -my-0.5 hover:bg-muted transition-colors max-w-full",
          !value && "text-muted-foreground italic",
          monospace && "font-mono",
          className,
        )}
        aria-label={`Edit ${placeholder ?? "field"}`}
      >
        <span className="truncate">{value || placeholder || "—"}</span>
        <Pencil className="w-3 h-3 opacity-0 group-hover:opacity-60 shrink-0" />
      </button>
    );
  }

  return (
    <div className="flex items-center gap-1">
      <Input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); void commit(); }
          if (e.key === "Escape") { setDraft(value ?? ""); setEditing(false); }
        }}
        disabled={saving}
        className={cn("h-7 text-xs min-w-[120px] rounded-2xl", monospace && "font-mono")}
      />
      <Button size="icon" variant="ghost" className="h-6 w-6 rounded-2xl" onClick={() => void commit()} disabled={saving} aria-label="Save">
        <Check className="w-3.5 h-3.5" />
      </Button>
      <Button
        size="icon"
        variant="ghost"
        className="h-6 w-6 rounded-2xl"
        onClick={() => { setDraft(value ?? ""); setEditing(false); }}
        disabled={saving}
        aria-label="Cancel"
      >
        <X className="w-3.5 h-3.5" />
      </Button>
    </div>
  );
}
