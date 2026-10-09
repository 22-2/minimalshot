import { forwardRef, type ComponentPropsWithoutRef } from "react";
import * as Tooltip from "@radix-ui/react-tooltip";
import type { LucideIcon } from "lucide-react";

type Props = Omit<ComponentPropsWithoutRef<"button">, "children"> & {
  icon: LucideIcon;
  label: string;
  pressed?: boolean;
  danger?: boolean;
};

/**
 * アイコンだけのボタン。見た目に文字が無いので、名前は aria-label とツールチップで付ける。
 * ドロップダウンの Trigger（asChild）にもなれるよう、ref と残りの props をボタンへ渡す。
 */
export const IconButton = forwardRef<HTMLButtonElement, Props>(function IconButton(
  { icon: Icon, label, pressed, danger, ...rest },
  ref,
) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <button
          ref={ref}
          type="button"
          className="icon-button"
          aria-label={label}
          aria-pressed={pressed}
          data-danger={danger || undefined}
          {...rest}
        >
          <Icon size={14} aria-hidden />
        </button>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content className="tooltip" side="top" sideOffset={4}>
          {label}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
});
