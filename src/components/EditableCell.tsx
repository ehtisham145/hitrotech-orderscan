import { useState, useEffect } from "react";
import { Save } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export function EditableCell({
  value,
  confidence,
  onSave,
  disabled,
}: {
  value: string;
  confidence?: number;
  onSave: (v: string) => void;
  disabled?: boolean;
}) {
  const [v, setV] = useState(value);
  const [editing, setEditing] = useState(false);
  useEffect(() => setV(value), [value]);
  const lowConf = typeof confidence === "number" && confidence < 90;

  if (disabled) return <span className="text-slate-300 italic text-[11px]">—</span>;
  if (!editing) {
    return (
      <button
        onClick={() => setEditing(true)}
        className={cn(
          "text-left w-full px-2 py-1 rounded-2xl hover:bg-muted text-xs truncate max-w-[180px] block",
          lowConf && "bg-yellow-100/60 dark:bg-yellow-900/30",
        )}
        title={value + (typeof confidence === "number" ? ` (${confidence}%)` : "")}
      >
        {value || <span className="text-slate-300 italic">—</span>}
      </button>
    );
  }
  return (
    <div className="flex gap-1">
      <Input
        value={v}
        onChange={(e) => setV(e.target.value)}
        className="h-7 text-xs"
        autoFocus
        onKeyDown={(e) => {
          if (e.key === "Enter") { onSave(v); setEditing(false); }
          if (e.key === "Escape") { setV(value); setEditing(false); }
        }}
      />
      <Button size="sm" className="h-7 px-2" onClick={() => { onSave(v); setEditing(false); }} aria-label="Save">
        <Save className="w-3 h-3" />
      </Button>
    </div>
  );
}
