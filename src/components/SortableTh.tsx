import { ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";
import { cn } from "@/lib/utils";

export function SortableTh({
  label,
  active,
  dir,
  onClick,
  className,
}: {
  label: string;
  active: boolean;
  dir: "asc" | "desc";
  onClick: () => void;
  className?: string;
}) {
  const Icon = !active ? ArrowUpDown : dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <th className={cn("text-left p-2", className)}>
      <button
        type="button"
        onClick={onClick}
        className="inline-flex items-center gap-1 hover:text-foreground text-muted-foreground uppercase tracking-wider text-[10px] font-medium"
        aria-label={`Sort by ${label} ${active && dir === "asc" ? "descending" : "ascending"}`}
      >
        {label}
        <Icon className={cn("w-3 h-3", active ? "opacity-100" : "opacity-40")} />
      </button>
    </th>
  );
}
