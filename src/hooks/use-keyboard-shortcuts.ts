import * as React from "react";

type Handler = (e: KeyboardEvent) => void;
type Bindings = Record<string, Handler>;

/**
 * Register keyboard shortcuts. Ignores keypresses while the user is typing in
 * inputs, textareas, or contentEditable elements — so it never fights inline
 * editors, search boxes, or dialogs.
 *
 * Keys are matched case-insensitively against `event.key`. Prefix with `shift+`
 * to require Shift.
 */
export function useKeyboardShortcuts(bindings: Bindings, enabled = true) {
  const ref = React.useRef(bindings);
  ref.current = bindings;

  React.useEffect(() => {
    if (!enabled) return;
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable) return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const key = (e.shiftKey ? "shift+" : "") + e.key.toLowerCase();
      const fn = ref.current[key];
      if (fn) {
        e.preventDefault();
        fn(e);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [enabled]);
}
