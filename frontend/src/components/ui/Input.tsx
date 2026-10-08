import { useId, type InputHTMLAttributes } from "react";

import { cn } from "../../lib/utils";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  hint?: string;
  error?: string;
}

export function Input({ className, error, hint, id, label, ...props }: InputProps) {
  const generatedId = useId();
  // Every input gets an id so its label is always programmatically associated.
  const inputId = id ?? props.name ?? generatedId;
  const messageId = inputId ? `${inputId}-message` : undefined;

  return (
    <div className="field">
      {label ? <label className="field-label" htmlFor={inputId}>{label}</label> : null}
      <input
        aria-describedby={hint || error ? messageId : undefined}
        aria-invalid={Boolean(error)}
        className={cn("input", error && "input-error", className)}
        id={inputId}
        {...props}
      />
      {error ? <span className="field-error" id={messageId}>{error}</span> : null}
      {!error && hint ? <span className="field-hint" id={messageId}>{hint}</span> : null}
    </div>
  );
}

