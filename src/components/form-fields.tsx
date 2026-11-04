import * as React from 'react';
import { FieldError, Input, Label } from '@/components/ui/input';
import { cn } from '@/lib/utils';

type Common = { id: string; label: string; error?: string; hint?: string; className?: string };

export const TextField = React.forwardRef<HTMLInputElement, Common & React.InputHTMLAttributes<HTMLInputElement>>(function TextField(
  { id, label, error, hint, className, ...props },
  ref,
) {
  return (
    <div className={className}>
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} ref={ref} aria-invalid={!!error} aria-describedby={error ? `${id}-err` : hint ? `${id}-hint` : undefined} {...props} />
      {hint && !error && (
        <p id={`${id}-hint`} className="mt-1 text-xs text-muted-foreground">
          {hint}
        </p>
      )}
      <div id={`${id}-err`}>
        <FieldError message={error} />
      </div>
    </div>
  );
});

export const SelectField = React.forwardRef<
  HTMLSelectElement,
  Common & React.SelectHTMLAttributes<HTMLSelectElement> & { options: { id: number; label: string }[]; emptyHint?: string }
>(function SelectField({ id, label, error, hint, className, options, emptyHint, ...props }, ref) {
  const empty = options.length === 0;
  return (
    <div className={className}>
      <Label htmlFor={id}>{label}</Label>
      <select
        id={id}
        ref={ref}
        aria-invalid={!!error}
        disabled={empty || props.disabled}
        className={cn('flex h-9 w-full rounded-md border border-border bg-card px-3 text-sm disabled:opacity-50')}
        {...props}
      >
        <option value="">{empty ? '— none available —' : '— select —'}</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
      {empty && emptyHint && <p className="mt-1 text-xs text-muted-foreground">{emptyHint}</p>}
      {hint && !empty && !error && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      <FieldError message={error} />
    </div>
  );
});
