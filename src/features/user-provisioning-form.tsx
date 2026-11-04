'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { TextField } from '@/components/form-fields';
import { Button } from '@/components/ui/button';
import { createUserAction } from '@/features/user-provisioning-actions';
import { PASSWORD_MIN, provisionSchema, type ProvisionInput, type ProvisionValues } from '@/lib/user-provisioning';

export function UserProvisioningForm() {
  const router = useRouter();
  const form = useForm<ProvisionInput, unknown, ProvisionValues>({ resolver: zodResolver(provisionSchema) });
  const e = form.formState.errors;

  async function submit(v: ProvisionValues) {
    // The server validates again and checks the caller's permission; this form only saves a round trip.
    const result = await createUserAction({ email: v.email, password: v.password, confirm: v.confirm, student_number: v.student_number, employee_number: v.employee_number });
    form.resetField('password');
    form.resetField('confirm');
    if (!result.ok) return void toast.error(result.error);
    toast.success(`User ${result.email} created. Assign roles next.`);
    router.push(`/admin/users/${result.userId}`);
  }

  return (
    <form onSubmit={form.handleSubmit(submit)} className="max-w-xl space-y-4" noValidate aria-label="Create user" autoComplete="off">
      <TextField id="cu-email" label="Email *" type="email" autoComplete="off" maxLength={254} {...form.register('email')} error={e.email?.message} />
      <TextField id="cu-password" label="Initial password *" type="password" autoComplete="new-password" maxLength={72} hint={`At least ${PASSWORD_MIN} characters with letters and a number. The user should change it after the first sign-in.`} {...form.register('password')} error={e.password?.message} />
      <TextField id="cu-confirm" label="Repeat password *" type="password" autoComplete="new-password" maxLength={72} {...form.register('confirm')} error={e.confirm?.message} />
      <div className="flex flex-wrap gap-3">
        <TextField id="cu-student" label="Link to student number" className="w-52" maxLength={40} hint="Optional" {...form.register('student_number')} error={e.student_number?.message} />
        <TextField id="cu-employee" label="Link to employee number" className="w-52" maxLength={30} hint="Optional" {...form.register('employee_number')} error={e.employee_number?.message} />
      </div>
      <p className="text-xs text-muted-foreground">The new account starts with no roles and can see nothing until you assign one. The email is marked confirmed, so no confirmation mail is sent.</p>
      <Button type="submit" disabled={form.formState.isSubmitting}>{form.formState.isSubmitting ? 'Creating…' : 'Create user'}</Button>
    </form>
  );
}
