import { useEffect, useRef } from "react";

// Platform parity id: context-menu-native.
//
// Lightweight native-styled context menu. Renders a fixed-position popover at
// the click point, dismisses on outside click / Escape / scroll. The CSS hooks
// match the rest of the workspace chrome (--ss-bg-2, --ss-line-2, --ss-radius-md)
// so the menu inherits the same palette swap when the OS theme flips light/dark.

export interface ContextMenuItem {
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  destructive?: boolean;
  /** Optional inline shortcut label (e.g. "⌘C"). Rendered right-aligned. */
  shortcut?: string;
}

interface Props {
  /** Viewport coordinates of the originating event. */
  x: number;
  y: number;
  items: ContextMenuItem[];
  onDismiss: () => void;
}

export function ContextMenu({ x, y, items, onDismiss }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!ref.current) return;
      if (event.target instanceof Node && ref.current.contains(event.target)) return;
      onDismiss();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onDismiss();
    };
    const onScroll = () => onDismiss();
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [onDismiss]);

  // Clamp into viewport so the menu doesn't get clipped near the right/bottom edge.
  const clampedX = Math.min(x, (typeof window !== "undefined" ? window.innerWidth : 9999) - 220);
  const clampedY = Math.min(
    y,
    (typeof window !== "undefined" ? window.innerHeight : 9999) - items.length * 32 - 16,
  );

  return (
    <div ref={ref} role="menu" className="context-menu" style={{ top: clampedY, left: clampedX }}>
      {items.map((item, idx) => (
        <button
          key={idx}
          type="button"
          role="menuitem"
          disabled={item.disabled}
          className={
            "context-menu__item" + (item.destructive ? " context-menu__item--destructive" : "")
          }
          onClick={() => {
            item.onSelect();
            onDismiss();
          }}
        >
          <span>{item.label}</span>
          {item.shortcut && <span className="context-menu__shortcut">{item.shortcut}</span>}
        </button>
      ))}
    </div>
  );
}
