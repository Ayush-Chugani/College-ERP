'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import type { ScopeOpts } from '@/features/iam-data';
import { createClient } from '@/lib/supabase/client';

export type Override = { id: number; permission: string; effect: string; scope_type: string; scope: string | null; valid_from: string; valid_to: string | null; active: boolean; justification: string; granted_by: string | null };
type PermOpt = { permission_code: string; permission_name: string; is_sensitive: boolean };
const sel = 'flex h-9 w-full rounded-md border border-border bg-card px-3 text-sm';
const msg = (e: { code?: string; message: string }, fb: string) => (['22023', '45000', '42501'].includes(e.code ?? '') ? e.message : fb);

/** Per-user permission overrides (migration 057). The database enforces who may grant what; this only lists, adds and ends. */
export function OverridePanel({ userId, overrides, scopes, disabled }: { userId: number; overrides: Override[]; scopes: ScopeOpts; disabled: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState('');
  const [opts, setOpts] = useState<PermOpt[]>([]);
  const [f, setF] = useState({ perm: '', effect: 'DENY', scope: 'GLOBAL', entity: '', just: '' });
  const supabase = createClient();
  async function search(text: string) {
    setQ(text);
    if (text.trim().length < 2) return void setOpts([]);
    const { data } = await supabase.rpc('iam_permission_options', { p_search: text.trim() });
    setOpts((data ?? []) as PermOpt[]);
  }
  async function add() {
    setBusy(true);
    const { error } = await supabase.rpc('iam_override_set', { p_user_id: userId, p_permission_code: f.perm, p_effect: f.effect, p_scope_type: f.scope, p_scope_entity_id: f.entity ? Number(f.entity) : null, p_justification: f.just, p_valid_to: null });
    setBusy(false);
    if (error) return void toast.error(msg(error, 'The override could not be saved.'));
    toast.success('Override saved.');
    setF({ ...f, perm: '', just: '' });
    setQ('');
    setOpts([]);
    router.refresh();
  }
  async function end(o: Override) {
    const reason = window.prompt(`End this ${o.effect} on ${o.permission}? Give a reason:`);
    if (reason === null) return;
    setBusy(true);
    const { error } = await supabase.rpc('iam_override_end', { p_override_id: o.id, p_reason: reason });
    setBusy(false);
    if (error) return void toast.error(msg(error, 'The override could not be ended.'));
    toast.success('Override ended.');
    router.refresh();
  }
  const entities = f.scope === 'GLOBAL' || f.scope === 'SELF' ? [] : scopes[f.scope as keyof ScopeOpts] ?? [];
  return (
    <div className="space-y-3">
      {overrides.length === 0 ? <p className="text-sm text-muted-foreground">No overrides. The person has exactly what their roles give them.</p> : (
        <ul className="divide-y divide-border text-sm">
          {overrides.map((o) => (
            <li key={o.id} className="flex flex-wrap items-start justify-between gap-2 py-2">
              <span><span className="font-mono">{o.permission}</span> · <span className="font-medium">{o.effect}</span> · {o.scope_type.toLowerCase()}{o.scope ? ` · ${o.scope}` : ''} · {o.active ? 'active' : 'ended'}<span className="text-muted-foreground"> · {o.justification}{o.granted_by ? ` · by ${o.granted_by}` : ''}</span></span>
              {o.active && !disabled && <Button type="button" variant="outline" disabled={busy} onClick={() => end(o)}>End…</Button>}
            </li>
          ))}
        </ul>
      )}
      {disabled ? <p className="text-sm text-muted-foreground">You cannot change your own permissions.</p> : (
        <div className="space-y-3 border-t border-border pt-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-72"><label htmlFor="ov-q" className="text-sm font-medium">Find a permission *</label><input id="ov-q" className={sel} value={q} placeholder="e.g. FEES.FEE_PAYMENT" onChange={(e) => void search(e.target.value)} /></div>
            <div className="w-80 max-w-full"><label htmlFor="ov-p" className="text-sm font-medium">Permission *</label>
              <select id="ov-p" className={sel} value={f.perm} onChange={(e) => setF({ ...f, perm: e.target.value })}><option value="">{opts.length ? 'Choose…' : 'Search first'}</option>{opts.map((o) => <option key={o.permission_code} value={o.permission_code}>{o.permission_code}{o.is_sensitive ? ' (sensitive)' : ''}</option>)}</select></div>
            <div className="w-28"><label htmlFor="ov-e" className="text-sm font-medium">Effect</label><select id="ov-e" className={sel} value={f.effect} onChange={(e) => setF({ ...f, effect: e.target.value })}><option value="DENY">Deny</option><option value="ALLOW">Allow</option></select></div>
            <div className="w-36"><label htmlFor="ov-s" className="text-sm font-medium">Scope</label><select id="ov-s" className={sel} value={f.scope} onChange={(e) => setF({ ...f, scope: e.target.value, entity: '' })}>{['GLOBAL', 'INSTITUTION', 'CAMPUS', 'DEPARTMENT', 'PROGRAMME', 'SELF'].map((s) => <option key={s} value={s}>{s.charAt(0) + s.slice(1).toLowerCase()}</option>)}</select></div>
            {entities.length > 0 && <div className="w-56"><label htmlFor="ov-n" className="text-sm font-medium">Which one *</label><select id="ov-n" className={sel} value={f.entity} onChange={(e) => setF({ ...f, entity: e.target.value })}><option value="">Select…</option>{entities.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</select></div>}
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-96 max-w-full"><label htmlFor="ov-j" className="text-sm font-medium">Justification *</label><input id="ov-j" maxLength={500} className={sel} value={f.just} onChange={(e) => setF({ ...f, just: e.target.value })} /></div>
            <Button type="button" disabled={busy || !f.perm || !f.just.trim()} onClick={add}>Add override</Button>
          </div>
          <p className="text-xs text-muted-foreground">A deny always wins over a role. Allowing a sensitive, IAM or audit permission needs a super administrator.</p>
        </div>
      )}
    </div>
  );
}
