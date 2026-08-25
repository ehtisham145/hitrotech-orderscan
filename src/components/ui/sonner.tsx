import { Toaster as Sonner } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      className="toaster group"
      position="top-right"
      offset={16}
      toastOptions={{
        classNames: {
          toast:
            "group toast pointer-events-auto flex w-full items-center gap-3 rounded-xl border border-border/60 bg-card/95 px-4 py-3 text-sm text-card-foreground shadow-lg backdrop-blur-md",
          title: "font-medium text-card-foreground",
          description: "text-muted-foreground text-xs",
          icon: "text-primary",
          success: "border-primary/30",
          error: "border-destructive/40 text-destructive-foreground",
          actionButton: "bg-primary text-primary-foreground rounded-md px-2 py-1 text-xs",
          cancelButton: "bg-muted text-muted-foreground rounded-md px-2 py-1 text-xs",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
