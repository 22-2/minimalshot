import { useId, useState, type ReactNode } from "react";
import * as Select from "@radix-ui/react-select";
import * as Switch from "@radix-ui/react-switch";
import { Check, ChevronRight, ChevronsUpDown } from "lucide-react";

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

/** 関連する設定行をひとつの面にまとめる。 */
export function SettingGroup({ children }: { children: ReactNode }) {
  return <div className="setting-list">{children}</div>;
}

/**
 * 開閉できる設定のまとまり。閉じたままでも今の値を読めるよう、見出しの右に summary を置く。
 * 同じ名前の行が並ぶまとまりどうしを読み上げでも区別できるよう、中身は見出しの名前を持つ region にする。
 */
export function SettingDisclosure(props: { title: string; leading?: ReactNode; summary?: ReactNode; defaultOpen?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(props.defaultOpen ?? false);
  const titleId = useId();
  const panelId = useId();
  return (
    <section className="setting-disclosure" data-open={open || undefined}>
      <h3 className="setting-disclosure-heading">
        <button
          type="button"
          className="setting-disclosure-trigger"
          aria-expanded={open}
          aria-controls={open ? panelId : undefined}
          onClick={() => setOpen(!open)}
        >
          <ChevronRight className="setting-disclosure-chevron" aria-hidden />
          {props.leading && <><span className="setting-disclosure-leading">{props.leading}</span>{" "}</>}
          <span className="setting-disclosure-title" id={titleId}>{props.title}</span>
          {/* 読み上げで名前と値がつながらないよう空白を挟む。flex の中なので見た目には影響しない */}
          {props.summary && <>{" "}<span className="setting-disclosure-summary">{props.summary}</span></>}
        </button>
      </h3>
      {open && (
        <div id={panelId} className="setting-disclosure-panel" role="region" aria-labelledby={titleId}>
          {props.children}
        </div>
      )}
    </section>
  );
}

type ControlIds = { id: string; labelId?: string; descriptionId?: string };

/**
 * 名前と説明を左、操作を右に置く設定行。
 * 操作には id と説明の id を渡し、名前の label と説明を結び付けられるようにする。
 * 入力欄のように幅が要る操作は stacked で名前の下に全幅で置く。
 */
export function SettingItem(props: {
  name: ReactNode;
  description?: ReactNode;
  stacked?: boolean;
  modified?: boolean;
  children: (ids: ControlIds) => ReactNode;
}) {
  const id = useId();
  const labelId = useId();
  const descriptionId = useId();
  const ids = { id, labelId, descriptionId: props.description ? descriptionId : undefined };
  return (
    <div className="setting-item" data-stacked={props.stacked || undefined} data-modified={props.modified || undefined}>
      <div className="setting-info">
        <label className="setting-name" id={labelId} htmlFor={id}>{props.name}</label>
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
