import * as AlertDialog from "@radix-ui/react-alert-dialog";

type Props = {
  open: boolean;
  title: string;
  description: string;
  cancelLabel: string;
  confirmLabel: string;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
};

export function ConfirmDialog(props: Props) {
  return (
    <AlertDialog.Root open={props.open} onOpenChange={props.onOpenChange}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="dialog-overlay" />
        <AlertDialog.Content className="dialog">
          <AlertDialog.Title className="dialog-title">{props.title}</AlertDialog.Title>
          <AlertDialog.Description className="dialog-description">
            {props.description}
          </AlertDialog.Description>
          <div className="dialog-actions">
            <AlertDialog.Cancel className="button">{props.cancelLabel}</AlertDialog.Cancel>
            <AlertDialog.Action className="button" data-variant="primary" onClick={props.onConfirm}>
              {props.confirmLabel}
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
