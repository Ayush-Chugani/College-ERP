import { z } from 'zod';

const roleSchema = z.object({
  role_code: z.string(),
  role_name: z.string(),
  scope_type: z.string(),
  institution_id: z.number().nullable(),
  campus_id: z.number().nullable(),
  department_id: z.number().nullable(),
  programme_id: z.number().nullable(),
});

export const contextSchema = z.object({
  user_id: z.number(),
  username: z.string(),
  email: z.string().nullable(),
  student_id: z.number().nullable(),
  employee_id: z.number().nullable(),
  /** True when the person holds a role that requires two-step verification and has not enrolled yet (migration 058). */
  mfa_setup_required: z.boolean().default(false),
  roles: z.array(roleSchema),
  readable_modules: z.array(z.string()),
  /** ALLOW permission codes at non-SELF scopes. Used only to hide actions; the database enforces access. */
  permissions: z.array(z.string()).default([]),
});
export type SimsContext = z.infer<typeof contextSchema>;

/** Parse the my_context() RPC payload; null means "no active SIMS identity". */
export function parseContext(raw: unknown): SimsContext | null {
  if (raw === null || raw === undefined) return null;
  const r = contextSchema.safeParse(raw);
  return r.success ? r.data : null;
}

/** UI hint: does the caller hold this permission (at any non-SELF scope)? Never an authorisation decision. */
export function can(ctx: SimsContext, code: string): boolean {
  return ctx.permissions.includes(code);
}
