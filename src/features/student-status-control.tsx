'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { createClient } from '@/lib/supabase/client';
import { STUDENT_STATUSES, type StudentStatus } from '@/lib/validation';

/** Deactivate / reactivate / change status with an explicit confirmation step. Records are never hard-deleted. */
export function StudentStatusControl({ studentId, current }: { studentId: number; current: string }) {
  const router = useRouter();
  const [target, setTarget] = useState<StudentStatus | ''>('');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  async function apply() {
    if (!target) return;
    setBusy(true);
    const supabase = createClient();
    const { data, error } = await supabase.from('student').update({ student_status: target }).eq('student_id', studentId).select('student_id');
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
          <label htmlFor="status" className="mb-1 block text-sm font-medium">
            Change status
          </label>
          <select
            id="status"
            value={target}
            onChange={(e) => {
              setTarget(e.target.value as StudentStatus | '');
              setConfirming(false);
            }}
            className="h-9 rounded-md border border-border bg-card px-3 text-sm"
          >
            <option value="">— select —</option>
            {STUDENT_STATUSES.filter((s) => s !== current).map((s) => (
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
            <Button type="button" variant={target === 'WITHDRAWN' || target === 'DECEASED' ? 'destructive' : 'default'} disabled={busy} onClick={apply}>
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
