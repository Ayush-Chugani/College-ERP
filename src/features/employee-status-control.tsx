'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { EMPLOYMENT_STATUSES, type EmploymentStatus } from '@/lib/employee-validation';
import { createClient } from '@/lib/supabase/client';

const SEVERE: EmploymentStatus[] = ['TERMINATED', 'RESIGNED', 'RETIRED'];

/** Employment status change with explicit confirmation. Records are never hard-deleted. */
export function EmployeeStatusControl({ employeeId, current }: { employeeId: number; current: string }) {
  const router = useRouter();
  const [target, setTarget] = useState<EmploymentStatus | ''>('');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  async function apply() {
    if (!target) return;
    setBusy(true);
    const supabase = createClient();
    const { data, error } = await supabase.from('employee').update({ employment_status: target }).eq('employee_id', employeeId).select('employee_id');
    setBusy(false);
    if (error || !data || data.length === 0) {
      toast.error('The status could not be changed. You may not have permission.');
      return;
    }
    toast.success(`Status changed to ${target}.`);
    setConfirming(false);
    setTarget('');
    router.refresh();
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <label htmlFor="emp-status" className="mb-1 block text-sm font-medium">
            Change status
          </label>
          <select
            id="emp-status"
            value={target}
            onChange={(e) => {
              setTarget(e.target.value as EmploymentStatus | '');
              setConfirming(false);
            }}
            className="h-9 rounded-md border border-border bg-card px-3 text-sm"
          >
            <option value="">— select —</option>
            {EMPLOYMENT_STATUSES.filter((s) => s !== current).map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <Button type="button" variant="outline" disabled={!target || confirming} onClick={() => setConfirming(true)}>
          Change…
        </Button>
      </div>
      {confirming && target && (
        <div role="alertdialog" aria-label="Confirm status change" className="rounded-md border border-border bg-muted p-3 text-sm">
          <p className="mb-2">
            Change status from <strong>{current}</strong> to <strong>{target}</strong>? This is recorded in the audit log.
          </p>
          <div className="flex gap-2">
            <Button type="button" variant={SEVERE.includes(target) ? 'destructive' : 'default'} disabled={busy} onClick={apply}>
              {busy ? 'Applying…' : 'Confirm'}
            </Button>
            <Button type="button" variant="outline" disabled={busy} onClick={() => setConfirming(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
