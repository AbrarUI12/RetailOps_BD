import { useId, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";

import { cn } from "../../lib/utils";

interface FieldShellProps {
  label: string;
  hint?: string;
  error?: string;
  optional?: boolean;
  children: (props: { id: string; describedBy?: string; invalid: boolean }) => ReactNode;
}

/** Label, hint and error wiring shared by every form control. */
export function FieldShell({ children, error, hint, label, optional }: FieldShellProps) {
  const id = useId();
  const messageId = `${id}-message`;
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        {label}
        {optional ? <span className="optional"> (optional)</span> : null}
      </label>
      {children({ id, describedBy: hint || error ? messageId : undefined, invalid: Boolean(error) })}
      {error ? <span className="field-error" id={messageId}>{error}</span> : hint ? <span className="field-hint" id={messageId}>{hint}</span> : null}
    </div>
  );
}

type TextareaFieldProps = TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string; hint?: string; error?: string; optional?: boolean };

export function TextareaField({ className, error, hint, label, optional, ...props }: TextareaFieldProps) {
  return (
    <FieldShell error={error} hint={hint} label={label} optional={optional}>
      {({ describedBy, id, invalid }) => <textarea aria-describedby={describedBy} aria-invalid={invalid} className={cn("textarea", className)} id={id} {...props} />}
    </FieldShell>
  );
}

type SelectFieldProps = SelectHTMLAttributes<HTMLSelectElement> & { label: string; hint?: string; error?: string; optional?: boolean };

/** Native select: fastest on phones and fully keyboard accessible. */
export function SelectField({ children, className, error, hint, label, optional, ...props }: SelectFieldProps) {
  return (
    <FieldShell error={error} hint={hint} label={label} optional={optional}>
      {({ describedBy, id, invalid }) => (
        <select aria-describedby={describedBy} aria-invalid={invalid} className={cn("native-select", className)} id={id} {...props}>
          {children}
        </select>
      )}
    </FieldShell>
  );
}
