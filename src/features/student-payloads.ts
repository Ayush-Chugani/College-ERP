import type { StudentCreateValues, StudentEditValues } from '@/lib/validation';

/** RPC payloads for student_register: only provided fields are sent; the server computes display_name and re-checks authorisation and scope. */
export function buildRegistration(v: StudentCreateValues) {
  const student = {
    student_number: v.student_number,
    first_name: v.first_name,
    middle_name: v.middle_name,
    last_name: v.last_name,
    date_of_birth: v.date_of_birth,
    gender_id: v.gender_id,
    blood_group_id: v.blood_group_id,
    religion_id: v.religion_id,
    social_category_id: v.social_category_id,
    nationality_country_id: v.nationality_country_id,
    primary_email: v.primary_email,
    primary_phone: v.primary_phone,
    notes: v.notes,
  };
  const enrolment =
    v.programme_id !== undefined
      ? {
          programme_id: v.programme_id,
          curriculum_scheme_id: v.curriculum_scheme_id,
          admission_academic_year_id: v.admission_academic_year_id,
          admission_semester_id: v.admission_semester_id,
          admission_date: v.admission_date,
        }
      : null;
  return { student, enrolment };
}

/** Column payload for UPDATE: cleared optional fields are sent as null so they are actually cleared. */
export function buildStudentUpdate(v: StudentEditValues) {
  return {
    student_number: v.student_number,
    first_name: v.first_name,
    middle_name: v.middle_name ?? null,
    last_name: v.last_name ?? null,
    display_name: v.display_name,
    date_of_birth: v.date_of_birth ?? null,
    gender_id: v.gender_id ?? null,
    blood_group_id: v.blood_group_id ?? null,
    religion_id: v.religion_id ?? null,
    social_category_id: v.social_category_id ?? null,
    nationality_country_id: v.nationality_country_id ?? null,
    primary_email: v.primary_email ?? null,
    primary_phone: v.primary_phone ?? null,
    notes: v.notes ?? null,
  };
}
