import { useId, type ReactNode } from "react";
import * as Select from "@radix-ui/react-select";
import * as Switch from "@radix-ui/react-switch";
import { Check, ChevronsUpDown } from "lucide-react";

/** 設定ページの見出しと説明。 */
export function SettingPage(props: { title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <div className="setting-page">
      <header className="setting-page-header">
        <h2>{props.title}</h2>
        {props.description && <p className="setting-description">{props.description}</p>}
      </header>
      {props.children}
    </div>
  );
}

/** 関連する設定行をひとつの面にまとめる。見出しの右には削除などの操作を置ける。 */
export function SettingGroup(props: { title?: string; description?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="setting-group">
      {(props.title || props.actions) && (
        <header className="setting-group-header">
          {props.title && <h3>{props.title}</h3>}
          {props.actions}
        </header>
      )}
      {props.description && <p className="setting-description setting-group-description">{props.description}</p>}
      <div className="setting-list">{props.children}</div>
    </section>
  );
}

type ControlIds = { id: string; descriptionId?: string };

/**
 * 名前と説明を左、操作を右に置く設定行。
 * 操作には id と説明の id を渡し、名前の label と説明を結び付けられるようにする。
 * 入力欄のように幅が要る操作は stacked で名前の下に全幅で置く。
 */
export function SettingItem(props: {
  name: ReactNode;
  description?: ReactNode;
  stacked?: boolean;
  children: (ids: ControlIds) => ReactNode;
}) {
  const id = useId();
  const descriptionId = useId();
  const ids = { id, descriptionId: props.description ? descriptionId : undefined };
  return (
    <div className="setting-item" data-stacked={props.stacked || undefined}>
      <div className="setting-info">
        <label className="setting-name" htmlFor={id}>{props.name}</label>
        {props.description && <p className="setting-description" id={descriptionId}>{props.description}</p>}
      </div>
      <div className="setting-control">{props.children(ids)}</div>
    </div>
  );
}

/** 説明だけを示す行。登録が無いときの案内などに使う。 */
export function SettingNotice({ children }: { children: ReactNode }) {
  return <div className="setting-item setting-notice">{children}</div>;
}

export function Toggle(props: ControlIds & { checked: boolean; disabled?: boolean; onChange: (checked: boolean) => void }) {
  return (
    <Switch.Root
      id={props.id}
      className="switch"
      aria-describedby={props.descriptionId}
      checked={props.checked}
      disabled={props.disabled}
      onCheckedChange={props.onChange}
    >
      <Switch.Thumb className="switch-thumb" />
    </Switch.Root>
  );
}

export function TextInput(props: ControlIds & { value: string; placeholder?: string; onChange: (value: string) => void }) {
  return (
    <input
      id={props.id}
      className="text-input"
      aria-describedby={props.descriptionId}
      spellCheck={false}
      placeholder={props.placeholder}
      value={props.value}
      onChange={(event) => props.onChange(event.target.value)}
    />
  );
}

export function Dropdown<T extends string>(props: ControlIds & {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <Select.Root value={props.value} onValueChange={(value) => props.onChange(value as T)}>
      <Select.Trigger id={props.id} className="select-trigger" aria-describedby={props.descriptionId}>
        <Select.Value />
        <Select.Icon className="select-icon">
          <ChevronsUpDown aria-hidden />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content className="menu select-content" position="popper" sideOffset={2} align="end">
          <Select.Viewport>
            {props.options.map((option) => (
              <Select.Item key={option.value} value={option.value} className="menu-item">
                <Select.ItemText>{option.label}</Select.ItemText>
                <Select.ItemIndicator className="menu-trailing">
                  <Check aria-hidden />
                </Select.ItemIndicator>
              </Select.Item>
            ))}
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
}
