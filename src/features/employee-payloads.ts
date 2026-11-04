import type { AssignValues, EmployeeCreateValues, EmployeeEditValues } from '@/lib/employee-validation';

/** RPC payloads for employee_register. display_name is computed by the database; the institution is re-checked against the caller's scope there. */
export function buildEmployeeRegistration(v: EmployeeCreateValues) {
  const employee = {
    institution_id: v.institution_id,
    employee_number: v.employee_number,
    first_name: v.first_name,
    middle_name: v.middle_name,
    last_name: v.last_name,
    employment_source_id: v.employment_source_id,
    employment_type: v.employment_type,
    joining_date: v.joining_date,
    date_of_birth: v.date_of_birth,
    gender_id: v.gender_id,
    blood_group_id: v.blood_group_id,
    religion_id: v.religion_id,
    social_category_id: v.social_category_id,
    nationality_country_id: v.nationality_country_id,
    primary_email: v.primary_email,
    primary_phone: v.primary_phone,
  };
  const assignment =
    v.campus_id !== undefined
      ? { campus_id: v.campus_id, department_id: v.department_id, designation_id: v.designation_id, start_date: v.start_date, is_primary: true }
      : null;
  return { employee, assignment };
}

/** UPDATE payload. institution_id and employment_status are deliberately absent (immutable / changed through the status control). */
export function buildEmployeeUpdate(v: EmployeeEditValues) {
  return {
    employee_number: v.employee_number,
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
    employment_source_id: v.employment_source_id,
    employment_type: v.employment_type,
    joining_date: v.joining_date,
  };
}

export function buildAssignArgs(employeeId: number, v: AssignValues) {
  return {
    p_employee_id: employeeId,
    p_campus_id: v.campus_id,
    p_department_id: v.department_id ?? null,
    p_designation_id: v.designation_id,
    p_start_date: v.start_date,
    p_is_primary: v.is_primary,
    p_end_current: v.end_current,
  };
}
