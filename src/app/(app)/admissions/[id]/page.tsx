import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getApplicant, getApplication, getStudentLabel, loadAdmissionLookups, parseApplicationId } from '@/features/admission-data';
import { AdmitForm, ApplicantEditForm, ApplicationEditForm, StatusActions } from '@/features/admission-forms';
import { canAdmit, nextStatuses, TERMINAL, type ApplicantEditInput, type ApplicationEditInput } from '@/lib/admission-validation';
import { can } from '@/lib/context';
import { requireContext } from '@/lib/server-context';

export const metadata: Metadata = { title: 'Application' };

export default async function ApplicationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const id = parseApplicationId((await params).id);
  if (id === null) notFound();
  const { supabase, ctx } = await requireContext();
  const app = await getApplication(supabase, id);
  if (!app) notFound(); // missing or not visible: same response
  const [applicant, lookups, student] = await Promise.all([
    getApplicant(supabase, app.admission_applicant_id),
    loadAdmissionLookups(supabase),
    app.admitted_student_id ? getStudentLabel(supabase, app.admitted_student_id) : Promise.resolve(null),
  ]);
  const has = (code: string) => can(ctx, code);
  const next = nextStatuses(app.application_status, has);
  const terminal = (TERMINAL as readonly string[]).includes(app.application_status);
  const canEdit = has('ADMISSION.ALL.UPDATE') && !terminal;
  const programme = lookups.programmes.find((p) => p.id === app.programme_id)?.label ?? `#${app.programme_id}`;
  const year = lookups.years.find((y) => y.id === app.academic_year_id)?.label ?? `#${app.academic_year_id}`;
  const category = lookups.categories.find((c) => c.id === app.admission_category_id)?.label ?? (app.admission_category_id ? `#${app.admission_category_id}` : '—');
  const str = (v: string | number | null | undefined) => (v == null ? '' : String(v));

  const applicantDefaults: ApplicantEditInput | null = applicant && {
    first_name: applicant.first_name, middle_name: str(applicant.middle_name), last_name: str(applicant.last_name), date_of_birth: str(applicant.date_of_birth),
    gender_id: str(applicant.gender_id), primary_email: str(applicant.primary_email), primary_phone: str(applicant.primary_phone),
    nationality_country_id: str(applicant.nationality_country_id), social_category_id: str(applicant.social_category_id),
  };
  const applicationDefaults: ApplicationEditInput = { admission_category_id: str(app.admission_category_id), remarks: str(app.remarks) };

  const rows: [string, string][] = [
    ['Programme', programme],
    ['Academic year', year],
    ['Application date', app.application_date],
    ['Category', category],
    ['Eligibility', app.eligibility_status],
  ];

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{app.application_number}</h1>
          <p className="text-sm text-muted-foreground">
            {applicant?.display_name ?? 'Applicant'} · Status: <span className="font-medium text-foreground">{app.application_status}</span>
          </p>
        </div>
        <Link href="/admissions" className="inline-flex h-9 items-center rounded-md border border-border bg-card px-4 text-sm hover:bg-muted">Back to list</Link>
      </div>

      <Card>
        <CardHeader><CardTitle>Application</CardTitle></CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-[11rem_1fr]">
            {rows.map(([k, v]) => (<div key={k} className="contents"><dt className="text-muted-foreground">{k}</dt><dd>{v}</dd></div>))}
            {student && (
              <div className="contents">
                <dt className="text-muted-foreground">Admitted as</dt>
                <dd><Link href={`/students/${app.admitted_student_id}`} className="text-primary underline-offset-4 hover:underline">{student.number} — {student.name}</Link></dd>
              </div>
            )}
          </dl>
          {canEdit && (
            <div className="mt-4 border-t border-border pt-4">
              <ApplicationEditForm applicationId={id} defaults={applicationDefaults} categories={lookups.categories} />
            </div>
          )}
          {!canEdit && app.remarks && <p className="mt-3 whitespace-pre-wrap text-sm"><span className="text-muted-foreground">Remarks: </span>{app.remarks}</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Status</CardTitle></CardHeader>
        <CardContent>
          <StatusActions applicationId={id} current={app.application_status} next={next} />
        </CardContent>
      </Card>

      {canAdmit(app.application_status, has) && (
        <Card>
          <CardHeader><CardTitle>Admit as student</CardTitle></CardHeader>
          <CardContent><AdmitForm applicationId={id} programmeId={app.programme_id} lookups={lookups} /></CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle>{canEdit && applicantDefaults ? 'Applicant details' : 'Applicant'}</CardTitle></CardHeader>
        <CardContent>
          {!applicant ? (
            <p className="text-sm text-muted-foreground">Applicant details are not available.</p>
          ) : canEdit && applicantDefaults ? (
            <ApplicantEditForm applicantId={applicant.admission_applicant_id} defaults={applicantDefaults} lookups={lookups} />
          ) : (
            <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-[11rem_1fr]">
              {([['Name', applicant.display_name], ['Date of birth', applicant.date_of_birth ?? '—'], ['Email', applicant.primary_email ?? '—'], ['Phone', applicant.primary_phone ?? '—']] as [string, string][]).map(([k, v]) => (
                <div key={k} className="contents"><dt className="text-muted-foreground">{k}</dt><dd>{v}</dd></div>
              ))}
            </dl>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
