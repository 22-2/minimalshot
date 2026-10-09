import type { ReactNode } from "react";
import * as ContextMenu from "@radix-ui/react-context-menu";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Check, ChevronRight } from "lucide-react";

import type { MenuEntry } from "../lib/viewerMenu";

/** ContextMenu と DropdownMenu は同じ形の部品を持つので、共通の描画処理で両方に使う。 */
type Kit = Pick<
  typeof DropdownMenu,
  "Item" | "CheckboxItem" | "ItemIndicator" | "Separator" | "Sub" | "SubTrigger" | "SubContent" | "Portal"
>;

function Entries({ entries, kit: M }: { entries: MenuEntry[]; kit: Kit }) {
  return entries.map((entry) => {
    switch (entry.type) {
      case "separator":
        return <M.Separator key={entry.id} className="menu-separator" />;
      case "sub":
        return (
          <M.Sub key={entry.id}>
            <M.SubTrigger className="menu-item">
              <entry.icon aria-hidden />
              <span className="menu-label">{entry.label}</span>
              <ChevronRight aria-hidden className="menu-trailing" />
            </M.SubTrigger>
            <M.Portal>
              <M.SubContent className="menu" sideOffset={2}>
                <Entries entries={entry.entries} kit={M} />
              </M.SubContent>
            </M.Portal>
          </M.Sub>
        );
      case "check":
        return (
          <M.CheckboxItem
            key={entry.id}
            className="menu-item"
            checked={entry.checked}
            onCheckedChange={entry.onCheckedChange}
          >
            <entry.icon aria-hidden />
            <span className="menu-label">{entry.label}</span>
            <M.ItemIndicator className="menu-trailing">
              <Check aria-hidden />
            </M.ItemIndicator>
          </M.CheckboxItem>
        );
      case "item":
        return (
          <M.Item
            key={entry.id}
            className="menu-item"
            data-danger={entry.danger || undefined}
            disabled={entry.disabled}
            onSelect={entry.onSelect}
          >
            <entry.icon aria-hidden />
            <span className="menu-label">{entry.label}</span>
          </M.Item>
        );
    }
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
        <DropdownMenu.Content className="menu" align="end" sideOffset={2}>
          <Entries entries={entries} kit={DropdownMenu} />
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
