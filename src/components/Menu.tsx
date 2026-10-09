import type { ReactNode } from "react";
import * as ContextMenu from "@radix-ui/react-context-menu";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { ChevronRight } from "lucide-react";

import type { MenuEntry } from "../lib/viewerMenu";

/** ContextMenu と DropdownMenu は同じ形の部品を持つので、共通の描画処理で両方に使う。 */
type Kit = Pick<typeof DropdownMenu, "Item" | "Separator" | "Sub" | "SubTrigger" | "SubContent" | "Portal">;

function Entries({ entries, kit: M }: { entries: MenuEntry[]; kit: Kit }) {
  return entries.map((entry) => {
    if (entry.type === "separator") return <M.Separator key={entry.id} className="menu-separator" />;
    if (entry.type === "sub") {
      return (
        <M.Sub key={entry.id}>
          <M.SubTrigger className="menu-item">
            <entry.icon size={14} aria-hidden />
            <span className="menu-label">{entry.label}</span>
            <ChevronRight size={14} aria-hidden className="menu-chevron" />
          </M.SubTrigger>
          <M.Portal>
            <M.SubContent className="menu" sideOffset={2}>
              <Entries entries={entry.entries} kit={M} />
            </M.SubContent>
          </M.Portal>
        </M.Sub>
      );
    }
    return (
      <M.Item
        key={entry.id}
        className="menu-item"
        data-danger={entry.danger || undefined}
        disabled={entry.disabled}
        onSelect={entry.onSelect}
      >
        <entry.icon size={14} aria-hidden />
        <span className="menu-label">{entry.label}</span>
      </M.Item>
    );
  });
}

export function ContextMenuArea({ entries, children }: { entries: MenuEntry[]; children: ReactNode }) {
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>{children}</ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className="menu">
          <Entries entries={entries} kit={ContextMenu as unknown as Kit} />
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

export function DropdownMenuButton({ entries, trigger }: { entries: MenuEntry[]; trigger: ReactNode }) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>{trigger}</DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="menu" side="top" align="start" sideOffset={4}>
          <Entries entries={entries} kit={DropdownMenu} />
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
