-- REVIEW REVISION: 2026-09-14. Read SIMS_schema_review.md before installation.
-- Full schema for an EMPTY database only; not an upgrade migration.
-- Static review completed; execution on MySQL and Django integration remain required.
-- Select a database created with utf8mb4 / utf8mb4_0900_ai_ci before sourcing.
-- Use mysql without --force. MySQL DDL is not one rollbackable transaction.
-- Tenant authorization MUST use a context-aware service, not a view alone.
-- Legacy RBAC catalogue is retained for reconciliation; user migration is separate.

-- =============================================================
-- STUDENT INFORMATION MANAGEMENT SYSTEM (SIMS)
-- Version 6.5.1 REVIEW CANDIDATE - Django Auth Plugin-Ready Modular Monolith - MySQL 8.0.16+
-- Enforces programme-specialization ownership, deterministic nullable uniqueness,
-- section/batch/course ownership, attendance rosters, assessment-course integrity,
-- HR single-current rules, RBAC scope/effective permissions, unified admission payments,
-- and financial arithmetic/allocation/refund/benefit integrity.
-- Extended with Employee Qualification, Experience, Bank, PAN, Aadhaar and Evidence Management
-- Naming: singular snake_case; PK: <table>_id; FK: referenced PK name
-- Character set: utf8mb4; Engine: InnoDB; Timezone recommended: UTC
-- =============================================================

-- CREATE DATABASE IF NOT EXISTS sims_v6
--  CHARACTER SET utf8mb4
--  COLLATE utf8mb4_0900_ai_ci;
--  USE sims_v6;

SET NAMES utf8mb4 COLLATE utf8mb4_0900_ai_ci;
SET SESSION time_zone = '+00:00';
SET FOREIGN_KEY_CHECKS = 1;

-- =============================================================
-- 1. COMMON REFERENCE MODULE
-- =============================================================
CREATE TABLE country (
    country_id SMALLINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    iso_code CHAR(2) NOT NULL UNIQUE,
    country_name VARCHAR(100) NOT NULL UNIQUE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE state (
    state_id SMALLINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    country_id SMALLINT UNSIGNED NOT NULL,
    state_code VARCHAR(10) NOT NULL,
    state_name VARCHAR(100) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    CONSTRAINT uq_state_country_code UNIQUE (country_id, state_code),
    CONSTRAINT uq_state_country_name UNIQUE (country_id, state_name),
    CONSTRAINT fk_state_country FOREIGN KEY (country_id) REFERENCES country(country_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE gender (
    gender_id TINYINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    gender_code VARCHAR(20) NOT NULL UNIQUE,
    gender_name VARCHAR(50) NOT NULL UNIQUE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE blood_group (
    blood_group_id TINYINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    blood_group_code VARCHAR(5) NOT NULL UNIQUE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE religion (
    religion_id SMALLINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    religion_code VARCHAR(20) NULL UNIQUE,
    religion_name VARCHAR(100) NOT NULL UNIQUE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE social_category (
    social_category_id SMALLINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    category_code VARCHAR(20) NOT NULL UNIQUE,
    category_name VARCHAR(100) NOT NULL UNIQUE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE caste (
    caste_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    social_category_id SMALLINT UNSIGNED NULL,
    caste_code VARCHAR(30) NULL UNIQUE,
    caste_name VARCHAR(150) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    CONSTRAINT uq_caste_name_category UNIQUE (social_category_id, caste_name),
    CONSTRAINT fk_caste_social_category FOREIGN KEY (social_category_id) REFERENCES social_category(social_category_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE sub_caste (
    sub_caste_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    caste_id INT UNSIGNED NOT NULL,
    sub_caste_code VARCHAR(30) NULL,
    sub_caste_name VARCHAR(150) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    CONSTRAINT uq_sub_caste UNIQUE (caste_id, sub_caste_name),
    CONSTRAINT fk_sub_caste_caste FOREIGN KEY (caste_id) REFERENCES caste(caste_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE admission_category (
    admission_category_id SMALLINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    category_code VARCHAR(30) NOT NULL UNIQUE,
    category_name VARCHAR(100) NOT NULL UNIQUE,
    description VARCHAR(500) NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE document_type (
    document_type_id SMALLINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    document_code VARCHAR(30) NOT NULL UNIQUE,
    document_name VARCHAR(100) NOT NULL UNIQUE,
    requires_verification BOOLEAN NOT NULL DEFAULT TRUE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- =============================================================
-- 2. UNIVERSITY AND INSTITUTION STRUCTURE MODULE
-- =============================================================
CREATE TABLE university (
    university_id SMALLINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    university_code VARCHAR(30) NOT NULL UNIQUE,
    university_name VARCHAR(200) NOT NULL,
    legal_name VARCHAR(250) NULL,
    university_type ENUM('CENTRAL','STATE','PRIVATE','DEEMED','OTHER') NOT NULL DEFAULT 'OTHER',
    website_url VARCHAR(255) NULL,
    email VARCHAR(254) NULL,
    phone VARCHAR(25) NULL,
    address_line_1 VARCHAR(200) NULL,
    address_line_2 VARCHAR(200) NULL,
    city VARCHAR(100) NULL,
    state_id SMALLINT UNSIGNED NULL,
    postal_code VARCHAR(12) NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_university_state FOREIGN KEY (state_id) REFERENCES state(state_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE institution (
    institution_id SMALLINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    university_id SMALLINT UNSIGNED NOT NULL,
    institution_code VARCHAR(20) NOT NULL UNIQUE,
    institution_name VARCHAR(200) NOT NULL,
    legal_name VARCHAR(250) NULL,
    website_url VARCHAR(255) NULL,
    email VARCHAR(254) NULL,
    phone VARCHAR(25) NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_institution_university FOREIGN KEY (university_id) REFERENCES university(university_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE campus (
    campus_id SMALLINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    institution_id SMALLINT UNSIGNED NOT NULL,
    campus_code VARCHAR(20) NOT NULL,
    campus_name VARCHAR(150) NOT NULL,
    address_line_1 VARCHAR(200) NULL,
    address_line_2 VARCHAR(200) NULL,
    city VARCHAR(100) NULL,
    state_id SMALLINT UNSIGNED NULL,
    postal_code VARCHAR(12) NULL,
    phone VARCHAR(25) NULL,
    email VARCHAR(254) NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    CONSTRAINT uq_campus_code UNIQUE (institution_id, campus_code),
    CONSTRAINT fk_campus_institution FOREIGN KEY (institution_id) REFERENCES institution(institution_id),
    CONSTRAINT fk_campus_state FOREIGN KEY (state_id) REFERENCES state(state_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE department (
    department_id SMALLINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    campus_id SMALLINT UNSIGNED NOT NULL,
    department_code VARCHAR(20) NOT NULL,
    department_name VARCHAR(150) NOT NULL,
    department_type VARCHAR(30) NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    CONSTRAINT uq_department_code UNIQUE (campus_id, department_code),
    CONSTRAINT uq_department_id_campus UNIQUE (department_id, campus_id),
    CONSTRAINT fk_department_campus FOREIGN KEY (campus_id) REFERENCES campus(campus_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE programme (
    programme_id SMALLINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    department_id SMALLINT UNSIGNED NOT NULL,
    programme_code VARCHAR(30) NOT NULL UNIQUE,
    programme_name VARCHAR(150) NOT NULL,
    award_name VARCHAR(150) NULL,
    programme_level ENUM('UG','PG','DIPLOMA','CERTIFICATE','DOCTORAL','OTHER') NOT NULL,
    duration_semesters TINYINT UNSIGNED NOT NULL,
    maximum_duration_semesters TINYINT UNSIGNED NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    CONSTRAINT chk_programme_duration CHECK (duration_semesters > 0
        AND (maximum_duration_semesters IS NULL OR maximum_duration_semesters >= duration_semesters)),
    CONSTRAINT fk_programme_department FOREIGN KEY (department_id) REFERENCES department(department_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE programme_specialization (
    specialization_id SMALLINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    programme_id SMALLINT UNSIGNED NOT NULL,
    specialization_code VARCHAR(30) NOT NULL,
    specialization_name VARCHAR(150) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    CONSTRAINT uq_specialization_code UNIQUE (programme_id, specialization_code),
    CONSTRAINT uq_specialization_programme UNIQUE (specialization_id, programme_id),
    CONSTRAINT fk_specialization_programme FOREIGN KEY (programme_id) REFERENCES programme(programme_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE building (
    building_id SMALLINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    campus_id SMALLINT UNSIGNED NOT NULL,
    building_code VARCHAR(20) NOT NULL,
    building_name VARCHAR(100) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    CONSTRAINT uq_building_code UNIQUE (campus_id, building_code),
    CONSTRAINT fk_building_campus FOREIGN KEY (campus_id) REFERENCES campus(campus_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE room (
    room_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    building_id SMALLINT UNSIGNED NOT NULL,
    room_code VARCHAR(20) NOT NULL,
    room_name VARCHAR(100) NULL,
    room_type ENUM('CLASSROOM','LAB','SEMINAR_HALL','AUDITORIUM','OFFICE','OTHER') NOT NULL,
    capacity SMALLINT UNSIGNED NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    CONSTRAINT uq_room_code UNIQUE (building_id, room_code),
    CONSTRAINT fk_room_building FOREIGN KEY (building_id) REFERENCES building(building_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- =============================================================
-- 3. ACADEMIC CALENDAR MODULE
-- =============================================================
CREATE TABLE academic_year (
    academic_year_id SMALLINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    year_code VARCHAR(9) NOT NULL UNIQUE,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    status ENUM('PLANNED','ACTIVE','CLOSED') NOT NULL DEFAULT 'PLANNED',
    CONSTRAINT chk_academic_year_dates CHECK (end_date > start_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE academic_term (
    academic_term_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    academic_year_id SMALLINT UNSIGNED NOT NULL,
    term_code VARCHAR(20) NOT NULL,
    term_name VARCHAR(100) NOT NULL,
    term_type ENUM('ODD','EVEN','SUMMER','ANNUAL','OTHER') NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    registration_start_date DATE NULL,
    registration_end_date DATE NULL,
    status ENUM('PLANNED','REGISTRATION_OPEN','ACTIVE','CLOSED') NOT NULL DEFAULT 'PLANNED',
    CONSTRAINT uq_term_code UNIQUE (academic_year_id, term_code),
    CONSTRAINT chk_term_dates CHECK (end_date >= start_date),
    CONSTRAINT chk_term_registration_dates CHECK (registration_start_date IS NULL
        OR registration_end_date IS NULL OR registration_end_date >= registration_start_date),
    CONSTRAINT fk_term_academic_year FOREIGN KEY (academic_year_id) REFERENCES academic_year(academic_year_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE semester (
    semester_id TINYINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    semester_number TINYINT UNSIGNED NOT NULL UNIQUE,
    semester_name VARCHAR(50) NOT NULL UNIQUE,
    CONSTRAINT chk_semester_number CHECK (semester_number > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE time_slot (
    time_slot_id SMALLINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    campus_id SMALLINT UNSIGNED NOT NULL,
    slot_code VARCHAR(20) NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    is_break BOOLEAN NOT NULL DEFAULT FALSE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    CONSTRAINT uq_time_slot UNIQUE (campus_id, slot_code),
    CONSTRAINT chk_time_slot CHECK (end_time > start_time),
    CONSTRAINT fk_time_slot_campus FOREIGN KEY (campus_id) REFERENCES campus(campus_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- =============================================================
-- 4. CURRICULUM AND COURSE CATALOG MODULE
-- =============================================================
CREATE TABLE course_category (
    course_category_id SMALLINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    category_code VARCHAR(30) NOT NULL UNIQUE,
    category_name VARCHAR(100) NOT NULL UNIQUE,
    is_graded BOOLEAN NOT NULL DEFAULT TRUE,
    contributes_to_gpa BOOLEAN NOT NULL DEFAULT TRUE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE course_catalog (
    course_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    owning_department_id SMALLINT UNSIGNED NOT NULL,
    course_category_id SMALLINT UNSIGNED NOT NULL,
    course_code VARCHAR(30) NOT NULL UNIQUE,
    course_title VARCHAR(200) NOT NULL,
    short_title VARCHAR(80) NULL,
    course_type ENUM('THEORY','LAB','THEORY_LAB','PROJECT','SEMINAR','INTERNSHIP','OTHER') NOT NULL,
    lecture_hours DECIMAL(4,1) NOT NULL DEFAULT 0,
    tutorial_hours DECIMAL(4,1) NOT NULL DEFAULT 0,
    practical_hours DECIMAL(4,1) NOT NULL DEFAULT 0,
    self_study_hours DECIMAL(4,1) NOT NULL DEFAULT 0,
    credits DECIMAL(4,1) NOT NULL DEFAULT 0,
    effective_from DATE NULL,
    effective_to DATE NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    CONSTRAINT chk_course_nonnegative_values CHECK (lecture_hours >= 0 AND tutorial_hours >= 0
        AND practical_hours >= 0 AND self_study_hours >= 0 AND credits >= 0),
    CONSTRAINT chk_course_effective_dates CHECK (effective_from IS NULL OR effective_to IS NULL
        OR effective_to >= effective_from),
    CONSTRAINT fk_course_department FOREIGN KEY (owning_department_id) REFERENCES department(department_id),
    CONSTRAINT fk_course_category FOREIGN KEY (course_category_id) REFERENCES course_category(course_category_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE curriculum_scheme (
    curriculum_scheme_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    programme_id SMALLINT UNSIGNED NOT NULL,
    specialization_id SMALLINT UNSIGNED NULL,
    scheme_code VARCHAR(30) NOT NULL UNIQUE,
    scheme_name VARCHAR(150) NOT NULL,
    regulation_year YEAR NOT NULL,
    total_credits DECIMAL(6,1) NULL,
    effective_from DATE NOT NULL,
    effective_to DATE NULL,
    status ENUM('DRAFT','ACTIVE','RETIRED') NOT NULL DEFAULT 'DRAFT',
    CONSTRAINT fk_scheme_programme FOREIGN KEY (programme_id) REFERENCES programme(programme_id),
    CONSTRAINT fk_scheme_specialization_programme FOREIGN KEY (specialization_id, programme_id)
        REFERENCES programme_specialization(specialization_id, programme_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE curriculum_course (
    curriculum_course_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    curriculum_scheme_id INT UNSIGNED NOT NULL,
    semester_id TINYINT UNSIGNED NOT NULL,
    course_id INT UNSIGNED NOT NULL,
    course_category_id SMALLINT UNSIGNED NOT NULL,
    is_mandatory BOOLEAN NOT NULL DEFAULT TRUE,
    elective_group_code VARCHAR(30) NULL,
    display_order SMALLINT UNSIGNED NULL,
    internal_max_marks DECIMAL(6,2) NOT NULL DEFAULT 0,
    external_max_marks DECIMAL(6,2) NOT NULL DEFAULT 0,
    passing_marks DECIMAL(6,2) NULL,
    exam_duration_minutes SMALLINT UNSIGNED NULL,
    CONSTRAINT uq_curriculum_course UNIQUE (curriculum_scheme_id, semester_id, course_id),
    CONSTRAINT fk_curriculum_course_scheme FOREIGN KEY (curriculum_scheme_id) REFERENCES curriculum_scheme(curriculum_scheme_id),
    CONSTRAINT fk_curriculum_course_semester FOREIGN KEY (semester_id) REFERENCES semester(semester_id),
    CONSTRAINT fk_curriculum_course_course FOREIGN KEY (course_id) REFERENCES course_catalog(course_id),
    CONSTRAINT fk_curriculum_course_category FOREIGN KEY (course_category_id) REFERENCES course_category(course_category_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE course_prerequisite (
    course_id INT UNSIGNED NOT NULL,
    prerequisite_course_id INT UNSIGNED NOT NULL,
    minimum_grade VARCHAR(5) NULL,
    PRIMARY KEY (course_id, prerequisite_course_id),
    CONSTRAINT chk_prerequisite_not_self CHECK (course_id <> prerequisite_course_id),
    CONSTRAINT fk_prerequisite_course FOREIGN KEY (course_id) REFERENCES course_catalog(course_id),
    CONSTRAINT fk_prerequisite_required FOREIGN KEY (prerequisite_course_id) REFERENCES course_catalog(course_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- =============================================================
-- 5. STUDENT AND STAFF MASTER MODULES (INDEPENDENT ROOT ENTITIES)
-- Student and employee are intentionally NOT inherited from a generic person table.
-- Shared demographic/reference masters remain reusable through foreign keys.
-- =============================================================
CREATE TABLE student (
    student_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    student_number VARCHAR(30) NOT NULL UNIQUE,
    university_seat_number VARCHAR(30) NULL UNIQUE,
    first_name VARCHAR(100) NOT NULL,
    middle_name VARCHAR(100) NULL,
    last_name VARCHAR(100) NULL,
    display_name VARCHAR(250) NOT NULL,
    date_of_birth DATE NULL,
    gender_id TINYINT UNSIGNED NULL,
    blood_group_id TINYINT UNSIGNED NULL,
    primary_email VARCHAR(254) NULL,
    primary_phone VARCHAR(25) NULL,
    nationality_country_id SMALLINT UNSIGNED NULL,
    religion_id SMALLINT UNSIGNED NULL,
    social_category_id SMALLINT UNSIGNED NULL,
    caste_id INT UNSIGNED NULL,
    sub_caste_id INT UNSIGNED NULL,
    photo_url VARCHAR(500) NULL,
    admission_date DATE NULL,
    student_status ENUM('APPLICANT','ACTIVE','SUSPENDED','WITHDRAWN','COMPLETED','ALUMNUS','DECEASED') NOT NULL DEFAULT 'ACTIVE',
    notes TEXT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT uq_student_primary_email UNIQUE (primary_email),
    CONSTRAINT fk_student_gender FOREIGN KEY (gender_id) REFERENCES gender(gender_id),
    CONSTRAINT fk_student_blood_group FOREIGN KEY (blood_group_id) REFERENCES blood_group(blood_group_id),
    CONSTRAINT fk_student_nationality FOREIGN KEY (nationality_country_id) REFERENCES country(country_id),
    CONSTRAINT fk_student_religion FOREIGN KEY (religion_id) REFERENCES religion(religion_id),
    CONSTRAINT fk_student_social_category FOREIGN KEY (social_category_id) REFERENCES social_category(social_category_id),
    CONSTRAINT fk_student_caste FOREIGN KEY (caste_id) REFERENCES caste(caste_id),
    CONSTRAINT fk_student_sub_caste FOREIGN KEY (sub_caste_id) REFERENCES sub_caste(sub_caste_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE student_address (
    student_address_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    student_id BIGINT UNSIGNED NOT NULL,
    address_type ENUM('PERMANENT','CURRENT','CORRESPONDENCE','OTHER') NOT NULL,
    address_line_1 VARCHAR(200) NOT NULL,
    address_line_2 VARCHAR(200) NULL,
    city VARCHAR(100) NOT NULL,
    state_id SMALLINT UNSIGNED NULL,
    country_id SMALLINT UNSIGNED NOT NULL,
    postal_code VARCHAR(12) NULL,
    valid_from DATE NULL,
    valid_to DATE NULL,
    is_primary BOOLEAN NOT NULL DEFAULT FALSE,
    current_primary_student_id BIGINT UNSIGNED GENERATED ALWAYS AS (
        CASE WHEN is_primary=TRUE AND valid_to IS NULL THEN student_id ELSE NULL END
    ) STORED,
    CONSTRAINT uq_student_current_primary_address UNIQUE (current_primary_student_id),
    CONSTRAINT chk_student_address_dates CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to >= valid_from),
    CONSTRAINT fk_student_address_student FOREIGN KEY (student_id) REFERENCES student(student_id),
    CONSTRAINT fk_student_address_state FOREIGN KEY (state_id) REFERENCES state(state_id),
    CONSTRAINT fk_student_address_country FOREIGN KEY (country_id) REFERENCES country(country_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE student_parent_guardian (
    student_parent_guardian_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    student_id BIGINT UNSIGNED NOT NULL,
    relationship_type ENUM('FATHER','MOTHER','GUARDIAN','OTHER') NOT NULL,
    full_name VARCHAR(200) NOT NULL,
    occupation VARCHAR(150) NULL,
    annual_income DECIMAL(14,2) NULL,
    email VARCHAR(254) NULL,
    phone VARCHAR(25) NULL,
    address_line_1 VARCHAR(200) NULL,
    address_line_2 VARCHAR(200) NULL,
    city VARCHAR(100) NULL,
    state_id SMALLINT UNSIGNED NULL,
    country_id SMALLINT UNSIGNED NULL,
    postal_code VARCHAR(12) NULL,
    is_primary_contact BOOLEAN NOT NULL DEFAULT FALSE,
    CONSTRAINT fk_parent_student FOREIGN KEY (student_id) REFERENCES student(student_id),
    CONSTRAINT fk_parent_state FOREIGN KEY (state_id) REFERENCES state(state_id),
    CONSTRAINT fk_parent_country FOREIGN KEY (country_id) REFERENCES country(country_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE student_residence (
    student_residence_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    student_id BIGINT UNSIGNED NOT NULL,
    residence_type ENUM('HOSTEL','DAY_SCHOLAR','PG','RENTED','RELATIVE','OTHER') NOT NULL,
    hostel_name VARCHAR(150) NULL,
    room_number VARCHAR(30) NULL,
    start_date DATE NOT NULL,
    end_date DATE NULL,
    is_current BOOLEAN NOT NULL DEFAULT TRUE,
    CONSTRAINT fk_residence_student FOREIGN KEY (student_id) REFERENCES student(student_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE student_previous_education (
    previous_education_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    student_id BIGINT UNSIGNED NOT NULL,
    qualification_level ENUM('SSLC','PUC_I','PUC_II','DIPLOMA','UG','PG','OTHER') NOT NULL,
    examination_name VARCHAR(150) NULL,
    institution_name VARCHAR(250) NOT NULL,
    board_university VARCHAR(200) NULL,
    registration_number VARCHAR(50) NULL,
    month_of_passing TINYINT UNSIGNED NULL,
    year_of_passing YEAR NULL,
    result_class VARCHAR(50) NULL,
    marks_obtained DECIMAL(8,2) NULL,
    maximum_marks DECIMAL(8,2) NULL,
    percentage DECIMAL(5,2) NULL,
    CONSTRAINT uq_previous_education UNIQUE (student_id, qualification_level, registration_number),
    CONSTRAINT fk_previous_education_student FOREIGN KEY (student_id) REFERENCES student(student_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE student_entrance_exam (
    student_entrance_exam_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    student_id BIGINT UNSIGNED NOT NULL,
    exam_name VARCHAR(100) NOT NULL,
    registration_number VARCHAR(50) NULL,
    rank_number INT UNSIGNED NULL,
    score DECIMAL(8,2) NULL,
    exam_year YEAR NULL,
    allotment_date DATE NULL,
    registration_fee DECIMAL(12,2) NULL,
    CONSTRAINT uq_student_exam UNIQUE (student_id, exam_name, exam_year),
    CONSTRAINT fk_student_exam_student FOREIGN KEY (student_id) REFERENCES student(student_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE staff_type (
    staff_type_id TINYINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    type_code VARCHAR(30) NOT NULL UNIQUE,
    type_name VARCHAR(100) NOT NULL UNIQUE,
    description VARCHAR(500) NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE staff_category (
    staff_category_id SMALLINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    staff_type_id TINYINT UNSIGNED NOT NULL,
    category_code VARCHAR(50) NOT NULL UNIQUE,
    category_name VARCHAR(150) NOT NULL,
    description VARCHAR(500) NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_staff_category_type FOREIGN KEY (staff_type_id) REFERENCES staff_type(staff_type_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE employment_source (
    employment_source_id TINYINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    source_code VARCHAR(30) NOT NULL UNIQUE,
    source_name VARCHAR(100) NOT NULL UNIQUE,
    is_external BOOLEAN NOT NULL DEFAULT FALSE,
    description VARCHAR(500) NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE external_agency (
    external_agency_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    institution_id SMALLINT UNSIGNED NOT NULL,
    agency_code VARCHAR(50) NOT NULL,
    agency_name VARCHAR(200) NOT NULL,
    service_type VARCHAR(100) NULL,
    contact_person VARCHAR(150) NULL,
    phone VARCHAR(25) NULL,
    email VARCHAR(254) NULL,
    contract_start_date DATE NULL,
    contract_end_date DATE NULL,
    address VARCHAR(500) NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT uq_external_agency UNIQUE (institution_id, agency_code),
    CONSTRAINT chk_external_agency_contract_dates CHECK (contract_end_date IS NULL OR contract_start_date IS NULL OR contract_end_date >= contract_start_date),
    CONSTRAINT fk_external_agency_institution FOREIGN KEY (institution_id) REFERENCES institution(institution_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE designation (
    designation_id SMALLINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    staff_category_id SMALLINT UNSIGNED NOT NULL,
    designation_code VARCHAR(30) NOT NULL UNIQUE,
    designation_name VARCHAR(100) NOT NULL,
    description VARCHAR(500) NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    CONSTRAINT uq_designation_category_name UNIQUE (staff_category_id, designation_name),
    CONSTRAINT fk_designation_staff_category FOREIGN KEY (staff_category_id) REFERENCES staff_category(staff_category_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE employee (
    employee_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    institution_id SMALLINT UNSIGNED NOT NULL,
    employment_source_id TINYINT UNSIGNED NOT NULL,
    external_agency_id BIGINT UNSIGNED NULL,
    employee_number VARCHAR(30) NOT NULL UNIQUE,
    agency_employee_number VARCHAR(50) NULL,
    first_name VARCHAR(100) NOT NULL,
    middle_name VARCHAR(100) NULL,
    last_name VARCHAR(100) NULL,
    display_name VARCHAR(250) NOT NULL,
    date_of_birth DATE NULL,
    gender_id TINYINT UNSIGNED NULL,
    blood_group_id TINYINT UNSIGNED NULL,
    primary_email VARCHAR(254) NULL,
    primary_phone VARCHAR(25) NULL,
    nationality_country_id SMALLINT UNSIGNED NULL,
    religion_id SMALLINT UNSIGNED NULL,
    social_category_id SMALLINT UNSIGNED NULL,
    caste_id INT UNSIGNED NULL,
    sub_caste_id INT UNSIGNED NULL,
    photo_url VARCHAR(500) NULL,
    joining_date DATE NOT NULL,
    employment_type ENUM('REGULAR','CONTRACT','VISITING','ADJUNCT','TEMPORARY','OTHER') NOT NULL,
    employment_status ENUM('ACTIVE','ON_LEAVE','SUSPENDED','RESIGNED','RETIRED','TERMINATED') NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT uq_employee_agency_number UNIQUE (external_agency_id, agency_employee_number),
    CONSTRAINT uq_employee_primary_email UNIQUE (primary_email),
    CONSTRAINT fk_employee_institution FOREIGN KEY (institution_id) REFERENCES institution(institution_id),
    CONSTRAINT fk_employee_employment_source FOREIGN KEY (employment_source_id) REFERENCES employment_source(employment_source_id),
    CONSTRAINT fk_employee_external_agency FOREIGN KEY (external_agency_id) REFERENCES external_agency(external_agency_id),
    CONSTRAINT fk_employee_gender FOREIGN KEY (gender_id) REFERENCES gender(gender_id),
    CONSTRAINT fk_employee_blood_group FOREIGN KEY (blood_group_id) REFERENCES blood_group(blood_group_id),
    CONSTRAINT fk_employee_nationality FOREIGN KEY (nationality_country_id) REFERENCES country(country_id),
    CONSTRAINT fk_employee_religion FOREIGN KEY (religion_id) REFERENCES religion(religion_id),
    CONSTRAINT fk_employee_social_category FOREIGN KEY (social_category_id) REFERENCES social_category(social_category_id),
    CONSTRAINT fk_employee_caste FOREIGN KEY (caste_id) REFERENCES caste(caste_id),
    CONSTRAINT fk_employee_sub_caste FOREIGN KEY (sub_caste_id) REFERENCES sub_caste(sub_caste_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE employee_address (
    employee_address_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    employee_id BIGINT UNSIGNED NOT NULL,
    address_type ENUM('PERMANENT','CURRENT','CORRESPONDENCE','OTHER') NOT NULL,
    address_line_1 VARCHAR(200) NOT NULL,
    address_line_2 VARCHAR(200) NULL,
    city VARCHAR(100) NOT NULL,
    state_id SMALLINT UNSIGNED NULL,
    country_id SMALLINT UNSIGNED NOT NULL,
    postal_code VARCHAR(12) NULL,
    valid_from DATE NULL,
    valid_to DATE NULL,
    is_primary BOOLEAN NOT NULL DEFAULT FALSE,
    current_primary_employee_id BIGINT UNSIGNED GENERATED ALWAYS AS (
        CASE WHEN is_primary=TRUE AND valid_to IS NULL THEN employee_id ELSE NULL END
    ) STORED,
    CONSTRAINT uq_employee_current_primary_address UNIQUE (current_primary_employee_id),
    CONSTRAINT chk_employee_address_dates CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to >= valid_from),
    CONSTRAINT fk_employee_address_employee FOREIGN KEY (employee_id) REFERENCES employee(employee_id),
    CONSTRAINT fk_employee_address_state FOREIGN KEY (state_id) REFERENCES state(state_id),
    CONSTRAINT fk_employee_address_country FOREIGN KEY (country_id) REFERENCES country(country_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE employee_assignment (
    employee_assignment_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    employee_id BIGINT UNSIGNED NOT NULL,
    campus_id SMALLINT UNSIGNED NOT NULL,
    department_id SMALLINT UNSIGNED NULL,
    designation_id SMALLINT UNSIGNED NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NULL,
    is_primary BOOLEAN NOT NULL DEFAULT TRUE,
    current_primary_employee_id BIGINT UNSIGNED GENERATED ALWAYS AS (
        CASE WHEN is_primary = TRUE AND end_date IS NULL THEN employee_id ELSE NULL END
    ) STORED,
    CONSTRAINT uq_employee_current_primary UNIQUE (current_primary_employee_id),
    CONSTRAINT chk_employee_assignment_dates CHECK (end_date IS NULL OR end_date >= start_date),
    CONSTRAINT fk_employee_assignment_employee FOREIGN KEY (employee_id) REFERENCES employee(employee_id),
    CONSTRAINT fk_employee_assignment_campus FOREIGN KEY (campus_id) REFERENCES campus(campus_id),
    CONSTRAINT fk_employee_assignment_department_campus FOREIGN KEY (department_id, campus_id) REFERENCES department(department_id, campus_id),
    CONSTRAINT fk_employee_assignment_designation FOREIGN KEY (designation_id) REFERENCES designation(designation_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE employee_competency (
    employee_id BIGINT UNSIGNED NOT NULL,
    course_id INT UNSIGNED NOT NULL,
    competency_level ENUM('BEGINNER','INTERMEDIATE','ADVANCED','EXPERT') NULL,
    valid_from DATE NULL,
    valid_to DATE NULL,
    PRIMARY KEY (employee_id, course_id),
    CONSTRAINT fk_competency_employee FOREIGN KEY (employee_id) REFERENCES employee(employee_id),
    CONSTRAINT fk_competency_course FOREIGN KEY (course_id) REFERENCES course_catalog(course_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT INTO staff_type (type_code, type_name, description) VALUES
('TEACHING', 'Teaching', 'Academic and teaching personnel'),
('NON_TEACHING', 'Non-Teaching', 'Administrative, technical, support and service personnel');

INSERT INTO staff_category (staff_type_id, category_code, category_name, description) VALUES
((SELECT staff_type_id FROM staff_type WHERE type_code='TEACHING'),'TEACHING_STAFF','Teaching Staff','Faculty and other personnel engaged in teaching'),
((SELECT staff_type_id FROM staff_type WHERE type_code='NON_TEACHING'),'OFFICE_STAFF','Office Staff','Administrative and office personnel'),
((SELECT staff_type_id FROM staff_type WHERE type_code='NON_TEACHING'),'EXAM_SECTION_STAFF','Examination Section Staff','Personnel working in the examination section'),
((SELECT staff_type_id FROM staff_type WHERE type_code='NON_TEACHING'),'LIBRARY_STAFF','Library Staff','Library professional and support personnel'),
((SELECT staff_type_id FROM staff_type WHERE type_code='NON_TEACHING'),'MENIAL_STAFF','Menial Staff','Institutional support and menial personnel'),
((SELECT staff_type_id FROM staff_type WHERE type_code='NON_TEACHING'),'INTERNAL_SECURITY','Internal Security Staff','Security personnel directly engaged by the institution'),
((SELECT staff_type_id FROM staff_type WHERE type_code='NON_TEACHING'),'AGENCY_SECURITY','Security Staff - External Agency','Security personnel supplied by an external agency'),
((SELECT staff_type_id FROM staff_type WHERE type_code='NON_TEACHING'),'AGENCY_HOUSEKEEPING','Housekeeping Staff - External Agency','Housekeeping personnel supplied by an external agency');

INSERT INTO employment_source (source_code, source_name, is_external, description) VALUES
('INSTITUTION','Institution Employee',FALSE,'Person directly engaged by the institution'),
('EXTERNAL_AGENCY','External Agency',TRUE,'Person supplied by a contracted external agency');

INSERT INTO designation (staff_category_id, designation_code, designation_name) VALUES
((SELECT staff_category_id FROM staff_category WHERE category_code='TEACHING_STAFF'),'PROFESSOR','Professor'),
((SELECT staff_category_id FROM staff_category WHERE category_code='TEACHING_STAFF'),'ASSOC_PROFESSOR','Associate Professor'),
((SELECT staff_category_id FROM staff_category WHERE category_code='TEACHING_STAFF'),'ASST_PROFESSOR','Assistant Professor'),
((SELECT staff_category_id FROM staff_category WHERE category_code='OFFICE_STAFF'),'OFFICE_SUPERINTENDENT','Office Superintendent'),
((SELECT staff_category_id FROM staff_category WHERE category_code='OFFICE_STAFF'),'OFFICE_ASSISTANT','Office Assistant'),
((SELECT staff_category_id FROM staff_category WHERE category_code='EXAM_SECTION_STAFF'),'EXAM_SUPERINTENDENT','Examination Superintendent'),
((SELECT staff_category_id FROM staff_category WHERE category_code='EXAM_SECTION_STAFF'),'EXAM_ASSISTANT','Examination Assistant'),
((SELECT staff_category_id FROM staff_category WHERE category_code='LIBRARY_STAFF'),'LIBRARIAN','Librarian'),
((SELECT staff_category_id FROM staff_category WHERE category_code='LIBRARY_STAFF'),'ASST_LIBRARIAN','Assistant Librarian'),
((SELECT staff_category_id FROM staff_category WHERE category_code='MENIAL_STAFF'),'ATTENDER','Attender'),
((SELECT staff_category_id FROM staff_category WHERE category_code='INTERNAL_SECURITY'),'INTERNAL_SECURITY_GUARD','Security Guard'),
((SELECT staff_category_id FROM staff_category WHERE category_code='AGENCY_SECURITY'),'AGENCY_SECURITY_GUARD','Security Guard'),
((SELECT staff_category_id FROM staff_category WHERE category_code='AGENCY_HOUSEKEEPING'),'HOUSEKEEPING_STAFF','Housekeeping Staff');

-- =============================================================
-- 6. ADMISSION AND ENROLMENT TRANSACTION MODULE
-- =============================================================
CREATE TABLE admission_applicant (
    admission_applicant_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    first_name VARCHAR(100) NOT NULL,
    middle_name VARCHAR(100) NULL,
    last_name VARCHAR(100) NULL,
    display_name VARCHAR(250) NOT NULL,
    date_of_birth DATE NULL,
    gender_id TINYINT UNSIGNED NULL,
    primary_email VARCHAR(254) NULL,
    primary_phone VARCHAR(25) NULL,
    nationality_country_id SMALLINT UNSIGNED NULL,
    social_category_id SMALLINT UNSIGNED NULL,
    caste_id INT UNSIGNED NULL,
    sub_caste_id INT UNSIGNED NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_admission_applicant_gender FOREIGN KEY (gender_id) REFERENCES gender(gender_id),
    CONSTRAINT fk_admission_applicant_nationality FOREIGN KEY (nationality_country_id) REFERENCES country(country_id),
    CONSTRAINT fk_admission_applicant_social_category FOREIGN KEY (social_category_id) REFERENCES social_category(social_category_id),
    CONSTRAINT fk_admission_applicant_caste FOREIGN KEY (caste_id) REFERENCES caste(caste_id),
    CONSTRAINT fk_admission_applicant_sub_caste FOREIGN KEY (sub_caste_id) REFERENCES sub_caste(sub_caste_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE admission_application (
    application_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    application_number VARCHAR(30) NOT NULL UNIQUE,
    admission_applicant_id BIGINT UNSIGNED NOT NULL,
    admitted_student_id BIGINT UNSIGNED NULL UNIQUE,
    programme_id SMALLINT UNSIGNED NOT NULL,
    specialization_id SMALLINT UNSIGNED NULL,
    academic_year_id SMALLINT UNSIGNED NOT NULL,
    admission_category_id SMALLINT UNSIGNED NULL,
    application_date DATE NOT NULL,
    application_status ENUM('DRAFT','SUBMITTED','UNDER_REVIEW','ELIGIBLE','INELIGIBLE','SELECTED','WAITLISTED','REJECTED','ADMITTED','CANCELLED') NOT NULL DEFAULT 'DRAFT',
    eligibility_status ENUM('PENDING','ELIGIBLE','INELIGIBLE') NOT NULL DEFAULT 'PENDING',
    remarks TEXT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_application_applicant FOREIGN KEY (admission_applicant_id) REFERENCES admission_applicant(admission_applicant_id),
    CONSTRAINT fk_application_admitted_student FOREIGN KEY (admitted_student_id) REFERENCES student(student_id),
    CONSTRAINT fk_application_programme FOREIGN KEY (programme_id) REFERENCES programme(programme_id),
    CONSTRAINT fk_application_specialization_programme FOREIGN KEY (specialization_id, programme_id)
        REFERENCES programme_specialization(specialization_id, programme_id),
    CONSTRAINT fk_application_year FOREIGN KEY (academic_year_id) REFERENCES academic_year(academic_year_id),
    CONSTRAINT fk_application_category FOREIGN KEY (admission_category_id) REFERENCES admission_category(admission_category_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE student_programme_enrolment (
    enrolment_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    student_id BIGINT UNSIGNED NOT NULL,
    programme_id SMALLINT UNSIGNED NOT NULL,
    specialization_id SMALLINT UNSIGNED NULL,
    curriculum_scheme_id INT UNSIGNED NOT NULL,
    admission_academic_year_id SMALLINT UNSIGNED NOT NULL,
    admission_category_id SMALLINT UNSIGNED NULL,
    admission_date DATE NOT NULL,
    admission_semester_id TINYINT UNSIGNED NOT NULL,
    expected_completion_date DATE NULL,
    enrolment_status ENUM('ACTIVE','ON_BREAK','WITHDRAWN','TRANSFERRED','COMPLETED','TERMINATED') NOT NULL DEFAULT 'ACTIVE',
    CONSTRAINT uq_student_programme_enrolment UNIQUE (student_id, programme_id, admission_academic_year_id),
    CONSTRAINT fk_enrolment_student FOREIGN KEY (student_id) REFERENCES student(student_id),
    CONSTRAINT fk_enrolment_programme FOREIGN KEY (programme_id) REFERENCES programme(programme_id),
    CONSTRAINT fk_enrolment_specialization_programme FOREIGN KEY (specialization_id, programme_id)
        REFERENCES programme_specialization(specialization_id, programme_id),
    CONSTRAINT fk_enrolment_scheme FOREIGN KEY (curriculum_scheme_id) REFERENCES curriculum_scheme(curriculum_scheme_id),
    CONSTRAINT fk_enrolment_year FOREIGN KEY (admission_academic_year_id) REFERENCES academic_year(academic_year_id),
    CONSTRAINT fk_enrolment_category FOREIGN KEY (admission_category_id) REFERENCES admission_category(admission_category_id),
    CONSTRAINT fk_enrolment_semester FOREIGN KEY (admission_semester_id) REFERENCES semester(semester_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE enrolment_status_history (
    enrolment_status_history_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    enrolment_id BIGINT UNSIGNED NOT NULL,
    old_status VARCHAR(30) NULL,
    new_status VARCHAR(30) NOT NULL,
    effective_date DATE NOT NULL,
    reason VARCHAR(500) NULL,
    CONSTRAINT fk_enrolment_history_enrolment FOREIGN KEY (enrolment_id) REFERENCES student_programme_enrolment(enrolment_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- =============================================================
-- 7. TERM REGISTRATION, SECTION AND COURSE REGISTRATION MODULE
-- =============================================================
CREATE TABLE programme_term_offering (
    programme_term_offering_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    academic_term_id INT UNSIGNED NOT NULL,
    programme_id SMALLINT UNSIGNED NOT NULL,
    specialization_id SMALLINT UNSIGNED NULL,
    specialization_key SMALLINT UNSIGNED GENERATED ALWAYS AS (COALESCE(specialization_id, 0)) STORED,
    curriculum_scheme_id INT UNSIGNED NOT NULL,
    semester_id TINYINT UNSIGNED NOT NULL,
    status ENUM('PLANNED','REGISTRATION_OPEN','ACTIVE','COMPLETED','CANCELLED') NOT NULL DEFAULT 'PLANNED',
    CONSTRAINT uq_programme_term UNIQUE (academic_term_id, programme_id, specialization_key, semester_id),
    CONSTRAINT fk_programme_term_academic_term FOREIGN KEY (academic_term_id) REFERENCES academic_term(academic_term_id),
    CONSTRAINT fk_programme_term_programme FOREIGN KEY (programme_id) REFERENCES programme(programme_id),
    CONSTRAINT fk_programme_term_specialization_programme FOREIGN KEY (specialization_id, programme_id)
        REFERENCES programme_specialization(specialization_id, programme_id),
    CONSTRAINT fk_programme_term_scheme FOREIGN KEY (curriculum_scheme_id) REFERENCES curriculum_scheme(curriculum_scheme_id),
    CONSTRAINT fk_programme_term_semester FOREIGN KEY (semester_id) REFERENCES semester(semester_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE class_section (
    class_section_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    programme_term_offering_id BIGINT UNSIGNED NOT NULL,
    section_code VARCHAR(20) NOT NULL,
    section_name VARCHAR(100) NULL,
    capacity SMALLINT UNSIGNED NULL,
    home_room_id INT UNSIGNED NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    CONSTRAINT uq_class_section UNIQUE (programme_term_offering_id, section_code),
    CONSTRAINT uq_class_section_owner UNIQUE (class_section_id, programme_term_offering_id),
    CONSTRAINT fk_class_section_offering FOREIGN KEY (programme_term_offering_id) REFERENCES programme_term_offering(programme_term_offering_id),
    CONSTRAINT fk_class_section_room FOREIGN KEY (home_room_id) REFERENCES room(room_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE class_batch (
    class_batch_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    class_section_id BIGINT UNSIGNED NOT NULL,
    batch_code VARCHAR(20) NOT NULL,
    batch_name VARCHAR(100) NULL,
    capacity SMALLINT UNSIGNED NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    CONSTRAINT uq_class_batch UNIQUE (class_section_id, batch_code),
    CONSTRAINT uq_class_batch_owner UNIQUE (class_batch_id, class_section_id),
    CONSTRAINT fk_class_batch_section FOREIGN KEY (class_section_id) REFERENCES class_section(class_section_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE student_term_registration (
    term_registration_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    enrolment_id BIGINT UNSIGNED NOT NULL,
    programme_term_offering_id BIGINT UNSIGNED NOT NULL,
    class_section_id BIGINT UNSIGNED NULL,
    class_batch_id BIGINT UNSIGNED NULL,
    roll_number VARCHAR(30) NULL,
    registration_date DATE NOT NULL,
    registration_status ENUM('DRAFT','REGISTERED','APPROVED','CANCELLED','COMPLETED') NOT NULL DEFAULT 'REGISTERED',
    CONSTRAINT uq_student_term_registration UNIQUE (enrolment_id, programme_term_offering_id),
    CONSTRAINT uq_term_roll UNIQUE (programme_term_offering_id, roll_number),
    CONSTRAINT chk_term_registration_batch_section CHECK (class_batch_id IS NULL OR class_section_id IS NOT NULL),
    CONSTRAINT fk_term_registration_enrolment FOREIGN KEY (enrolment_id) REFERENCES student_programme_enrolment(enrolment_id),
    CONSTRAINT fk_term_registration_offering FOREIGN KEY (programme_term_offering_id) REFERENCES programme_term_offering(programme_term_offering_id),
    CONSTRAINT fk_term_registration_section_owner FOREIGN KEY (class_section_id, programme_term_offering_id)
        REFERENCES class_section(class_section_id, programme_term_offering_id),
    CONSTRAINT fk_term_registration_batch_owner FOREIGN KEY (class_batch_id, class_section_id)
        REFERENCES class_batch(class_batch_id, class_section_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE course_offering (
    course_offering_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    programme_term_offering_id BIGINT UNSIGNED NOT NULL,
    curriculum_course_id BIGINT UNSIGNED NULL,
    course_id INT UNSIGNED NOT NULL,
    offering_code VARCHAR(50) NOT NULL UNIQUE,
    registration_capacity SMALLINT UNSIGNED NULL,
    status ENUM('PLANNED','OPEN','ACTIVE','COMPLETED','CANCELLED') NOT NULL DEFAULT 'PLANNED',
    CONSTRAINT uq_course_offering UNIQUE (programme_term_offering_id, course_id),
    CONSTRAINT uq_course_offering_owner UNIQUE (course_offering_id, programme_term_offering_id),
    CONSTRAINT fk_course_offering_programme_term FOREIGN KEY (programme_term_offering_id) REFERENCES programme_term_offering(programme_term_offering_id),
    CONSTRAINT fk_course_offering_curriculum FOREIGN KEY (curriculum_course_id) REFERENCES curriculum_course(curriculum_course_id),
    CONSTRAINT fk_course_offering_course FOREIGN KEY (course_id) REFERENCES course_catalog(course_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE course_offering_section (
    course_offering_section_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    course_offering_id BIGINT UNSIGNED NOT NULL,
    programme_term_offering_id BIGINT UNSIGNED NOT NULL,
    class_section_id BIGINT UNSIGNED NOT NULL,
    class_batch_id BIGINT UNSIGNED NULL,
    class_batch_key BIGINT UNSIGNED GENERATED ALWAYS AS (COALESCE(class_batch_id, 0)) STORED,
    session_type ENUM('LECTURE','TUTORIAL','PRACTICAL','PROJECT','SEMINAR','OTHER') NOT NULL,
    CONSTRAINT uq_course_offering_section UNIQUE (course_offering_id, class_section_id, class_batch_key, session_type),
    CONSTRAINT uq_course_offering_section_course UNIQUE (course_offering_section_id, course_offering_id),
    CONSTRAINT uq_course_offering_section_owner UNIQUE (course_offering_section_id, programme_term_offering_id),
    CONSTRAINT chk_course_offering_section_batch CHECK (class_batch_id IS NULL OR class_section_id IS NOT NULL),
    CONSTRAINT fk_course_offering_section_offering_owner FOREIGN KEY (course_offering_id, programme_term_offering_id)
        REFERENCES course_offering(course_offering_id, programme_term_offering_id),
    CONSTRAINT fk_course_offering_section_section_owner FOREIGN KEY (class_section_id, programme_term_offering_id)
        REFERENCES class_section(class_section_id, programme_term_offering_id),
    CONSTRAINT fk_course_offering_section_batch_owner FOREIGN KEY (class_batch_id, class_section_id)
        REFERENCES class_batch(class_batch_id, class_section_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE student_course_registration (
    course_registration_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    term_registration_id BIGINT UNSIGNED NOT NULL,
    course_offering_id BIGINT UNSIGNED NOT NULL,
    registration_type ENUM('REGULAR','ELECTIVE','BACKLOG','REPEAT','IMPROVEMENT','AUDIT','CREDIT_TRANSFER') NOT NULL DEFAULT 'REGULAR',
    registration_date DATE NOT NULL,
    registration_status ENUM('REGISTERED','APPROVED','DROPPED','WITHDRAWN','COMPLETED') NOT NULL DEFAULT 'REGISTERED',
    CONSTRAINT uq_student_course_registration UNIQUE (term_registration_id, course_offering_id),
    CONSTRAINT uq_course_registration_owner UNIQUE (course_registration_id, course_offering_id),
    CONSTRAINT fk_course_registration_term FOREIGN KEY (term_registration_id) REFERENCES student_term_registration(term_registration_id),
    CONSTRAINT fk_course_registration_offering FOREIGN KEY (course_offering_id) REFERENCES course_offering(course_offering_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Explicit roster membership binds a registered course to the exact lecture/lab/tutorial section.
CREATE TABLE course_offering_section_student (
    course_offering_section_student_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    course_offering_section_id BIGINT UNSIGNED NOT NULL,
    course_registration_id BIGINT UNSIGNED NOT NULL,
    course_offering_id BIGINT UNSIGNED NOT NULL,
    roster_status ENUM('ACTIVE','DROPPED','TRANSFERRED','COMPLETED') NOT NULL DEFAULT 'ACTIVE',
    effective_from DATE NULL,
    effective_to DATE NULL,
    CONSTRAINT uq_course_section_student UNIQUE (course_offering_section_id, course_registration_id),
    CONSTRAINT uq_course_section_student_owner UNIQUE (course_offering_section_student_id, course_offering_section_id),
    CONSTRAINT chk_course_section_student_dates CHECK (effective_to IS NULL OR effective_from IS NULL OR effective_to >= effective_from),
    CONSTRAINT fk_roster_section_course FOREIGN KEY (course_offering_section_id, course_offering_id)
        REFERENCES course_offering_section(course_offering_section_id, course_offering_id),
    CONSTRAINT fk_roster_registration_course FOREIGN KEY (course_registration_id, course_offering_id)
        REFERENCES student_course_registration(course_registration_id, course_offering_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- =============================================================
-- 8. TEACHING ALLOCATION AND TIMETABLE MODULE
-- =============================================================
CREATE TABLE faculty_course_assignment (
    faculty_assignment_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    course_offering_section_id BIGINT UNSIGNED NOT NULL,
    employee_id BIGINT UNSIGNED NOT NULL,
    assignment_role ENUM('PRIMARY_INSTRUCTOR','CO_INSTRUCTOR','LAB_INSTRUCTOR','TUTOR','COORDINATOR','OTHER') NOT NULL,
    workload_hours DECIMAL(6,2) NULL,
    start_date DATE NOT NULL,
    end_date DATE NULL,
    assignment_status ENUM('PLANNED','ACTIVE','COMPLETED','CANCELLED') NOT NULL DEFAULT 'ACTIVE',
    CONSTRAINT uq_faculty_course_assignment UNIQUE (course_offering_section_id, employee_id, assignment_role),
    CONSTRAINT fk_faculty_assignment_section FOREIGN KEY (course_offering_section_id) REFERENCES course_offering_section(course_offering_section_id),
    CONSTRAINT fk_faculty_assignment_employee FOREIGN KEY (employee_id) REFERENCES employee(employee_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE timetable_session (
    timetable_session_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    course_offering_section_id BIGINT UNSIGNED NOT NULL,
    faculty_assignment_id BIGINT UNSIGNED NULL,
    day_of_week TINYINT UNSIGNED NOT NULL,
    time_slot_id SMALLINT UNSIGNED NOT NULL,
    room_id INT UNSIGNED NULL,
    effective_from DATE NOT NULL,
    effective_to DATE NULL,
    CONSTRAINT chk_day_of_week CHECK (day_of_week BETWEEN 1 AND 7),
    CONSTRAINT uq_timetable_room UNIQUE (day_of_week, time_slot_id, room_id, effective_from),
    CONSTRAINT fk_timetable_section FOREIGN KEY (course_offering_section_id) REFERENCES course_offering_section(course_offering_section_id),
    CONSTRAINT fk_timetable_faculty FOREIGN KEY (faculty_assignment_id) REFERENCES faculty_course_assignment(faculty_assignment_id),
    CONSTRAINT fk_timetable_time_slot FOREIGN KEY (time_slot_id) REFERENCES time_slot(time_slot_id),
    CONSTRAINT fk_timetable_room FOREIGN KEY (room_id) REFERENCES room(room_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- =============================================================
-- 9. ATTENDANCE AND LESSON PLAN MODULE
-- =============================================================
CREATE TABLE class_session (
    class_session_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    course_offering_section_id BIGINT UNSIGNED NOT NULL,
    faculty_assignment_id BIGINT UNSIGNED NULL,
    timetable_session_id BIGINT UNSIGNED NULL,
    session_date DATE NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    room_id INT UNSIGNED NULL,
    session_type ENUM('LECTURE','TUTORIAL','PRACTICAL','PROJECT','SEMINAR','OTHER') NOT NULL,
    planned_topic TEXT NULL,
    topic_covered TEXT NULL,
    class_number SMALLINT UNSIGNED NULL,
    session_status ENUM('PLANNED','CONDUCTED','CANCELLED','RESCHEDULED') NOT NULL DEFAULT 'PLANNED',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_class_session_time CHECK (end_time > start_time),
    CONSTRAINT uq_class_session UNIQUE (course_offering_section_id, session_date, start_time),
    CONSTRAINT uq_class_session_owner UNIQUE (class_session_id, course_offering_section_id),
    CONSTRAINT fk_class_session_section FOREIGN KEY (course_offering_section_id) REFERENCES course_offering_section(course_offering_section_id),
    CONSTRAINT fk_class_session_faculty FOREIGN KEY (faculty_assignment_id) REFERENCES faculty_course_assignment(faculty_assignment_id),
    CONSTRAINT fk_class_session_timetable FOREIGN KEY (timetable_session_id) REFERENCES timetable_session(timetable_session_id),
    CONSTRAINT fk_class_session_room FOREIGN KEY (room_id) REFERENCES room(room_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE attendance_status (
    attendance_status_id TINYINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    status_code VARCHAR(20) NOT NULL UNIQUE,
    status_name VARCHAR(50) NOT NULL UNIQUE,
    counts_as_present BOOLEAN NOT NULL DEFAULT FALSE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE student_attendance (
    class_session_id BIGINT UNSIGNED NOT NULL,
    course_offering_section_student_id BIGINT UNSIGNED NOT NULL,
    course_offering_section_id BIGINT UNSIGNED NOT NULL,
    attendance_status_id TINYINT UNSIGNED NOT NULL,
    marked_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    marked_by_user_id BIGINT UNSIGNED NULL,
    remarks VARCHAR(500) NULL,
    PRIMARY KEY (class_session_id, course_offering_section_student_id),
    CONSTRAINT fk_student_attendance_session_owner FOREIGN KEY (class_session_id, course_offering_section_id)
        REFERENCES class_session(class_session_id, course_offering_section_id),
    CONSTRAINT fk_student_attendance_roster_owner FOREIGN KEY (course_offering_section_student_id, course_offering_section_id)
        REFERENCES course_offering_section_student(course_offering_section_student_id, course_offering_section_id),
    CONSTRAINT fk_student_attendance_status FOREIGN KEY (attendance_status_id) REFERENCES attendance_status(attendance_status_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE attendance_correction_request (
    attendance_correction_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    class_session_id BIGINT UNSIGNED NOT NULL,
    course_offering_section_student_id BIGINT UNSIGNED NOT NULL,
    old_status_id TINYINT UNSIGNED NOT NULL,
    requested_status_id TINYINT UNSIGNED NOT NULL,
    reason VARCHAR(1000) NOT NULL,
    request_status ENUM('PENDING','APPROVED','REJECTED','CANCELLED') NOT NULL DEFAULT 'PENDING',
    requested_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    resolved_at TIMESTAMP NULL,
    CONSTRAINT fk_attendance_correction_attendance FOREIGN KEY (class_session_id, course_offering_section_student_id)
        REFERENCES student_attendance(class_session_id, course_offering_section_student_id),
    CONSTRAINT fk_attendance_correction_old FOREIGN KEY (old_status_id) REFERENCES attendance_status(attendance_status_id),
    CONSTRAINT fk_attendance_correction_requested FOREIGN KEY (requested_status_id) REFERENCES attendance_status(attendance_status_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- =============================================================
-- 10. CONTINUOUS ASSESSMENT AND RESULT MODULE
-- =============================================================
CREATE TABLE assessment_component (
    assessment_component_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    course_offering_id BIGINT UNSIGNED NOT NULL,
    component_code VARCHAR(30) NOT NULL,
    component_name VARCHAR(100) NOT NULL,
    component_type ENUM('INTERNAL_TEST','QUIZ','ASSIGNMENT','LAB','PROJECT','PRESENTATION','TERM_WORK','OTHER') NOT NULL,
    maximum_marks DECIMAL(7,2) NOT NULL,
    weightage_percent DECIMAL(5,2) NULL,
    is_mandatory BOOLEAN NOT NULL DEFAULT TRUE,
    CONSTRAINT uq_assessment_component UNIQUE (course_offering_id, component_code),
    CONSTRAINT uq_assessment_component_owner UNIQUE (assessment_component_id, course_offering_id),
    CONSTRAINT chk_assessment_marks CHECK (maximum_marks >= 0),
    CONSTRAINT fk_assessment_component_offering FOREIGN KEY (course_offering_id) REFERENCES course_offering(course_offering_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE assessment_event (
    assessment_event_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    assessment_component_id BIGINT UNSIGNED NOT NULL,
    course_offering_id BIGINT UNSIGNED NOT NULL,
    event_number SMALLINT UNSIGNED NULL,
    event_title VARCHAR(150) NOT NULL,
    assessment_date DATE NOT NULL,
    start_time TIME NULL,
    end_time TIME NULL,
    maximum_marks DECIMAL(7,2) NOT NULL,
    reduced_maximum_marks DECIMAL(7,2) NULL,
    details TEXT NULL,
    status ENUM('PLANNED','CONDUCTED','CANCELLED','PUBLISHED') NOT NULL DEFAULT 'PLANNED',
    CONSTRAINT uq_assessment_event_owner UNIQUE (assessment_event_id, course_offering_id),
    CONSTRAINT chk_assessment_event_marks CHECK (maximum_marks >= 0 AND (reduced_maximum_marks IS NULL OR reduced_maximum_marks >= 0)),
    CONSTRAINT chk_assessment_event_time CHECK (end_time IS NULL OR start_time IS NULL OR end_time > start_time),
    CONSTRAINT fk_assessment_event_component_course FOREIGN KEY (assessment_component_id, course_offering_id)
        REFERENCES assessment_component(assessment_component_id, course_offering_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE student_assessment_mark (
    student_assessment_mark_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    assessment_event_id BIGINT UNSIGNED NOT NULL,
    course_registration_id BIGINT UNSIGNED NOT NULL,
    course_offering_id BIGINT UNSIGNED NOT NULL,
    attendance_status ENUM('PRESENT','ABSENT','EXEMPTED','MALPRACTICE') NOT NULL DEFAULT 'PRESENT',
    marks_obtained DECIMAL(7,2) NULL,
    reduced_marks DECIMAL(7,2) NULL,
    remarks VARCHAR(500) NULL,
    evaluated_at TIMESTAMP NULL,
    CONSTRAINT uq_student_assessment UNIQUE (assessment_event_id, course_registration_id),
    CONSTRAINT chk_student_assessment_marks CHECK (marks_obtained IS NULL OR marks_obtained >= 0),
    CONSTRAINT chk_student_assessment_reduced_marks CHECK (reduced_marks IS NULL OR reduced_marks >= 0),
    CONSTRAINT fk_student_assessment_event_course FOREIGN KEY (assessment_event_id, course_offering_id)
        REFERENCES assessment_event(assessment_event_id, course_offering_id),
    CONSTRAINT fk_student_assessment_registration_course FOREIGN KEY (course_registration_id, course_offering_id)
        REFERENCES student_course_registration(course_registration_id, course_offering_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE grade_scale (
    grade_scale_id SMALLINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    scale_name VARCHAR(100) NOT NULL UNIQUE,
    effective_from DATE NOT NULL,
    effective_to DATE NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE grade_rule (
    grade_rule_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    grade_scale_id SMALLINT UNSIGNED NOT NULL,
    grade_letter VARCHAR(5) NOT NULL,
    grade_point DECIMAL(4,2) NOT NULL,
    minimum_percentage DECIMAL(5,2) NOT NULL,
    maximum_percentage DECIMAL(5,2) NOT NULL,
    result_status ENUM('PASS','FAIL','ABSENT','WITHHELD','EXEMPTED') NOT NULL DEFAULT 'PASS',
    CONSTRAINT uq_grade_rule UNIQUE (grade_scale_id, grade_letter),
    CONSTRAINT chk_grade_range CHECK (maximum_percentage >= minimum_percentage),
    CONSTRAINT fk_grade_rule_scale FOREIGN KEY (grade_scale_id) REFERENCES grade_scale(grade_scale_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE student_course_result (
    student_course_result_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    course_registration_id BIGINT UNSIGNED NOT NULL,
    attempt_number TINYINT UNSIGNED NOT NULL DEFAULT 1,
    internal_marks DECIMAL(7,2) NULL,
    external_marks DECIMAL(7,2) NULL,
    total_marks DECIMAL(7,2) NULL,
    grade_letter VARCHAR(5) NULL,
    grade_point DECIMAL(4,2) NULL,
    credits_earned DECIMAL(4,1) NOT NULL DEFAULT 0,
    result_status ENUM('PASS','FAIL','ABSENT','WITHHELD','EXEMPTED','INCOMPLETE') NOT NULL,
    result_date DATE NULL,
    remarks VARCHAR(500) NULL,
    CONSTRAINT uq_course_result_attempt UNIQUE (course_registration_id, attempt_number),
    CONSTRAINT fk_course_result_registration FOREIGN KEY (course_registration_id) REFERENCES student_course_registration(course_registration_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE student_term_result (
    student_term_result_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    term_registration_id BIGINT UNSIGNED NOT NULL UNIQUE,
    credits_registered DECIMAL(6,1) NOT NULL DEFAULT 0,
    credits_earned DECIMAL(6,1) NOT NULL DEFAULT 0,
    sgpa DECIMAL(4,2) NULL,
    cgpa DECIMAL(4,2) NULL,
    result_status ENUM('PASS','FAIL','PROMOTED','WITHHELD','INCOMPLETE') NOT NULL,
    published_at TIMESTAMP NULL,
    CONSTRAINT fk_term_result_registration FOREIGN KEY (term_registration_id) REFERENCES student_term_registration(term_registration_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- =============================================================
-- 11. FEEDBACK MODULE
-- =============================================================
CREATE TABLE feedback_question_category (
    feedback_category_id SMALLINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    category_code VARCHAR(30) NOT NULL UNIQUE,
    category_name VARCHAR(100) NOT NULL UNIQUE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE feedback_question (
    feedback_question_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    feedback_category_id SMALLINT UNSIGNED NOT NULL,
    question_text VARCHAR(1000) NOT NULL,
    response_type ENUM('SINGLE_CHOICE','MULTIPLE_CHOICE','RATING','TEXT') NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    CONSTRAINT fk_feedback_question_category FOREIGN KEY (feedback_category_id) REFERENCES feedback_question_category(feedback_category_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE feedback_choice (
    feedback_choice_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    feedback_question_id INT UNSIGNED NOT NULL,
    choice_text VARCHAR(250) NOT NULL,
    score DECIMAL(6,2) NULL,
    display_order SMALLINT UNSIGNED NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    CONSTRAINT uq_feedback_choice UNIQUE (feedback_question_id, choice_text),
    CONSTRAINT fk_feedback_choice_question FOREIGN KEY (feedback_question_id) REFERENCES feedback_question(feedback_question_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE feedback_questionnaire (
    questionnaire_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    questionnaire_code VARCHAR(30) NOT NULL UNIQUE,
    questionnaire_name VARCHAR(150) NOT NULL,
    questionnaire_type ENUM('COURSE','FACULTY','PROGRAMME','INSTITUTION','EXIT','OTHER') NOT NULL,
    is_anonymous BOOLEAN NOT NULL DEFAULT TRUE,
    status ENUM('DRAFT','ACTIVE','RETIRED') NOT NULL DEFAULT 'DRAFT'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE feedback_questionnaire_item (
    questionnaire_item_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    questionnaire_id INT UNSIGNED NOT NULL,
    feedback_question_id INT UNSIGNED NOT NULL,
    weightage DECIMAL(6,2) NULL,
    display_order SMALLINT UNSIGNED NOT NULL,
    is_required BOOLEAN NOT NULL DEFAULT TRUE,
    CONSTRAINT uq_questionnaire_question UNIQUE (questionnaire_id, feedback_question_id),
    CONSTRAINT fk_questionnaire_item_questionnaire FOREIGN KEY (questionnaire_id) REFERENCES feedback_questionnaire(questionnaire_id),
    CONSTRAINT fk_questionnaire_item_question FOREIGN KEY (feedback_question_id) REFERENCES feedback_question(feedback_question_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE feedback_cycle (
    feedback_cycle_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    questionnaire_id INT UNSIGNED NOT NULL,
    academic_term_id INT UNSIGNED NOT NULL,
    cycle_name VARCHAR(150) NOT NULL,
    start_at DATETIME NOT NULL,
    end_at DATETIME NOT NULL,
    result_visibility ENUM('HIDDEN','ADMIN_ONLY','FACULTY','PUBLIC') NOT NULL DEFAULT 'HIDDEN',
    status ENUM('SCHEDULED','OPEN','CLOSED','CANCELLED') NOT NULL DEFAULT 'SCHEDULED',
    CONSTRAINT chk_feedback_cycle_dates CHECK (end_at > start_at),
    CONSTRAINT fk_feedback_cycle_questionnaire FOREIGN KEY (questionnaire_id) REFERENCES feedback_questionnaire(questionnaire_id),
    CONSTRAINT fk_feedback_cycle_term FOREIGN KEY (academic_term_id) REFERENCES academic_term(academic_term_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE feedback_response (
    feedback_response_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    feedback_cycle_id BIGINT UNSIGNED NOT NULL,
    term_registration_id BIGINT UNSIGNED NULL,
    course_offering_id BIGINT UNSIGNED NULL,
    faculty_assignment_id BIGINT UNSIGNED NULL,
    submitted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    response_token CHAR(36) NULL UNIQUE,
    CONSTRAINT fk_feedback_response_cycle FOREIGN KEY (feedback_cycle_id) REFERENCES feedback_cycle(feedback_cycle_id),
    CONSTRAINT fk_feedback_response_term_registration FOREIGN KEY (term_registration_id) REFERENCES student_term_registration(term_registration_id),
    CONSTRAINT fk_feedback_response_course FOREIGN KEY (course_offering_id) REFERENCES course_offering(course_offering_id),
    CONSTRAINT fk_feedback_response_faculty FOREIGN KEY (faculty_assignment_id) REFERENCES faculty_course_assignment(faculty_assignment_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE feedback_response_item (
    feedback_response_item_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    feedback_response_id BIGINT UNSIGNED NOT NULL,
    questionnaire_item_id BIGINT UNSIGNED NOT NULL,
    feedback_choice_id INT UNSIGNED NULL,
    numeric_score DECIMAL(6,2) NULL,
    text_response TEXT NULL,
    CONSTRAINT uq_feedback_response_item UNIQUE (feedback_response_id, questionnaire_item_id),
    CONSTRAINT fk_feedback_item_response FOREIGN KEY (feedback_response_id) REFERENCES feedback_response(feedback_response_id),
    CONSTRAINT fk_feedback_item_questionnaire_item FOREIGN KEY (questionnaire_item_id) REFERENCES feedback_questionnaire_item(questionnaire_item_id),
    CONSTRAINT fk_feedback_item_choice FOREIGN KEY (feedback_choice_id) REFERENCES feedback_choice(feedback_choice_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- =============================================================
-- 12. MENTORING, COUNSELLING AND GRIEVANCE MODULE
-- =============================================================
CREATE TABLE mentor_assignment (
    mentor_assignment_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    student_id BIGINT UNSIGNED NOT NULL,
    employee_id BIGINT UNSIGNED NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NULL,
    assignment_status ENUM('ACTIVE','COMPLETED','CANCELLED') NOT NULL DEFAULT 'ACTIVE',
    CONSTRAINT fk_mentor_assignment_student FOREIGN KEY (student_id) REFERENCES student(student_id),
    CONSTRAINT fk_mentor_assignment_employee FOREIGN KEY (employee_id) REFERENCES employee(employee_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE counselling_session (
    counselling_session_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    mentor_assignment_id BIGINT UNSIGNED NOT NULL,
    session_date DATETIME NOT NULL,
    observations TEXT NULL,
    action_plan TEXT NULL,
    follow_up_date DATE NULL,
    session_status ENUM('SCHEDULED','COMPLETED','CANCELLED','FOLLOW_UP_REQUIRED') NOT NULL DEFAULT 'COMPLETED',
    confidentiality_level ENUM('NORMAL','RESTRICTED','HIGHLY_RESTRICTED') NOT NULL DEFAULT 'RESTRICTED',
    CONSTRAINT fk_counselling_mentor_assignment FOREIGN KEY (mentor_assignment_id) REFERENCES mentor_assignment(mentor_assignment_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE grievance_category (
    grievance_category_id SMALLINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    category_code VARCHAR(30) NOT NULL UNIQUE,
    category_name VARCHAR(100) NOT NULL UNIQUE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE grievance (
    grievance_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    grievance_number VARCHAR(30) NOT NULL UNIQUE,
    student_id BIGINT UNSIGNED NOT NULL,
    grievance_category_id SMALLINT UNSIGNED NOT NULL,
    department_id SMALLINT UNSIGNED NULL,
    submitted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    subject VARCHAR(200) NOT NULL,
    description TEXT NOT NULL,
    priority ENUM('LOW','NORMAL','HIGH','URGENT') NOT NULL DEFAULT 'NORMAL',
    status ENUM('SUBMITTED','ASSIGNED','UNDER_REVIEW','RESOLVED','REJECTED','CLOSED') NOT NULL DEFAULT 'SUBMITTED',
    resolved_at DATETIME NULL,
    resolution TEXT NULL,
    CONSTRAINT fk_grievance_student FOREIGN KEY (student_id) REFERENCES student(student_id),
    CONSTRAINT fk_grievance_category FOREIGN KEY (grievance_category_id) REFERENCES grievance_category(grievance_category_id),
    CONSTRAINT fk_grievance_department FOREIGN KEY (department_id) REFERENCES department(department_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE grievance_action (
    grievance_action_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    grievance_id BIGINT UNSIGNED NOT NULL,
    action_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    action_type VARCHAR(50) NOT NULL,
    action_notes TEXT NULL,
    new_status VARCHAR(30) NULL,
    CONSTRAINT fk_grievance_action_grievance FOREIGN KEY (grievance_id) REFERENCES grievance(grievance_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- =============================================================
-- 13. DOCUMENT, CERTIFICATE AND EXIT MODULE
-- =============================================================
CREATE TABLE file_object (
    file_object_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    storage_provider VARCHAR(30) NOT NULL,
    storage_key VARCHAR(500) NOT NULL UNIQUE,
    original_file_name VARCHAR(255) NOT NULL,
    mime_type VARCHAR(100) NOT NULL,
    file_size_bytes BIGINT UNSIGNED NOT NULL,
    checksum_sha256 CHAR(64) NULL,
    uploaded_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- Added metadata; original columns above remain unchanged.
    stored_file_name VARCHAR(255) NULL,
    storage_url VARCHAR(1000) NULL,
    file_extension VARCHAR(20) NULL,
    confidentiality_level ENUM('PUBLIC','INTERNAL','CONFIDENTIAL','RESTRICTED','HIGHLY_RESTRICTED') NOT NULL DEFAULT 'INTERNAL',
    is_encrypted BOOLEAN NOT NULL DEFAULT FALSE,
    uploaded_by_user_id BIGINT UNSIGNED NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP NULL,
    CONSTRAINT chk_file_object_size CHECK (file_size_bytes > 0),
    CONSTRAINT chk_file_object_checksum CHECK (checksum_sha256 IS NULL OR checksum_sha256 REGEXP '^[0-9A-Fa-f]{64}$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE student_document (
    student_document_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    student_id BIGINT UNSIGNED NOT NULL,
    document_type_id SMALLINT UNSIGNED NOT NULL,
    file_object_id BIGINT UNSIGNED NOT NULL,
    document_number VARCHAR(100) NULL,
    issue_date DATE NULL,
    expiry_date DATE NULL,
    verification_status ENUM('PENDING','VERIFIED','REJECTED','EXPIRED') NOT NULL DEFAULT 'PENDING',
    verified_at DATETIME NULL,
    remarks VARCHAR(500) NULL,
    CONSTRAINT uq_student_document UNIQUE (student_id, document_type_id, document_number),
    CONSTRAINT fk_student_document_student FOREIGN KEY (student_id) REFERENCES student(student_id),
    CONSTRAINT fk_student_document_type FOREIGN KEY (document_type_id) REFERENCES document_type(document_type_id),
    CONSTRAINT fk_student_document_file FOREIGN KEY (file_object_id) REFERENCES file_object(file_object_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE certificate_type (
    certificate_type_id SMALLINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    certificate_code VARCHAR(30) NOT NULL UNIQUE,
    certificate_name VARCHAR(100) NOT NULL UNIQUE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE certificate_request (
    certificate_request_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    request_number VARCHAR(30) NOT NULL UNIQUE,
    student_id BIGINT UNSIGNED NOT NULL,
    certificate_type_id SMALLINT UNSIGNED NOT NULL,
    requested_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    purpose VARCHAR(500) NULL,
    request_status ENUM('SUBMITTED','UNDER_REVIEW','APPROVED','REJECTED','ISSUED','CANCELLED') NOT NULL DEFAULT 'SUBMITTED',
    issued_at DATETIME NULL,
    certificate_number VARCHAR(50) NULL UNIQUE,
    file_object_id BIGINT UNSIGNED NULL,
    CONSTRAINT fk_certificate_request_student FOREIGN KEY (student_id) REFERENCES student(student_id),
    CONSTRAINT fk_certificate_request_type FOREIGN KEY (certificate_type_id) REFERENCES certificate_type(certificate_type_id),
    CONSTRAINT fk_certificate_request_file FOREIGN KEY (file_object_id) REFERENCES file_object(file_object_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE student_exit (
    student_exit_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    enrolment_id BIGINT UNSIGNED NOT NULL,
    exit_type ENUM('COMPLETION','TRANSFER','WITHDRAWAL','TERMINATION','OTHER') NOT NULL,
    exit_date DATE NOT NULL,
    destination_institution VARCHAR(250) NULL,
    old_registration_number VARCHAR(50) NULL,
    remarks TEXT NULL,
    CONSTRAINT uq_student_exit_enrolment UNIQUE (enrolment_id),
    CONSTRAINT fk_student_exit_enrolment FOREIGN KEY (enrolment_id) REFERENCES student_programme_enrolment(enrolment_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- =============================================================
-- 14. COMMUNICATION MODULE
-- =============================================================
CREATE TABLE announcement_type (
    announcement_type_id SMALLINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    type_code VARCHAR(30) NOT NULL UNIQUE,
    type_name VARCHAR(100) NOT NULL UNIQUE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE announcement (
    announcement_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    announcement_type_id SMALLINT UNSIGNED NOT NULL,
    department_id SMALLINT UNSIGNED NULL,
    title VARCHAR(250) NOT NULL,
    description TEXT NOT NULL,
    publish_from DATETIME NOT NULL,
    publish_to DATETIME NULL,
    approval_status ENUM('DRAFT','PENDING','APPROVED','REJECTED','ARCHIVED') NOT NULL DEFAULT 'DRAFT',
    audience_type ENUM('ALL','STUDENTS','STAFF','PROGRAMME','DEPARTMENT','CUSTOM') NOT NULL DEFAULT 'ALL',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_announcement_type FOREIGN KEY (announcement_type_id) REFERENCES announcement_type(announcement_type_id),
    CONSTRAINT fk_announcement_department FOREIGN KEY (department_id) REFERENCES department(department_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE announcement_attachment (
    announcement_id BIGINT UNSIGNED NOT NULL,
    file_object_id BIGINT UNSIGNED NOT NULL,
    display_order SMALLINT UNSIGNED NULL,
    PRIMARY KEY (announcement_id, file_object_id),
    CONSTRAINT fk_announcement_attachment_announcement FOREIGN KEY (announcement_id) REFERENCES announcement(announcement_id),
    CONSTRAINT fk_announcement_attachment_file FOREIGN KEY (file_object_id) REFERENCES file_object(file_object_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- =============================================================
-- 15. IDENTITY, ACCESS CONTROL (RBAC) AND AUDIT MODULE
-- =============================================================
CREATE TABLE user_account (
    user_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(100) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    email VARCHAR(254) NULL,
    account_status ENUM('PENDING','ACTIVE','LOCKED','DISABLED','EXPIRED') NOT NULL DEFAULT 'ACTIVE',
    must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
    multi_factor_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    failed_login_count SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    locked_until DATETIME NULL,
    password_changed_at DATETIME NULL,
    last_login_at DATETIME NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE student_user_account (
    student_id BIGINT UNSIGNED PRIMARY KEY,
    user_id BIGINT UNSIGNED NOT NULL UNIQUE,
    linked_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_student_user_student FOREIGN KEY (student_id) REFERENCES student(student_id),
    CONSTRAINT fk_student_user_account FOREIGN KEY (user_id) REFERENCES user_account(user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE employee_user_account (
    employee_id BIGINT UNSIGNED PRIMARY KEY,
    user_id BIGINT UNSIGNED NOT NULL UNIQUE,
    linked_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_employee_user_employee FOREIGN KEY (employee_id) REFERENCES employee(employee_id),
    CONSTRAINT fk_employee_user_account FOREIGN KEY (user_id) REFERENCES user_account(user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE access_module (
    access_module_id SMALLINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    module_code VARCHAR(50) NOT NULL UNIQUE,
    module_name VARCHAR(100) NOT NULL UNIQUE,
    description VARCHAR(500) NULL,
    display_order SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT TRUE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE access_resource (
    access_resource_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    access_module_id SMALLINT UNSIGNED NOT NULL,
    resource_code VARCHAR(80) NOT NULL,
    resource_name VARCHAR(150) NOT NULL,
    description VARCHAR(500) NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    CONSTRAINT uq_access_resource UNIQUE (access_module_id, resource_code),
    CONSTRAINT fk_access_resource_module FOREIGN KEY (access_module_id) REFERENCES access_module(access_module_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE access_action (
    access_action_id TINYINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    action_code VARCHAR(30) NOT NULL UNIQUE,
    action_name VARCHAR(80) NOT NULL UNIQUE,
    description VARCHAR(300) NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE permission (
    permission_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    access_resource_id INT UNSIGNED NOT NULL,
    access_action_id TINYINT UNSIGNED NOT NULL,
    permission_code VARCHAR(150) NOT NULL UNIQUE,
    permission_name VARCHAR(200) NOT NULL,
    description VARCHAR(500) NULL,
    is_sensitive BOOLEAN NOT NULL DEFAULT FALSE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    CONSTRAINT uq_permission_resource_action UNIQUE (access_resource_id, access_action_id),
    CONSTRAINT fk_permission_resource FOREIGN KEY (access_resource_id) REFERENCES access_resource(access_resource_id),
    CONSTRAINT fk_permission_action FOREIGN KEY (access_action_id) REFERENCES access_action(access_action_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE role (
    role_id SMALLINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    parent_role_id SMALLINT UNSIGNED NULL,
    role_code VARCHAR(60) NOT NULL UNIQUE,
    role_name VARCHAR(120) NOT NULL UNIQUE,
    role_category ENUM('SYSTEM','GOVERNANCE','ACADEMIC','ADMINISTRATIVE','FACULTY','STUDENT','PARENT','AUDIT','SUPPORT') NOT NULL,
    role_level ENUM('GLOBAL','INSTITUTION','CAMPUS','DEPARTMENT','PROGRAMME','SELF') NOT NULL DEFAULT 'GLOBAL',
    description VARCHAR(500) NULL,
    is_system_role BOOLEAN NOT NULL DEFAULT FALSE,
    is_assignable BOOLEAN NOT NULL DEFAULT TRUE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_role_parent FOREIGN KEY (parent_role_id) REFERENCES role(role_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE role_permission (
    role_id SMALLINT UNSIGNED NOT NULL,
    permission_id INT UNSIGNED NOT NULL,
    permission_effect ENUM('ALLOW','DENY') NOT NULL DEFAULT 'ALLOW',
    granted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (role_id, permission_id),
    CONSTRAINT fk_role_permission_role FOREIGN KEY (role_id) REFERENCES role(role_id),
    CONSTRAINT fk_role_permission_permission FOREIGN KEY (permission_id) REFERENCES permission(permission_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE user_role_assignment (
    user_role_assignment_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT UNSIGNED NOT NULL,
    role_id SMALLINT UNSIGNED NOT NULL,
    scope_type ENUM('GLOBAL','INSTITUTION','CAMPUS','DEPARTMENT','PROGRAMME','SELF') NOT NULL DEFAULT 'GLOBAL',
    institution_id SMALLINT UNSIGNED NULL,
    campus_id SMALLINT UNSIGNED NULL,
    department_id SMALLINT UNSIGNED NULL,
    programme_id SMALLINT UNSIGNED NULL,
    scope_entity_id BIGINT UNSIGNED GENERATED ALWAYS AS (
        CASE scope_type
            WHEN 'GLOBAL' THEN 0
            WHEN 'INSTITUTION' THEN institution_id
            WHEN 'CAMPUS' THEN campus_id
            WHEN 'DEPARTMENT' THEN department_id
            WHEN 'PROGRAMME' THEN programme_id
            WHEN 'SELF' THEN user_id
        END
    ) STORED,
    valid_from DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    valid_to DATETIME NULL,
    assignment_status ENUM('PENDING','ACTIVE','SUSPENDED','EXPIRED','REVOKED') NOT NULL DEFAULT 'ACTIVE',
    is_primary BOOLEAN NOT NULL DEFAULT FALSE,
    assigned_by_user_id BIGINT UNSIGNED NULL,
    assignment_reason VARCHAR(500) NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_user_role_dates CHECK (valid_to IS NULL OR valid_to > valid_from),
    CONSTRAINT chk_user_role_scope CHECK (
        (scope_type = 'GLOBAL' AND institution_id IS NULL AND campus_id IS NULL AND department_id IS NULL AND programme_id IS NULL) OR
        (scope_type = 'INSTITUTION' AND institution_id IS NOT NULL AND campus_id IS NULL AND department_id IS NULL AND programme_id IS NULL) OR
        (scope_type = 'CAMPUS' AND institution_id IS NULL AND campus_id IS NOT NULL AND department_id IS NULL AND programme_id IS NULL) OR
        (scope_type = 'DEPARTMENT' AND institution_id IS NULL AND campus_id IS NULL AND department_id IS NOT NULL AND programme_id IS NULL) OR
        (scope_type = 'PROGRAMME' AND institution_id IS NULL AND campus_id IS NULL AND department_id IS NULL AND programme_id IS NOT NULL) OR
        (scope_type = 'SELF' AND institution_id IS NULL AND campus_id IS NULL AND department_id IS NULL AND programme_id IS NULL)
    ),
    CONSTRAINT uq_user_role_assignment UNIQUE (user_id, role_id, scope_type, scope_entity_id, valid_from),
    CONSTRAINT fk_user_role_assignment_user FOREIGN KEY (user_id) REFERENCES user_account(user_id),
    CONSTRAINT fk_user_role_assignment_role FOREIGN KEY (role_id) REFERENCES role(role_id),
    CONSTRAINT fk_user_role_assignment_institution FOREIGN KEY (institution_id) REFERENCES institution(institution_id),
    CONSTRAINT fk_user_role_assignment_campus FOREIGN KEY (campus_id) REFERENCES campus(campus_id),
    CONSTRAINT fk_user_role_assignment_department FOREIGN KEY (department_id) REFERENCES department(department_id),
    CONSTRAINT fk_user_role_assignment_programme FOREIGN KEY (programme_id) REFERENCES programme(programme_id),
    CONSTRAINT fk_user_role_assignment_assigned_by FOREIGN KEY (assigned_by_user_id) REFERENCES user_account(user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE user_permission_override (
    user_permission_override_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT UNSIGNED NOT NULL,
    permission_id INT UNSIGNED NOT NULL,
    permission_effect ENUM('ALLOW','DENY') NOT NULL,
    scope_type ENUM('GLOBAL','INSTITUTION','CAMPUS','DEPARTMENT','PROGRAMME','SELF') NOT NULL DEFAULT 'GLOBAL',
    scope_entity_id BIGINT UNSIGNED NULL,
    normalized_scope_entity_id BIGINT UNSIGNED GENERATED ALWAYS AS (
        CASE WHEN scope_type IN ('GLOBAL','SELF') THEN 0 ELSE COALESCE(scope_entity_id, 0) END
    ) STORED,
    valid_from DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    valid_to DATETIME NULL,
    granted_by_user_id BIGINT UNSIGNED NULL,
    justification VARCHAR(500) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_user_permission_override_dates CHECK (valid_to IS NULL OR valid_to > valid_from),
    CONSTRAINT chk_user_permission_override_scope CHECK (
        (scope_type IN ('GLOBAL','SELF') AND scope_entity_id IS NULL) OR
        (scope_type IN ('INSTITUTION','CAMPUS','DEPARTMENT','PROGRAMME') AND scope_entity_id IS NOT NULL)
    ),
    CONSTRAINT uq_user_permission_override UNIQUE (user_id, permission_id, scope_type, normalized_scope_entity_id, valid_from),
    CONSTRAINT fk_user_permission_override_user FOREIGN KEY (user_id) REFERENCES user_account(user_id),
    CONSTRAINT fk_user_permission_override_permission FOREIGN KEY (permission_id) REFERENCES permission(permission_id),
    CONSTRAINT fk_user_permission_override_granted_by FOREIGN KEY (granted_by_user_id) REFERENCES user_account(user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE role_delegation (
    role_delegation_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    delegator_user_id BIGINT UNSIGNED NOT NULL,
    delegate_user_id BIGINT UNSIGNED NOT NULL,
    source_assignment_id BIGINT UNSIGNED NOT NULL,
    valid_from DATETIME NOT NULL,
    valid_to DATETIME NOT NULL,
    delegation_status ENUM('PENDING','ACTIVE','REVOKED','EXPIRED') NOT NULL DEFAULT 'PENDING',
    reason VARCHAR(500) NOT NULL,
    approved_by_user_id BIGINT UNSIGNED NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_role_delegation_dates CHECK (valid_to > valid_from),
    CONSTRAINT chk_role_delegation_users CHECK (delegator_user_id <> delegate_user_id),
    CONSTRAINT fk_role_delegation_delegator FOREIGN KEY (delegator_user_id) REFERENCES user_account(user_id),
    CONSTRAINT fk_role_delegation_delegate FOREIGN KEY (delegate_user_id) REFERENCES user_account(user_id),
    CONSTRAINT fk_role_delegation_assignment FOREIGN KEY (source_assignment_id) REFERENCES user_role_assignment(user_role_assignment_id),
    CONSTRAINT fk_role_delegation_approved_by FOREIGN KEY (approved_by_user_id) REFERENCES user_account(user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE password_history (
    password_history_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT UNSIGNED NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    changed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_password_history_user FOREIGN KEY (user_id) REFERENCES user_account(user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE login_audit (
    login_audit_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT UNSIGNED NULL,
    username_attempted VARCHAR(100) NOT NULL,
    login_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    logout_at DATETIME NULL,
    ip_address VARCHAR(45) NULL,
    user_agent VARCHAR(500) NULL,
    was_successful BOOLEAN NOT NULL,
    failure_reason VARCHAR(200) NULL,
    session_identifier VARCHAR(128) NULL,
    CONSTRAINT fk_login_audit_user FOREIGN KEY (user_id) REFERENCES user_account(user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE activity_audit (
    activity_audit_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT UNSIGNED NULL,
    module_code VARCHAR(50) NOT NULL,
    action_code VARCHAR(30) NOT NULL,
    entity_name VARCHAR(100) NULL,
    entity_id VARCHAR(100) NULL,
    activity_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ip_address VARCHAR(45) NULL,
    request_identifier VARCHAR(128) NULL,
    before_values JSON NULL,
    after_values JSON NULL,
    details JSON NULL,
    CONSTRAINT fk_activity_audit_user FOREIGN KEY (user_id) REFERENCES user_account(user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

ALTER TABLE student_attendance
    ADD CONSTRAINT fk_student_attendance_marked_by
    FOREIGN KEY (marked_by_user_id) REFERENCES user_account(user_id);

ALTER TABLE file_object
    ADD CONSTRAINT fk_file_object_uploaded_by
    FOREIGN KEY (uploaded_by_user_id) REFERENCES user_account(user_id);

-- -------------------------------------------------------------
-- RBAC REFERENCE DATA (original catalogue preserved)
-- -------------------------------------------------------------
INSERT INTO access_action (action_code, action_name, description) VALUES
('CREATE','Create','Create a new record'),
('READ','Read','View a record or list'),
('UPDATE','Update','Modify an existing record'),
('DELETE','Delete','Soft-delete or remove a record where permitted'),
('APPROVE','Approve','Approve or reject a workflow item'),
('PUBLISH','Publish','Publish an approved record'),
('EXPORT','Export','Export data or reports'),
('ASSIGN','Assign','Assign users, faculty, students or responsibilities'),
('VERIFY','Verify','Verify submitted data or documents'),
('CONFIGURE','Configure','Change module configuration'),
('IMPERSONATE','Impersonate','Access the system as another user for support');

INSERT INTO access_module (module_code, module_name, display_order) VALUES
('IAM','Identity and Access Management',1),
('INSTITUTION','Institution Structure',2),
('ACADEMIC_CALENDAR','Academic Calendar',3),
('CURRICULUM','Curriculum and Course Catalog',4),
('STUDENT','Student Records',5),
('EMPLOYEE','Employee Records',6),
('ADMISSION','Admissions',7),
('REGISTRATION','Registration and Enrolment',8),
('TEACHING','Course Offering and Teaching',9),
('TIMETABLE','Timetable',10),
('ATTENDANCE','Attendance',11),
('ASSESSMENT','Continuous Assessment',12),
('RESULT','Examination and Results',13),
('FEEDBACK','Feedback',14),
('MENTORING','Mentoring and Counselling',15),
('GRIEVANCE','Grievance',16),
('DOCUMENT','Documents and Certificates',17),
('COMMUNICATION','Announcements and Notifications',18),
('REPORTING','Reports and Analytics',19),
('AUDIT','Audit and Compliance',20);

INSERT INTO access_resource (access_module_id, resource_code, resource_name)
SELECT access_module_id, 'ALL', CONCAT(module_name, ' - All Resources') FROM access_module;

INSERT INTO permission (access_resource_id, access_action_id, permission_code, permission_name, is_sensitive)
SELECT r.access_resource_id, a.access_action_id,
       CONCAT(m.module_code, '.', r.resource_code, '.', a.action_code),
       CONCAT(a.action_name, ' ', m.module_name),
       CASE WHEN m.module_code IN ('IAM','AUDIT','RESULT','STUDENT','EMPLOYEE')
                 AND a.action_code IN ('UPDATE','DELETE','APPROVE','EXPORT','CONFIGURE','IMPERSONATE')
            THEN TRUE ELSE FALSE END
FROM access_module m
JOIN access_resource r ON r.access_module_id = m.access_module_id
CROSS JOIN access_action a;

INSERT INTO role (role_code, role_name, role_category, role_level, description, is_system_role) VALUES
('SUPER_ADMIN','Super Administrator','SYSTEM','GLOBAL','Unrestricted platform administration and emergency access',TRUE),
('SYSTEM_ADMIN','System Administrator','SYSTEM','GLOBAL','User, configuration and technical administration',TRUE),
('SECURITY_ADMIN','Security Administrator','SYSTEM','GLOBAL','Security policy, roles, permissions and audit review',TRUE),
('DATABASE_ADMIN','Database Administrator','SYSTEM','GLOBAL','Database operations, migration and recovery oversight',TRUE),
('VICE_CHANCELLOR','Vice Chancellor','GOVERNANCE','INSTITUTION','University-wide governance dashboards and approvals',FALSE),
('REGISTRAR','Registrar','GOVERNANCE','INSTITUTION','Official student records and administrative approvals',FALSE),
('DEAN_ACADEMICS','Dean Academics','ACADEMIC','INSTITUTION','Curriculum, academic calendar and academic governance',FALSE),
('CONTROLLER_EXAMINATIONS','Controller of Examinations','ACADEMIC','INSTITUTION','Examination, result processing and publication',FALSE),
('FINANCE_OFFICER','Finance Officer','ADMINISTRATIVE','INSTITUTION','Financial review and approval',FALSE),
('CAMPUS_DIRECTOR','Campus Director','GOVERNANCE','CAMPUS','Campus-level administration and monitoring',FALSE),
('HEAD_DEPARTMENT','Head of Department','ACADEMIC','DEPARTMENT','Department administration and approvals',FALSE),
('PROGRAMME_COORDINATOR','Programme Coordinator','ACADEMIC','PROGRAMME','Programme planning and academic coordination',FALSE),
('SEMESTER_COORDINATOR','Semester Coordinator','ACADEMIC','PROGRAMME','Semester operations and coordination',FALSE),
('TIMETABLE_COORDINATOR','Timetable Coordinator','ACADEMIC','DEPARTMENT','Timetable preparation and maintenance',FALSE),
('COURSE_COORDINATOR','Course Coordinator','FACULTY','DEPARTMENT','Course delivery and assessment coordination',FALSE),
('FACULTY','Faculty','FACULTY','DEPARTMENT','Teaching, attendance and assessment for assigned offerings',FALSE),
('LAB_INSTRUCTOR','Laboratory Instructor','FACULTY','DEPARTMENT','Laboratory delivery, attendance and assessment',FALSE),
('FACULTY_ADVISOR','Faculty Advisor','FACULTY','PROGRAMME','Academic advising for assigned students',FALSE),
('MENTOR','Mentor','FACULTY','PROGRAMME','Mentoring and follow-up for assigned students',FALSE),
('ADMISSION_OFFICER','Admission Officer','ADMINISTRATIVE','INSTITUTION','Admission processing and approval',FALSE),
('DOCUMENT_VERIFIER','Document Verification Officer','ADMINISTRATIVE','INSTITUTION','Admission and student document verification',FALSE),
('STUDENT_SECTION_OFFICER','Student Section Officer','ADMINISTRATIVE','INSTITUTION','Student record administration and certificates',FALSE),
('EXAMINATION_OFFICER','Examination Officer','ADMINISTRATIVE','INSTITUTION','Examination operations and marks processing',FALSE),
('EVALUATOR','Evaluator','FACULTY','DEPARTMENT','Assessment and examination mark entry',FALSE),
('RESULT_APPROVER','Result Approver','ACADEMIC','INSTITUTION','Result verification, approval and publication',FALSE),
('GRIEVANCE_OFFICER','Grievance Officer','ADMINISTRATIVE','INSTITUTION','Grievance review, assignment and closure',FALSE),
('INTERNAL_AUDITOR','Internal Auditor','AUDIT','INSTITUTION','Read-only audit, compliance and controlled export',FALSE),
('EXTERNAL_AUDITOR','External Auditor','AUDIT','INSTITUTION','Time-bound read-only audit access',FALSE),
('STUDENT','Student','STUDENT','SELF','Self-service access to own academic information',TRUE),
('APPLICANT','Applicant','STUDENT','SELF','Admission application self-service',TRUE),
('PARENT_GUARDIAN','Parent or Guardian','PARENT','SELF','Authorized view of linked student information',TRUE),
('ALUMNI','Alumni','STUDENT','SELF','Graduate self-service and document requests',TRUE);

INSERT INTO role_permission (role_id, permission_id)
SELECT r.role_id, p.permission_id FROM role r CROSS JOIN permission p
WHERE r.role_code = 'SUPER_ADMIN';

INSERT INTO role_permission (role_id, permission_id)
SELECT r.role_id, p.permission_id FROM role r CROSS JOIN permission p
JOIN access_resource ar ON ar.access_resource_id = p.access_resource_id
JOIN access_module am ON am.access_module_id = ar.access_module_id
JOIN access_action aa ON aa.access_action_id = p.access_action_id
WHERE r.role_code = 'SYSTEM_ADMIN'
  AND am.module_code IN ('IAM','INSTITUTION','ACADEMIC_CALENDAR','COMMUNICATION','REPORTING','AUDIT')
  AND aa.action_code NOT IN ('IMPERSONATE');

INSERT INTO role_permission (role_id, permission_id)
SELECT r.role_id, p.permission_id FROM role r CROSS JOIN permission p
JOIN access_resource ar ON ar.access_resource_id = p.access_resource_id
JOIN access_module am ON am.access_module_id = ar.access_module_id
JOIN access_action aa ON aa.access_action_id = p.access_action_id
WHERE r.role_code = 'SECURITY_ADMIN' AND am.module_code IN ('IAM','AUDIT')
  AND aa.action_code IN ('CREATE','READ','UPDATE','APPROVE','ASSIGN','CONFIGURE','EXPORT');

INSERT INTO role_permission (role_id, permission_id)
SELECT r.role_id, p.permission_id FROM role r CROSS JOIN permission p
JOIN access_resource ar ON ar.access_resource_id = p.access_resource_id
JOIN access_module am ON am.access_module_id = ar.access_module_id
JOIN access_action aa ON aa.access_action_id = p.access_action_id
WHERE r.role_code IN ('VICE_CHANCELLOR','REGISTRAR','DEAN_ACADEMICS','CAMPUS_DIRECTOR','HEAD_DEPARTMENT')
  AND am.module_code NOT IN ('IAM') AND aa.action_code IN ('READ','EXPORT');

INSERT INTO role_permission (role_id, permission_id)
SELECT r.role_id, p.permission_id FROM role r CROSS JOIN permission p
JOIN access_resource ar ON ar.access_resource_id = p.access_resource_id
JOIN access_module am ON am.access_module_id = ar.access_module_id
JOIN access_action aa ON aa.access_action_id = p.access_action_id
WHERE r.role_code IN ('REGISTRAR','DEAN_ACADEMICS','CAMPUS_DIRECTOR','HEAD_DEPARTMENT')
  AND am.module_code IN ('ACADEMIC_CALENDAR','CURRICULUM','STUDENT','REGISTRATION','TEACHING','TIMETABLE','ATTENDANCE','ASSESSMENT','DOCUMENT','COMMUNICATION')
  AND aa.action_code IN ('CREATE','UPDATE','APPROVE','ASSIGN','PUBLISH');

INSERT INTO role_permission (role_id, permission_id)
SELECT r.role_id, p.permission_id FROM role r CROSS JOIN permission p
JOIN access_resource ar ON ar.access_resource_id = p.access_resource_id
JOIN access_module am ON am.access_module_id = ar.access_module_id
JOIN access_action aa ON aa.access_action_id = p.access_action_id
WHERE r.role_code IN ('PROGRAMME_COORDINATOR','SEMESTER_COORDINATOR','TIMETABLE_COORDINATOR','COURSE_COORDINATOR','FACULTY','LAB_INSTRUCTOR','FACULTY_ADVISOR','MENTOR')
  AND am.module_code IN ('ACADEMIC_CALENDAR','CURRICULUM','STUDENT','REGISTRATION','TEACHING','TIMETABLE','ATTENDANCE','ASSESSMENT','RESULT','FEEDBACK','MENTORING','COMMUNICATION','REPORTING')
  AND aa.action_code IN ('READ','CREATE','UPDATE','ASSIGN','EXPORT');

INSERT INTO role_permission (role_id, permission_id)
SELECT r.role_id, p.permission_id FROM role r CROSS JOIN permission p
JOIN access_resource ar ON ar.access_resource_id = p.access_resource_id
JOIN access_module am ON am.access_module_id = ar.access_module_id
JOIN access_action aa ON aa.access_action_id = p.access_action_id
WHERE r.role_code IN ('ADMISSION_OFFICER','DOCUMENT_VERIFIER','STUDENT_SECTION_OFFICER')
  AND am.module_code IN ('STUDENT','ADMISSION','REGISTRATION','DOCUMENT','COMMUNICATION','REPORTING')
  AND aa.action_code IN ('CREATE','READ','UPDATE','APPROVE','VERIFY','EXPORT');

INSERT INTO role_permission (role_id, permission_id)
SELECT r.role_id, p.permission_id FROM role r CROSS JOIN permission p
JOIN access_resource ar ON ar.access_resource_id = p.access_resource_id
JOIN access_module am ON am.access_module_id = ar.access_module_id
JOIN access_action aa ON aa.access_action_id = p.access_action_id
WHERE r.role_code IN ('CONTROLLER_EXAMINATIONS','EXAMINATION_OFFICER','EVALUATOR','RESULT_APPROVER')
  AND am.module_code IN ('STUDENT','REGISTRATION','ASSESSMENT','RESULT','DOCUMENT','COMMUNICATION','REPORTING','AUDIT')
  AND aa.action_code IN ('CREATE','READ','UPDATE','APPROVE','VERIFY','PUBLISH','EXPORT','ASSIGN');

INSERT INTO role_permission (role_id, permission_id)
SELECT r.role_id, p.permission_id FROM role r CROSS JOIN permission p
JOIN access_resource ar ON ar.access_resource_id = p.access_resource_id
JOIN access_module am ON am.access_module_id = ar.access_module_id
JOIN access_action aa ON aa.access_action_id = p.access_action_id
WHERE r.role_code IN ('INTERNAL_AUDITOR','EXTERNAL_AUDITOR')
  AND am.module_code IN ('INSTITUTION','ACADEMIC_CALENDAR','CURRICULUM','STUDENT','EMPLOYEE','ADMISSION','REGISTRATION','TEACHING','ATTENDANCE','ASSESSMENT','RESULT','DOCUMENT','REPORTING','AUDIT')
  AND aa.action_code IN ('READ','EXPORT');

INSERT INTO role_permission (role_id, permission_id)
SELECT r.role_id, p.permission_id FROM role r CROSS JOIN permission p
JOIN access_resource ar ON ar.access_resource_id = p.access_resource_id
JOIN access_module am ON am.access_module_id = ar.access_module_id
JOIN access_action aa ON aa.access_action_id = p.access_action_id
WHERE r.role_code IN ('STUDENT','APPLICANT','PARENT_GUARDIAN','ALUMNI')
  AND am.module_code IN ('STUDENT','ADMISSION','REGISTRATION','ATTENDANCE','ASSESSMENT','RESULT','FEEDBACK','DOCUMENT','COMMUNICATION')
  AND aa.action_code IN ('READ','CREATE','UPDATE');

CREATE OR REPLACE VIEW v_active_user_role AS
SELECT ura.user_role_assignment_id, ura.user_id, ura.role_id, r.role_code, r.role_name,
       ura.scope_type, ura.institution_id, ura.campus_id, ura.department_id, ura.programme_id,
       ura.valid_from, ura.valid_to
FROM user_role_assignment ura
JOIN role r ON r.role_id = ura.role_id
WHERE ura.assignment_status = 'ACTIVE' AND r.is_active = TRUE
  AND ura.valid_from <= CURRENT_TIMESTAMP
  AND (ura.valid_to IS NULL OR ura.valid_to > CURRENT_TIMESTAMP);

CREATE OR REPLACE VIEW v_active_role_permission AS
SELECT aur.user_id,
       aur.user_role_assignment_id AS source_assignment_id,
       aur.role_id,
       aur.role_code,
       aur.scope_type,
       CASE aur.scope_type
           WHEN 'GLOBAL' THEN 0
           WHEN 'INSTITUTION' THEN aur.institution_id
           WHEN 'CAMPUS' THEN aur.campus_id
           WHEN 'DEPARTMENT' THEN aur.department_id
           WHEN 'PROGRAMME' THEN aur.programme_id
           WHEN 'SELF' THEN aur.user_id
       END AS scope_entity_id,
       p.permission_id,
       p.permission_code,
       rp.permission_effect,
       'DIRECT' AS permission_source
FROM v_active_user_role aur
JOIN role_permission rp ON rp.role_id = aur.role_id
JOIN permission p ON p.permission_id = rp.permission_id
WHERE p.is_active = TRUE
UNION ALL
SELECT rd.delegate_user_id AS user_id,
       aur.user_role_assignment_id AS source_assignment_id,
       aur.role_id,
       aur.role_code,
       aur.scope_type,
       CASE aur.scope_type
           WHEN 'GLOBAL' THEN 0
           WHEN 'INSTITUTION' THEN aur.institution_id
           WHEN 'CAMPUS' THEN aur.campus_id
           WHEN 'DEPARTMENT' THEN aur.department_id
           WHEN 'PROGRAMME' THEN aur.programme_id
           WHEN 'SELF' THEN rd.delegate_user_id
       END AS scope_entity_id,
       p.permission_id,
       p.permission_code,
       rp.permission_effect,
       'DELEGATED' AS permission_source
FROM role_delegation rd
JOIN v_active_user_role aur ON aur.user_role_assignment_id = rd.source_assignment_id
JOIN role_permission rp ON rp.role_id = aur.role_id
JOIN permission p ON p.permission_id = rp.permission_id
WHERE rd.delegation_status = 'ACTIVE'
  AND rd.valid_from <= CURRENT_TIMESTAMP
  AND rd.valid_to > CURRENT_TIMESTAMP
  AND p.is_active = TRUE;

-- Exact-scope effective permission. DENY wins over ALLOW; active user overrides participate.
CREATE OR REPLACE VIEW v_effective_user_permission AS
SELECT x.user_id, x.permission_id, x.permission_code, x.scope_type, x.scope_entity_id,
       CASE WHEN MAX(x.is_deny) = 1 THEN 'DENY' ELSE 'ALLOW' END AS permission_effect
FROM (
    SELECT arp.user_id, arp.permission_id, arp.permission_code, arp.scope_type, arp.scope_entity_id,
           CASE WHEN arp.permission_effect='DENY' THEN 1 ELSE 0 END AS is_deny
    FROM v_active_role_permission arp
    UNION ALL
    SELECT upo.user_id, upo.permission_id, p.permission_code, upo.scope_type,
           CASE WHEN upo.scope_type IN ('GLOBAL','SELF') THEN 0 ELSE upo.scope_entity_id END AS scope_entity_id,
           CASE WHEN upo.permission_effect='DENY' THEN 1 ELSE 0 END AS is_deny
    FROM user_permission_override upo
    JOIN permission p ON p.permission_id=upo.permission_id
    WHERE p.is_active=TRUE
      AND upo.valid_from <= CURRENT_TIMESTAMP
      AND (upo.valid_to IS NULL OR upo.valid_to > CURRENT_TIMESTAMP)
) x
GROUP BY x.user_id, x.permission_id, x.permission_code, x.scope_type, x.scope_entity_id;

-- =============================================================
-- 16. EMPLOYEE HR PROFILE, QUALIFICATION, EXPERIENCE AND SECURE EVIDENCE MODULE
-- =============================================================
-- Security model:
-- 1) Full bank/PAN/Aadhaar identifiers are application-encrypted before persistence.
-- 2) *_fingerprint stores a deterministic keyed HMAC generated by the application for
--    duplicate detection/search. Never store encryption keys or HMAC keys in this DB.
-- 3) Normal UI/API views should use masked/last-four values only.
-- 4) Evidence binaries remain in protected object storage; only file_object references are stored.
-- 5) Every decrypt/view/download/export of restricted information should be recorded in
--    employee_sensitive_access_audit in addition to the general activity_audit trail.

CREATE TABLE qualification_level (
    qualification_level_id SMALLINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    level_code VARCHAR(40) NOT NULL UNIQUE,
    level_name VARCHAR(120) NOT NULL UNIQUE,
    display_order SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    is_terminal_degree BOOLEAN NOT NULL DEFAULT FALSE,
    description VARCHAR(500) NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE study_mode (
    study_mode_id TINYINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    mode_code VARCHAR(30) NOT NULL UNIQUE,
    mode_name VARCHAR(100) NOT NULL UNIQUE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE education_institution_type (
    education_institution_type_id TINYINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    type_code VARCHAR(30) NOT NULL UNIQUE,
    type_name VARCHAR(100) NOT NULL UNIQUE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE awarding_body_type (
    awarding_body_type_id TINYINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    type_code VARCHAR(30) NOT NULL UNIQUE,
    type_name VARCHAR(100) NOT NULL UNIQUE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE education_institution (
    education_institution_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    education_institution_type_id TINYINT UNSIGNED NULL,
    institution_name VARCHAR(250) NOT NULL,
    city VARCHAR(100) NULL,
    state_id SMALLINT UNSIGNED NULL,
    country_id SMALLINT UNSIGNED NULL,
    website_url VARCHAR(255) NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT uq_education_institution UNIQUE (institution_name, city, country_id),
    CONSTRAINT fk_education_institution_type FOREIGN KEY (education_institution_type_id) REFERENCES education_institution_type(education_institution_type_id),
    CONSTRAINT fk_education_institution_state FOREIGN KEY (state_id) REFERENCES state(state_id),
    CONSTRAINT fk_education_institution_country FOREIGN KEY (country_id) REFERENCES country(country_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE awarding_body (
    awarding_body_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    awarding_body_type_id TINYINT UNSIGNED NULL,
    awarding_body_name VARCHAR(250) NOT NULL,
    university_type ENUM('CENTRAL','STATE','PRIVATE','DEEMED','FOREIGN','AUTONOMOUS','OTHER') NULL,
    city VARCHAR(100) NULL,
    state_id SMALLINT UNSIGNED NULL,
    country_id SMALLINT UNSIGNED NULL,
    website_url VARCHAR(255) NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT uq_awarding_body UNIQUE (awarding_body_name, country_id),
    CONSTRAINT fk_awarding_body_type FOREIGN KEY (awarding_body_type_id) REFERENCES awarding_body_type(awarding_body_type_id),
    CONSTRAINT fk_awarding_body_state FOREIGN KEY (state_id) REFERENCES state(state_id),
    CONSTRAINT fk_awarding_body_country FOREIGN KEY (country_id) REFERENCES country(country_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE previous_organization_type (
    previous_organization_type_id TINYINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    type_code VARCHAR(40) NOT NULL UNIQUE,
    type_name VARCHAR(120) NOT NULL UNIQUE,
    classification ENUM('INDUSTRY','ACADEMIC','GOVERNMENT','PRIVATE','PUBLIC_SECTOR','NGO','SELF_EMPLOYED','OTHER') NOT NULL DEFAULT 'OTHER',
    is_active BOOLEAN NOT NULL DEFAULT TRUE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE previous_organization (
    previous_organization_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    previous_organization_type_id TINYINT UNSIGNED NULL,
    organization_name VARCHAR(250) NOT NULL,
    address_line_1 VARCHAR(200) NULL,
    address_line_2 VARCHAR(200) NULL,
    city VARCHAR(100) NULL,
    state_id SMALLINT UNSIGNED NULL,
    country_id SMALLINT UNSIGNED NULL,
    postal_code VARCHAR(12) NULL,
    phone VARCHAR(25) NULL,
    email VARCHAR(254) NULL,
    website_url VARCHAR(255) NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT uq_previous_organization UNIQUE (organization_name, city, country_id),
    CONSTRAINT fk_previous_organization_type FOREIGN KEY (previous_organization_type_id) REFERENCES previous_organization_type(previous_organization_type_id),
    CONSTRAINT fk_previous_organization_state FOREIGN KEY (state_id) REFERENCES state(state_id),
    CONSTRAINT fk_previous_organization_country FOREIGN KEY (country_id) REFERENCES country(country_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE employee_qualification (
    employee_qualification_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    employee_id BIGINT UNSIGNED NOT NULL,
    qualification_level_id SMALLINT UNSIGNED NOT NULL,
    education_institution_id BIGINT UNSIGNED NULL,
    awarding_body_id BIGINT UNSIGNED NULL,
    study_mode_id TINYINT UNSIGNED NULL,
    degree_certificate_name VARCHAR(250) NOT NULL,
    specialization VARCHAR(200) NULL,
    course_program_name VARCHAR(250) NULL,
    start_date DATE NULL,
    start_year YEAR NULL,
    completion_date DATE NULL,
    completion_year YEAR NULL,
    passing_year YEAR NULL,
    registration_roll_number VARCHAR(100) NULL,
    result VARCHAR(100) NULL,
    class_grade VARCHAR(100) NULL,
    cgpa DECIMAL(6,3) NULL,
    cgpa_scale DECIMAL(6,3) NULL,
    percentage DECIMAL(5,2) NULL,
    maximum_marks DECIMAL(10,2) NULL,
    marks_obtained DECIMAL(10,2) NULL,
    qualification_status ENUM('COMPLETED','PURSUING','AWAITING_RESULT','DISCONTINUED','OTHER') NOT NULL DEFAULT 'COMPLETED',
    is_highest_qualification BOOLEAN NOT NULL DEFAULT FALSE,
    active_highest_employee_id BIGINT UNSIGNED GENERATED ALWAYS AS (
        CASE WHEN is_highest_qualification = TRUE AND deleted_at IS NULL THEN employee_id ELSE NULL END
    ) STORED,
    remarks VARCHAR(1000) NULL,
    created_by_user_id BIGINT UNSIGNED NULL,
    updated_by_user_id BIGINT UNSIGNED NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP NULL,
    CONSTRAINT uq_employee_qualification_owner UNIQUE (employee_qualification_id, employee_id),
    CONSTRAINT uq_employee_highest_qualification UNIQUE (active_highest_employee_id),
    CONSTRAINT chk_employee_qualification_dates CHECK (completion_date IS NULL OR start_date IS NULL OR completion_date >= start_date),
    CONSTRAINT chk_employee_qualification_percentage CHECK (percentage IS NULL OR (percentage >= 0 AND percentage <= 100)),
    CONSTRAINT chk_employee_qualification_cgpa CHECK (cgpa IS NULL OR cgpa >= 0),
    CONSTRAINT chk_employee_qualification_cgpa_scale CHECK (cgpa_scale IS NULL OR cgpa_scale > 0),
    CONSTRAINT chk_employee_qualification_cgpa_range CHECK (cgpa IS NULL OR cgpa_scale IS NULL OR cgpa <= cgpa_scale),
    CONSTRAINT chk_employee_qualification_marks CHECK (marks_obtained IS NULL OR maximum_marks IS NULL OR (marks_obtained >= 0 AND maximum_marks >= 0 AND marks_obtained <= maximum_marks)),
    CONSTRAINT fk_employee_qualification_employee FOREIGN KEY (employee_id) REFERENCES employee(employee_id),
    CONSTRAINT fk_employee_qualification_level FOREIGN KEY (qualification_level_id) REFERENCES qualification_level(qualification_level_id),
    CONSTRAINT fk_employee_qualification_institution FOREIGN KEY (education_institution_id) REFERENCES education_institution(education_institution_id),
    CONSTRAINT fk_employee_qualification_awarding_body FOREIGN KEY (awarding_body_id) REFERENCES awarding_body(awarding_body_id),
    CONSTRAINT fk_employee_qualification_study_mode FOREIGN KEY (study_mode_id) REFERENCES study_mode(study_mode_id),
    CONSTRAINT fk_employee_qualification_created_by FOREIGN KEY (created_by_user_id) REFERENCES user_account(user_id),
    CONSTRAINT fk_employee_qualification_updated_by FOREIGN KEY (updated_by_user_id) REFERENCES user_account(user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE employee_previous_employment (
    employee_previous_employment_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    employee_id BIGINT UNSIGNED NOT NULL,
    previous_organization_id BIGINT UNSIGNED NOT NULL,
    department_division VARCHAR(200) NULL,
    designation VARCHAR(150) NOT NULL,
    employment_type ENUM('FULL_TIME','PART_TIME','CONTRACT','TEMPORARY','VISITING','CONSULTANT','TRAINEE','SELF_EMPLOYED','OTHER') NOT NULL,
    nature_of_work VARCHAR(1000) NULL,
    employment_start_date DATE NOT NULL,
    employment_end_date DATE NULL,
    experience_days INT UNSIGNED NULL,
    last_drawn_salary DECIMAL(14,2) NULL,
    salary_currency_code CHAR(3) NOT NULL DEFAULT 'INR',
    reason_for_leaving VARCHAR(1000) NULL,
    reporting_authority_name VARCHAR(200) NULL,
    reporting_authority_designation VARCHAR(150) NULL,
    reporting_authority_phone VARCHAR(25) NULL,
    reporting_authority_email VARCHAR(254) NULL,
    remarks VARCHAR(1000) NULL,
    created_by_user_id BIGINT UNSIGNED NULL,
    updated_by_user_id BIGINT UNSIGNED NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP NULL,
    CONSTRAINT uq_employee_previous_employment_owner UNIQUE (employee_previous_employment_id, employee_id),
    CONSTRAINT chk_previous_employment_dates CHECK (employment_end_date IS NULL OR employment_end_date >= employment_start_date),
    CONSTRAINT chk_previous_employment_salary CHECK (last_drawn_salary IS NULL OR last_drawn_salary >= 0),
    CONSTRAINT fk_previous_employment_employee FOREIGN KEY (employee_id) REFERENCES employee(employee_id),
    CONSTRAINT fk_previous_employment_organization FOREIGN KEY (previous_organization_id) REFERENCES previous_organization(previous_organization_id),
    CONSTRAINT fk_previous_employment_created_by FOREIGN KEY (created_by_user_id) REFERENCES user_account(user_id),
    CONSTRAINT fk_previous_employment_updated_by FOREIGN KEY (updated_by_user_id) REFERENCES user_account(user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE employee_bank_account (
    employee_bank_account_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    employee_id BIGINT UNSIGNED NOT NULL,
    account_holder_name VARCHAR(200) NOT NULL,
    bank_name VARCHAR(200) NOT NULL,
    branch_name VARCHAR(200) NULL,
    account_number_ciphertext VARBINARY(1024) NOT NULL,
    account_number_fingerprint CHAR(64) NOT NULL UNIQUE,
    account_number_last4 CHAR(4) NOT NULL,
    account_number_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
    account_type ENUM('SAVINGS','CURRENT','SALARY','NRE','NRO','OTHER') NOT NULL DEFAULT 'SAVINGS',
    ifsc_code VARCHAR(11) NOT NULL,
    micr_code VARCHAR(20) NULL,
    branch_code VARCHAR(30) NULL,
    bank_address VARCHAR(500) NULL,
    city VARCHAR(100) NULL,
    state_id SMALLINT UNSIGNED NULL,
    country_id SMALLINT UNSIGNED NULL,
    upi_id VARCHAR(150) NULL,
    is_salary_account BOOLEAN NOT NULL DEFAULT FALSE,
    is_primary BOOLEAN NOT NULL DEFAULT FALSE,
    account_status ENUM('PENDING_VERIFICATION','ACTIVE','INACTIVE','CLOSED','REJECTED') NOT NULL DEFAULT 'PENDING_VERIFICATION',
    verification_status ENUM('PENDING','VERIFIED','REJECTED','EXPIRED') NOT NULL DEFAULT 'PENDING',
    verified_by_user_id BIGINT UNSIGNED NULL,
    verified_at DATETIME NULL,
    verification_remarks VARCHAR(1000) NULL,
    effective_from DATE NULL,
    effective_to DATE NULL,
    remarks VARCHAR(1000) NULL,
    created_by_user_id BIGINT UNSIGNED NULL,
    updated_by_user_id BIGINT UNSIGNED NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP NULL,
    active_primary_employee_id BIGINT UNSIGNED GENERATED ALWAYS AS (CASE WHEN is_primary = TRUE AND deleted_at IS NULL THEN employee_id ELSE NULL END) STORED,
    CONSTRAINT uq_employee_bank_owner UNIQUE (employee_bank_account_id, employee_id),
    CONSTRAINT uq_employee_primary_bank UNIQUE (active_primary_employee_id),
    CONSTRAINT chk_employee_bank_dates CHECK (effective_to IS NULL OR effective_from IS NULL OR effective_to >= effective_from),
    CONSTRAINT chk_employee_bank_last4 CHECK (account_number_last4 REGEXP '^[0-9]{4}$'),
    CONSTRAINT chk_employee_bank_ifsc CHECK (ifsc_code REGEXP '^[A-Za-z]{4}0[A-Za-z0-9]{6}$'),
    CONSTRAINT fk_employee_bank_employee FOREIGN KEY (employee_id) REFERENCES employee(employee_id),
    CONSTRAINT fk_employee_bank_state FOREIGN KEY (state_id) REFERENCES state(state_id),
    CONSTRAINT fk_employee_bank_country FOREIGN KEY (country_id) REFERENCES country(country_id),
    CONSTRAINT fk_employee_bank_verified_by FOREIGN KEY (verified_by_user_id) REFERENCES user_account(user_id),
    CONSTRAINT fk_employee_bank_created_by FOREIGN KEY (created_by_user_id) REFERENCES user_account(user_id),
    CONSTRAINT fk_employee_bank_updated_by FOREIGN KEY (updated_by_user_id) REFERENCES user_account(user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE employee_pan (
    employee_pan_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    employee_id BIGINT UNSIGNED NOT NULL UNIQUE,
    pan_number_ciphertext VARBINARY(1024) NOT NULL,
    pan_number_fingerprint CHAR(64) NOT NULL UNIQUE,
    pan_number_masked VARCHAR(15) NOT NULL,
    name_as_per_pan VARCHAR(200) NOT NULL,
    pan_issue_date DATE NULL,
    pan_issue_details VARCHAR(500) NULL,
    format_validated BOOLEAN NOT NULL DEFAULT FALSE,
    verification_status ENUM('PENDING','VERIFIED','REJECTED','EXPIRED') NOT NULL DEFAULT 'PENDING',
    verified_by_user_id BIGINT UNSIGNED NULL,
    verified_at DATETIME NULL,
    verification_remarks VARCHAR(1000) NULL,
    remarks VARCHAR(1000) NULL,
    created_by_user_id BIGINT UNSIGNED NULL,
    updated_by_user_id BIGINT UNSIGNED NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP NULL,
    CONSTRAINT uq_employee_pan_owner UNIQUE (employee_pan_id, employee_id),
    CONSTRAINT chk_employee_pan_masked CHECK (CHAR_LENGTH(pan_number_masked) BETWEEN 6 AND 15),
    CONSTRAINT fk_employee_pan_employee FOREIGN KEY (employee_id) REFERENCES employee(employee_id),
    CONSTRAINT fk_employee_pan_verified_by FOREIGN KEY (verified_by_user_id) REFERENCES user_account(user_id),
    CONSTRAINT fk_employee_pan_created_by FOREIGN KEY (created_by_user_id) REFERENCES user_account(user_id),
    CONSTRAINT fk_employee_pan_updated_by FOREIGN KEY (updated_by_user_id) REFERENCES user_account(user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE employee_aadhaar (
    employee_aadhaar_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    employee_id BIGINT UNSIGNED NOT NULL UNIQUE,
    aadhaar_number_ciphertext VARBINARY(1024) NOT NULL,
    aadhaar_number_fingerprint CHAR(64) NOT NULL UNIQUE,
    aadhaar_number_last4 CHAR(4) NOT NULL,
    aadhaar_number_masked VARCHAR(30) NOT NULL,
    name_as_per_aadhaar VARCHAR(200) NOT NULL,
    format_validated BOOLEAN NOT NULL DEFAULT FALSE,
    verification_status ENUM('PENDING','VERIFIED','REJECTED','EXPIRED') NOT NULL DEFAULT 'PENDING',
    verified_by_user_id BIGINT UNSIGNED NULL,
    verified_at DATETIME NULL,
    verification_remarks VARCHAR(1000) NULL,
    collection_purpose VARCHAR(500) NULL,
    remarks VARCHAR(1000) NULL,
    created_by_user_id BIGINT UNSIGNED NULL,
    updated_by_user_id BIGINT UNSIGNED NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP NULL,
    CONSTRAINT uq_employee_aadhaar_owner UNIQUE (employee_aadhaar_id, employee_id),
    CONSTRAINT chk_employee_aadhaar_last4 CHECK (aadhaar_number_last4 REGEXP '^[0-9]{4}$'),
    CONSTRAINT fk_employee_aadhaar_employee FOREIGN KEY (employee_id) REFERENCES employee(employee_id),
    CONSTRAINT fk_employee_aadhaar_verified_by FOREIGN KEY (verified_by_user_id) REFERENCES user_account(user_id),
    CONSTRAINT fk_employee_aadhaar_created_by FOREIGN KEY (created_by_user_id) REFERENCES user_account(user_id),
    CONSTRAINT fk_employee_aadhaar_updated_by FOREIGN KEY (updated_by_user_id) REFERENCES user_account(user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE employee_document_category (
    employee_document_category_id SMALLINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    category_code VARCHAR(50) NOT NULL UNIQUE,
    category_name VARCHAR(150) NOT NULL UNIQUE,
    default_confidentiality ENUM('PUBLIC','INTERNAL','CONFIDENTIAL','RESTRICTED','HIGHLY_RESTRICTED') NOT NULL DEFAULT 'INTERNAL',
    requires_verification BOOLEAN NOT NULL DEFAULT TRUE,
    requires_approval BOOLEAN NOT NULL DEFAULT FALSE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE employee_document (
    employee_document_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    employee_id BIGINT UNSIGNED NOT NULL,
    document_scope ENUM('EMPLOYEE_GENERAL','QUALIFICATION','PREVIOUS_EMPLOYMENT','BANK_ACCOUNT','PAN','AADHAAR') NOT NULL,
    employee_qualification_id BIGINT UNSIGNED NULL,
    employee_previous_employment_id BIGINT UNSIGNED NULL,
    employee_bank_account_id BIGINT UNSIGNED NULL,
    employee_pan_id BIGINT UNSIGNED NULL,
    employee_aadhaar_id BIGINT UNSIGNED NULL,
    employee_document_category_id SMALLINT UNSIGNED NOT NULL,
    document_type_id SMALLINT UNSIGNED NOT NULL,
    file_object_id BIGINT UNSIGNED NOT NULL,
    document_title VARCHAR(250) NOT NULL,
    document_number VARCHAR(150) NULL,
    issue_date DATE NULL,
    expiry_date DATE NULL,
    version_number SMALLINT UNSIGNED NOT NULL DEFAULT 1,
    supersedes_employee_document_id BIGINT UNSIGNED NULL,
    verification_status ENUM('PENDING','UNDER_REVIEW','VERIFIED','REJECTED','EXPIRED') NOT NULL DEFAULT 'PENDING',
    verified_by_user_id BIGINT UNSIGNED NULL,
    verified_at DATETIME NULL,
    verification_remarks VARCHAR(1000) NULL,
    approval_status ENUM('NOT_REQUIRED','PENDING','APPROVED','REJECTED') NOT NULL DEFAULT 'NOT_REQUIRED',
    approved_by_user_id BIGINT UNSIGNED NULL,
    approved_at DATETIME NULL,
    approval_remarks VARCHAR(1000) NULL,
    confidentiality_level ENUM('PUBLIC','INTERNAL','CONFIDENTIAL','RESTRICTED','HIGHLY_RESTRICTED') NOT NULL DEFAULT 'CONFIDENTIAL',
    is_private BOOLEAN NOT NULL DEFAULT TRUE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_by_user_id BIGINT UNSIGNED NULL,
    updated_by_user_id BIGINT UNSIGNED NULL,
    deleted_by_user_id BIGINT UNSIGNED NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP NULL,
    CONSTRAINT chk_employee_document_expiry CHECK (expiry_date IS NULL OR issue_date IS NULL OR expiry_date >= issue_date),
    CONSTRAINT chk_employee_document_version CHECK (version_number > 0),
    CONSTRAINT chk_employee_document_scope CHECK (
        (document_scope='EMPLOYEE_GENERAL' AND employee_qualification_id IS NULL AND employee_previous_employment_id IS NULL AND employee_bank_account_id IS NULL AND employee_pan_id IS NULL AND employee_aadhaar_id IS NULL) OR
        (document_scope='QUALIFICATION' AND employee_qualification_id IS NOT NULL AND employee_previous_employment_id IS NULL AND employee_bank_account_id IS NULL AND employee_pan_id IS NULL AND employee_aadhaar_id IS NULL) OR
        (document_scope='PREVIOUS_EMPLOYMENT' AND employee_qualification_id IS NULL AND employee_previous_employment_id IS NOT NULL AND employee_bank_account_id IS NULL AND employee_pan_id IS NULL AND employee_aadhaar_id IS NULL) OR
        (document_scope='BANK_ACCOUNT' AND employee_qualification_id IS NULL AND employee_previous_employment_id IS NULL AND employee_bank_account_id IS NOT NULL AND employee_pan_id IS NULL AND employee_aadhaar_id IS NULL) OR
        (document_scope='PAN' AND employee_qualification_id IS NULL AND employee_previous_employment_id IS NULL AND employee_bank_account_id IS NULL AND employee_pan_id IS NOT NULL AND employee_aadhaar_id IS NULL) OR
        (document_scope='AADHAAR' AND employee_qualification_id IS NULL AND employee_previous_employment_id IS NULL AND employee_bank_account_id IS NULL AND employee_pan_id IS NULL AND employee_aadhaar_id IS NOT NULL)
    ),
    CONSTRAINT fk_employee_document_employee FOREIGN KEY (employee_id) REFERENCES employee(employee_id),
    CONSTRAINT fk_employee_document_qualification_owner FOREIGN KEY (employee_qualification_id, employee_id) REFERENCES employee_qualification(employee_qualification_id, employee_id),
    CONSTRAINT fk_employee_document_experience_owner FOREIGN KEY (employee_previous_employment_id, employee_id) REFERENCES employee_previous_employment(employee_previous_employment_id, employee_id),
    CONSTRAINT fk_employee_document_bank_owner FOREIGN KEY (employee_bank_account_id, employee_id) REFERENCES employee_bank_account(employee_bank_account_id, employee_id),
    CONSTRAINT fk_employee_document_pan_owner FOREIGN KEY (employee_pan_id, employee_id) REFERENCES employee_pan(employee_pan_id, employee_id),
    CONSTRAINT fk_employee_document_aadhaar_owner FOREIGN KEY (employee_aadhaar_id, employee_id) REFERENCES employee_aadhaar(employee_aadhaar_id, employee_id),
    CONSTRAINT fk_employee_document_category FOREIGN KEY (employee_document_category_id) REFERENCES employee_document_category(employee_document_category_id),
    CONSTRAINT fk_employee_document_type FOREIGN KEY (document_type_id) REFERENCES document_type(document_type_id),
    CONSTRAINT fk_employee_document_file FOREIGN KEY (file_object_id) REFERENCES file_object(file_object_id),
    CONSTRAINT fk_employee_document_supersedes FOREIGN KEY (supersedes_employee_document_id) REFERENCES employee_document(employee_document_id),
    CONSTRAINT fk_employee_document_verified_by FOREIGN KEY (verified_by_user_id) REFERENCES user_account(user_id),
    CONSTRAINT fk_employee_document_approved_by FOREIGN KEY (approved_by_user_id) REFERENCES user_account(user_id),
    CONSTRAINT fk_employee_document_created_by FOREIGN KEY (created_by_user_id) REFERENCES user_account(user_id),
    CONSTRAINT fk_employee_document_updated_by FOREIGN KEY (updated_by_user_id) REFERENCES user_account(user_id),
    CONSTRAINT fk_employee_document_deleted_by FOREIGN KEY (deleted_by_user_id) REFERENCES user_account(user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE employee_document_access_rule (
    employee_document_access_rule_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    employee_document_id BIGINT UNSIGNED NOT NULL,
    role_id SMALLINT UNSIGNED NULL,
    user_id BIGINT UNSIGNED NULL,
    can_view BOOLEAN NOT NULL DEFAULT TRUE,
    can_download BOOLEAN NOT NULL DEFAULT FALSE,
    can_update BOOLEAN NOT NULL DEFAULT FALSE,
    can_verify BOOLEAN NOT NULL DEFAULT FALSE,
    can_approve BOOLEAN NOT NULL DEFAULT FALSE,
    valid_from DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    valid_to DATETIME NULL,
    granted_by_user_id BIGINT UNSIGNED NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_employee_document_access_principal CHECK ((role_id IS NOT NULL AND user_id IS NULL) OR (role_id IS NULL AND user_id IS NOT NULL)),
    CONSTRAINT chk_employee_document_access_dates CHECK (valid_to IS NULL OR valid_to > valid_from),
    CONSTRAINT fk_employee_document_access_document FOREIGN KEY (employee_document_id) REFERENCES employee_document(employee_document_id),
    CONSTRAINT fk_employee_document_access_role FOREIGN KEY (role_id) REFERENCES role(role_id),
    CONSTRAINT fk_employee_document_access_user FOREIGN KEY (user_id) REFERENCES user_account(user_id),
    CONSTRAINT fk_employee_document_access_granted_by FOREIGN KEY (granted_by_user_id) REFERENCES user_account(user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE employee_sensitive_access_audit (
    employee_sensitive_access_audit_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT UNSIGNED NULL,
    employee_id BIGINT UNSIGNED NOT NULL,
    action_code ENUM('READ','DOWNLOAD','EXPORT','CREATE','UPDATE','VERIFY','APPROVE','DELETE','RESTORE','DECRYPT') NOT NULL,
    entity_type ENUM('QUALIFICATION','PREVIOUS_EMPLOYMENT','BANK_ACCOUNT','PAN','AADHAAR','EMPLOYEE_DOCUMENT') NOT NULL,
    entity_id BIGINT UNSIGNED NOT NULL,
    employee_document_id BIGINT UNSIGNED NULL,
    access_purpose VARCHAR(500) NULL,
    was_successful BOOLEAN NOT NULL DEFAULT TRUE,
    failure_reason VARCHAR(500) NULL,
    ip_address VARCHAR(45) NULL,
    user_agent VARCHAR(500) NULL,
    request_identifier VARCHAR(128) NULL,
    accessed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_employee_sensitive_audit_user FOREIGN KEY (user_id) REFERENCES user_account(user_id),
    CONSTRAINT fk_employee_sensitive_audit_employee FOREIGN KEY (employee_id) REFERENCES employee(employee_id),
    CONSTRAINT fk_employee_sensitive_audit_document FOREIGN KEY (employee_document_id) REFERENCES employee_document(employee_document_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE OR REPLACE VIEW v_employee_previous_experience AS
SELECT epe.employee_previous_employment_id,
       epe.employee_id,
       po.organization_name,
       epe.designation,
       epe.employment_type,
       epe.employment_start_date,
       epe.employment_end_date,
       COALESCE(epe.experience_days,
                DATEDIFF(COALESCE(epe.employment_end_date, CURRENT_DATE), epe.employment_start_date) + 1) AS calculated_experience_days,
       TIMESTAMPDIFF(YEAR, epe.employment_start_date, COALESCE(epe.employment_end_date, CURRENT_DATE)) AS completed_years,
       MOD(TIMESTAMPDIFF(MONTH, epe.employment_start_date, COALESCE(epe.employment_end_date, CURRENT_DATE)), 12) AS remaining_months
FROM employee_previous_employment epe
JOIN previous_organization po ON po.previous_organization_id = epe.previous_organization_id
WHERE epe.deleted_at IS NULL;

-- Reference data for employee qualifications and organizations.
INSERT INTO qualification_level (level_code, level_name, display_order, is_terminal_degree) VALUES
('SSLC_10','SSLC / 10th',10,FALSE),
('PUC_12','PUC / 12th',20,FALSE),
('DIPLOMA','Diploma',30,FALSE),
('UNDERGRADUATE','Undergraduate',40,FALSE),
('POSTGRADUATE','Postgraduate',50,FALSE),
('MPHIL','M.Phil.',60,FALSE),
('PHD','Ph.D.',70,TRUE),
('POSTDOCTORAL','Postdoctoral Qualification',80,TRUE),
('PROFESSIONAL_CERTIFICATION','Professional Certification',90,FALSE),
('OTHER','Other Qualification',100,FALSE);

INSERT INTO study_mode (mode_code, mode_name) VALUES
('REGULAR','Regular'),('FULL_TIME','Full-time'),('PART_TIME','Part-time'),
('DISTANCE','Distance Education'),('ONLINE','Online'),('HYBRID','Hybrid'),('OTHER','Other');

INSERT INTO education_institution_type (type_code, type_name) VALUES
('SCHOOL','School'),('PU_COLLEGE','PU / Higher Secondary College'),('COLLEGE','College'),
('UNIVERSITY','University'),('TRAINING_INSTITUTE','Training Institute'),('OTHER','Other');

INSERT INTO awarding_body_type (type_code, type_name) VALUES
('BOARD','Board'),('UNIVERSITY','University'),('AUTONOMOUS_BODY','Autonomous Body'),
('PROFESSIONAL_BODY','Professional Body'),('OTHER','Other');

INSERT INTO previous_organization_type (type_code, type_name, classification) VALUES
('ACADEMIC_INSTITUTION','Academic Institution','ACADEMIC'),
('GOVERNMENT_DEPARTMENT','Government Department','GOVERNMENT'),
('PRIVATE_COMPANY','Private Company','PRIVATE'),
('PUBLIC_SECTOR','Public Sector Undertaking','PUBLIC_SECTOR'),
('INDUSTRY','Industry','INDUSTRY'),
('NGO','NGO / Non-Profit','NGO'),
('SELF_EMPLOYED','Self Employed','SELF_EMPLOYED'),
('OTHER','Other Organization','OTHER');

INSERT INTO employee_document_category (category_code, category_name, default_confidentiality, requires_verification, requires_approval) VALUES
('QUALIFICATION','Qualification Evidence','CONFIDENTIAL',TRUE,FALSE),
('EXPERIENCE','Previous Employment Evidence','CONFIDENTIAL',TRUE,FALSE),
('BANK','Bank Account Evidence','HIGHLY_RESTRICTED',TRUE,TRUE),
('PAN','PAN Evidence','HIGHLY_RESTRICTED',TRUE,TRUE),
('AADHAAR','Aadhaar Evidence','HIGHLY_RESTRICTED',TRUE,TRUE),
('GENERAL','Other Employee Document','CONFIDENTIAL',TRUE,FALSE);

INSERT IGNORE INTO document_type (document_code, document_name, requires_verification, is_active) VALUES
('MARKS_CARD','Marks Card',TRUE,TRUE),
('DEGREE_CERT','Degree Certificate',TRUE,TRUE),
('PROVISIONAL_DEGREE','Provisional Degree Certificate',TRUE,TRUE),
('CONVOCATION_CERT','Convocation Certificate',TRUE,TRUE),
('CONSOLIDATED_MARKS','Consolidated Marks Card',TRUE,TRUE),
('TRANSCRIPT','Academic Transcript',TRUE,TRUE),
('MIGRATION_CERT','Migration Certificate',TRUE,TRUE),
('ELIGIBILITY_CERT','Eligibility Certificate',TRUE,TRUE),
('PHD_AWARD_CERT','Ph.D. Award Certificate',TRUE,TRUE),
('PROF_CERT','Professional Certification',TRUE,TRUE),
('EXPERIENCE_CERT','Experience Certificate',TRUE,TRUE),
('RELIEVING_LETTER','Relieving Letter',TRUE,TRUE),
('APPOINTMENT_LETTER','Appointment Letter',TRUE,TRUE),
('JOINING_LETTER','Joining Letter',TRUE,TRUE),
('SERVICE_CERT','Service Certificate',TRUE,TRUE),
('SALARY_CERT','Salary Certificate',TRUE,TRUE),
('PAY_SLIP','Pay Slip',TRUE,TRUE),
('PROMOTION_ORDER','Promotion Order',TRUE,TRUE),
('BANK_PASSBOOK_FRONT','Bank Passbook Front Page',TRUE,TRUE),
('CANCELLED_CHEQUE','Cancelled Cheque',TRUE,TRUE),
('BANK_STATEMENT','Bank Statement',TRUE,TRUE),
('BANK_CONFIRMATION','Bank Account Confirmation',TRUE,TRUE),
('PAN_CARD','PAN Card',TRUE,TRUE),
('PAN_VERIFICATION','PAN Verification Document',TRUE,TRUE),
('AADHAAR_FRONT','Aadhaar Front',TRUE,TRUE),
('AADHAAR_BACK','Aadhaar Back',TRUE,TRUE),
('E_AADHAAR','e-Aadhaar / Aadhaar PDF',TRUE,TRUE),
('OTHER_EMPLOYEE_DOC','Other Employee Supporting Document',TRUE,TRUE);

-- Granular RBAC for the new employee resources.
INSERT IGNORE INTO access_action (action_code, action_name, description)
VALUES ('DOWNLOAD','Download','Download an authorized stored document');

INSERT IGNORE INTO access_resource (access_module_id, resource_code, resource_name, description)
SELECT access_module_id, 'QUALIFICATION', 'Employee Qualification', 'Employee qualification and educational history.' FROM access_module WHERE module_code='EMPLOYEE';
INSERT IGNORE INTO access_resource (access_module_id, resource_code, resource_name, description)
SELECT access_module_id, 'EXPERIENCE', 'Previous Employment Experience', 'Employee previous employment and experience.' FROM access_module WHERE module_code='EMPLOYEE';
INSERT IGNORE INTO access_resource (access_module_id, resource_code, resource_name, description)
SELECT access_module_id, 'BANK_ACCOUNT', 'Employee Bank Account', 'Restricted employee bank account information.' FROM access_module WHERE module_code='EMPLOYEE';
INSERT IGNORE INTO access_resource (access_module_id, resource_code, resource_name, description)
SELECT access_module_id, 'PAN', 'Employee PAN', 'Highly restricted employee PAN information.' FROM access_module WHERE module_code='EMPLOYEE';
INSERT IGNORE INTO access_resource (access_module_id, resource_code, resource_name, description)
SELECT access_module_id, 'AADHAAR', 'Employee Aadhaar', 'Highly restricted employee Aadhaar information.' FROM access_module WHERE module_code='EMPLOYEE';
INSERT IGNORE INTO access_resource (access_module_id, resource_code, resource_name, description)
SELECT access_module_id, 'EMPLOYEE_DOCUMENT', 'Employee Evidence Document', 'Employee evidence files, verification and access control.' FROM access_module WHERE module_code='EMPLOYEE';

INSERT IGNORE INTO permission (access_resource_id, access_action_id, permission_code, permission_name, is_sensitive)
SELECT ar.access_resource_id, aa.access_action_id,
       CONCAT('EMPLOYEE.', ar.resource_code, '.', aa.action_code),
       CONCAT(aa.action_name, ' ', ar.resource_name),
       CASE WHEN ar.resource_code IN ('BANK_ACCOUNT','PAN','AADHAAR','EMPLOYEE_DOCUMENT')
                  OR aa.action_code IN ('DELETE','APPROVE','VERIFY','EXPORT','DOWNLOAD')
            THEN TRUE ELSE FALSE END
FROM access_resource ar
JOIN access_module am ON am.access_module_id=ar.access_module_id AND am.module_code='EMPLOYEE'
CROSS JOIN access_action aa
WHERE ar.resource_code IN ('QUALIFICATION','EXPERIENCE','BANK_ACCOUNT','PAN','AADHAAR','EMPLOYEE_DOCUMENT')
  AND aa.action_code IN ('CREATE','READ','UPDATE','DELETE','APPROVE','VERIFY','EXPORT','DOWNLOAD');

INSERT IGNORE INTO role (role_code, role_name, role_category, role_level, description, is_system_role) VALUES
('HR_ADMIN','HR Administrator','ADMINISTRATIVE','INSTITUTION','Administers employee master, sensitive HR data and evidence subject to institutional policy.',TRUE),
('HR_OFFICER','HR Officer','ADMINISTRATIVE','INSTITUTION','Maintains qualifications, experience and employee evidence.',TRUE),
('PAYROLL_OFFICER','Payroll Officer','ADMINISTRATIVE','INSTITUTION','Maintains verified salary bank details and authorized payroll evidence.',TRUE);

-- Ensure Super Administrator also receives permissions inserted after the original broad grant.
INSERT IGNORE INTO role_permission (role_id, permission_id)
SELECT r.role_id, p.permission_id FROM role r CROSS JOIN permission p
WHERE r.role_code='SUPER_ADMIN' AND p.permission_code LIKE 'EMPLOYEE.%';

INSERT IGNORE INTO role_permission (role_id, permission_id)
SELECT r.role_id, p.permission_id FROM role r CROSS JOIN permission p
WHERE r.role_code='HR_ADMIN' AND p.permission_code LIKE 'EMPLOYEE.%';

INSERT IGNORE INTO role_permission (role_id, permission_id)
SELECT r.role_id, p.permission_id FROM role r CROSS JOIN permission p
JOIN access_resource ar ON ar.access_resource_id=p.access_resource_id
JOIN access_action aa ON aa.access_action_id=p.access_action_id
WHERE r.role_code='HR_OFFICER'
  AND ar.resource_code IN ('QUALIFICATION','EXPERIENCE','EMPLOYEE_DOCUMENT')
  AND aa.action_code IN ('CREATE','READ','UPDATE','VERIFY','APPROVE','DOWNLOAD');

INSERT IGNORE INTO role_permission (role_id, permission_id)
SELECT r.role_id, p.permission_id FROM role r CROSS JOIN permission p
JOIN access_resource ar ON ar.access_resource_id=p.access_resource_id
JOIN access_action aa ON aa.access_action_id=p.access_action_id
WHERE r.role_code='PAYROLL_OFFICER'
  AND ar.resource_code IN ('BANK_ACCOUNT','EMPLOYEE_DOCUMENT')
  AND aa.action_code IN ('CREATE','READ','UPDATE','VERIFY','DOWNLOAD');

-- PAN/Aadhaar format validation must occur against plaintext in trusted application code
-- before encryption. The DB deliberately stores no plaintext PAN/Aadhaar values.

-- =============================================================
-- 17. STUDENT FEES AND FINANCIAL MANAGEMENT MODULE
-- Supports admission, academic, examination, service and other fees.
-- (Original fees module preserved; numbering shifted only because of the additive HR module.)
-- =============================================================
CREATE TABLE fee_category (
    fee_category_id SMALLINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    category_code VARCHAR(30) NOT NULL UNIQUE,
    category_name VARCHAR(100) NOT NULL UNIQUE,
    description VARCHAR(500) NULL,
    display_order SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    is_refundable BOOLEAN NOT NULL DEFAULT FALSE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE financial_ledger_account (
    ledger_account_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    parent_account_id INT UNSIGNED NULL,
    account_code VARCHAR(40) NOT NULL UNIQUE,
    account_name VARCHAR(150) NOT NULL,
    account_type ENUM('ASSET','LIABILITY','EQUITY','REVENUE','EXPENSE') NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    CONSTRAINT fk_ledger_parent FOREIGN KEY (parent_account_id) REFERENCES financial_ledger_account(ledger_account_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE fee_type (
    fee_type_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    fee_category_id SMALLINT UNSIGNED NOT NULL,
    fee_code VARCHAR(40) NOT NULL UNIQUE,
    fee_name VARCHAR(150) NOT NULL,
    description VARCHAR(500) NULL,
    charge_frequency ENUM('ONE_TIME','ANNUAL','TERM','SEMESTER','MONTHLY','PER_APPLICATION','PER_EXAM','PER_COURSE','PER_SERVICE','OTHER') NOT NULL,
    ledger_account_id INT UNSIGNED NULL,
    is_mandatory BOOLEAN NOT NULL DEFAULT TRUE,
    is_refundable BOOLEAN NOT NULL DEFAULT FALSE,
    is_taxable BOOLEAN NOT NULL DEFAULT FALSE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_fee_type_category FOREIGN KEY (fee_category_id) REFERENCES fee_category(fee_category_id),
    CONSTRAINT fk_fee_type_ledger FOREIGN KEY (ledger_account_id) REFERENCES financial_ledger_account(ledger_account_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE fee_structure (
    fee_structure_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    structure_code VARCHAR(50) NOT NULL UNIQUE,
    structure_name VARCHAR(200) NOT NULL,
    institution_id SMALLINT UNSIGNED NOT NULL,
    campus_id SMALLINT UNSIGNED NULL,
    programme_id SMALLINT UNSIGNED NULL,
    specialization_id SMALLINT UNSIGNED NULL,
    academic_year_id SMALLINT UNSIGNED NOT NULL,
    admission_category_id SMALLINT UNSIGNED NULL,
    version_number SMALLINT UNSIGNED NOT NULL DEFAULT 1,
    effective_from DATE NOT NULL,
    effective_to DATE NULL,
    approval_status ENUM('DRAFT','SUBMITTED','APPROVED','REJECTED','SUPERSEDED') NOT NULL DEFAULT 'DRAFT',
    approved_by BIGINT UNSIGNED NULL,
    approved_at DATETIME NULL,
    remarks VARCHAR(500) NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT chk_fee_structure_dates CHECK (effective_to IS NULL OR effective_to >= effective_from),
    CONSTRAINT chk_fee_structure_specialization_programme CHECK (specialization_id IS NULL OR programme_id IS NOT NULL),
    CONSTRAINT fk_fee_structure_institution FOREIGN KEY (institution_id) REFERENCES institution(institution_id),
    CONSTRAINT fk_fee_structure_campus FOREIGN KEY (campus_id) REFERENCES campus(campus_id),
    CONSTRAINT fk_fee_structure_programme FOREIGN KEY (programme_id) REFERENCES programme(programme_id),
    CONSTRAINT fk_fee_structure_specialization_programme FOREIGN KEY (specialization_id, programme_id)
        REFERENCES programme_specialization(specialization_id, programme_id),
    CONSTRAINT fk_fee_structure_year FOREIGN KEY (academic_year_id) REFERENCES academic_year(academic_year_id),
    CONSTRAINT fk_fee_structure_category FOREIGN KEY (admission_category_id) REFERENCES admission_category(admission_category_id),
    CONSTRAINT fk_fee_structure_approver FOREIGN KEY (approved_by) REFERENCES user_account(user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE late_fee_rule (
    late_fee_rule_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    rule_code VARCHAR(40) NOT NULL UNIQUE,
    rule_name VARCHAR(150) NOT NULL,
    calculation_method ENUM('FIXED','PER_DAY','PERCENTAGE','SLAB') NOT NULL,
    grace_period_days SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    fixed_amount DECIMAL(12,2) NULL,
    daily_amount DECIMAL(12,2) NULL,
    percentage_rate DECIMAL(7,4) NULL,
    maximum_amount DECIMAL(12,2) NULL,
    effective_from DATE NOT NULL,
    effective_to DATE NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    CONSTRAINT chk_late_fee_dates CHECK (effective_to IS NULL OR effective_to >= effective_from)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE late_fee_slab (
    late_fee_slab_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    late_fee_rule_id INT UNSIGNED NOT NULL,
    from_day SMALLINT UNSIGNED NOT NULL,
    to_day SMALLINT UNSIGNED NULL,
    late_fee_amount DECIMAL(12,2) NOT NULL,
    CONSTRAINT uq_late_fee_slab UNIQUE (late_fee_rule_id, from_day),
    CONSTRAINT chk_late_fee_slab_days CHECK (to_day IS NULL OR to_day >= from_day),
    CONSTRAINT fk_late_fee_slab_rule FOREIGN KEY (late_fee_rule_id) REFERENCES late_fee_rule(late_fee_rule_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE fee_structure_item (
    fee_structure_item_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    fee_structure_id BIGINT UNSIGNED NOT NULL,
    fee_type_id INT UNSIGNED NOT NULL,
    semester_id TINYINT UNSIGNED NULL,
    academic_term_id INT UNSIGNED NULL,
    semester_key TINYINT UNSIGNED GENERATED ALWAYS AS (COALESCE(semester_id, 0)) STORED,
    academic_term_key INT UNSIGNED GENERATED ALWAYS AS (COALESCE(academic_term_id, 0)) STORED,
    amount DECIMAL(12,2) NOT NULL,
    due_date DATE NULL,
    due_days_from_registration SMALLINT UNSIGNED NULL,
    installment_allowed BOOLEAN NOT NULL DEFAULT FALSE,
    waiver_allowed BOOLEAN NOT NULL DEFAULT FALSE,
    late_fee_rule_id INT UNSIGNED NULL,
    display_order SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    remarks VARCHAR(500) NULL,
    CONSTRAINT chk_fee_structure_item_amount CHECK (amount >= 0),
    CONSTRAINT uq_fee_structure_item UNIQUE (fee_structure_id, fee_type_id, semester_key, academic_term_key),
    CONSTRAINT fk_fee_structure_item_header FOREIGN KEY (fee_structure_id) REFERENCES fee_structure(fee_structure_id),
    CONSTRAINT fk_fee_structure_item_type FOREIGN KEY (fee_type_id) REFERENCES fee_type(fee_type_id),
    CONSTRAINT fk_fee_structure_item_semester FOREIGN KEY (semester_id) REFERENCES semester(semester_id),
    CONSTRAINT fk_fee_structure_item_term FOREIGN KEY (academic_term_id) REFERENCES academic_term(academic_term_id),
    CONSTRAINT fk_fee_structure_item_late_rule FOREIGN KEY (late_fee_rule_id) REFERENCES late_fee_rule(late_fee_rule_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE student_financial_account (
    student_account_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    student_id BIGINT UNSIGNED NOT NULL UNIQUE,
    account_number VARCHAR(40) NOT NULL UNIQUE,
    account_status ENUM('ACTIVE','ON_HOLD','CLOSED') NOT NULL DEFAULT 'ACTIVE',
    opening_balance DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    credit_balance DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_student_financial_account_student FOREIGN KEY (student_id) REFERENCES student(student_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE student_fee_assessment (
    fee_assessment_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    assessment_number VARCHAR(50) NOT NULL UNIQUE,
    student_account_id BIGINT UNSIGNED NULL,
    application_id BIGINT UNSIGNED NULL,
    enrolment_id BIGINT UNSIGNED NULL,
    term_registration_id BIGINT UNSIGNED NULL,
    academic_year_id SMALLINT UNSIGNED NOT NULL,
    academic_term_id INT UNSIGNED NULL,
    fee_structure_id BIGINT UNSIGNED NULL,
    assessment_type ENUM('ADMISSION','ACADEMIC','EXAMINATION','HOSTEL','TRANSPORT','LIBRARY','CERTIFICATE','PENALTY','SERVICE','OTHER') NOT NULL,
    assessment_date DATE NOT NULL,
    gross_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    concession_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    scholarship_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    adjustment_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    net_payable_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    amount_paid DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    balance_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    due_date DATE NULL,
    assessment_status ENUM('DRAFT','ASSESSED','PARTIALLY_PAID','PAID','OVERDUE','CANCELLED','WAIVED') NOT NULL DEFAULT 'DRAFT',
    remarks VARCHAR(500) NULL,
    created_by BIGINT UNSIGNED NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT chk_fee_assessment_context CHECK (student_account_id IS NOT NULL OR application_id IS NOT NULL),
    CONSTRAINT chk_fee_assessment_amounts CHECK (
        gross_amount >= 0 AND concession_amount >= 0 AND scholarship_amount >= 0 AND
        net_payable_amount >= 0 AND amount_paid >= 0 AND amount_paid <= net_payable_amount AND
        net_payable_amount = gross_amount - concession_amount - scholarship_amount + adjustment_amount AND
        balance_amount = net_payable_amount - amount_paid
    ),
    CONSTRAINT fk_fee_assessment_account FOREIGN KEY (student_account_id) REFERENCES student_financial_account(student_account_id),
    CONSTRAINT fk_fee_assessment_application FOREIGN KEY (application_id) REFERENCES admission_application(application_id),
    CONSTRAINT fk_fee_assessment_enrolment FOREIGN KEY (enrolment_id) REFERENCES student_programme_enrolment(enrolment_id),
    CONSTRAINT fk_fee_assessment_term_registration FOREIGN KEY (term_registration_id) REFERENCES student_term_registration(term_registration_id),
    CONSTRAINT fk_fee_assessment_year FOREIGN KEY (academic_year_id) REFERENCES academic_year(academic_year_id),
    CONSTRAINT fk_fee_assessment_term FOREIGN KEY (academic_term_id) REFERENCES academic_term(academic_term_id),
    CONSTRAINT fk_fee_assessment_structure FOREIGN KEY (fee_structure_id) REFERENCES fee_structure(fee_structure_id),
    CONSTRAINT fk_fee_assessment_creator FOREIGN KEY (created_by) REFERENCES user_account(user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE student_fee_assessment_item (
    assessment_item_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    fee_assessment_id BIGINT UNSIGNED NOT NULL,
    fee_type_id INT UNSIGNED NOT NULL,
    fee_structure_item_id BIGINT UNSIGNED NULL,
    description VARCHAR(250) NULL,
    original_amount DECIMAL(12,2) NOT NULL,
    concession_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    scholarship_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    adjustment_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    net_amount DECIMAL(12,2) NOT NULL,
    amount_paid DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    balance_amount DECIMAL(12,2) NOT NULL,
    due_date DATE NULL,
    item_status ENUM('ASSESSED','PARTIALLY_PAID','PAID','OVERDUE','CANCELLED','WAIVED') NOT NULL DEFAULT 'ASSESSED',
    CONSTRAINT chk_fee_assessment_item_amounts CHECK (
        original_amount >= 0 AND concession_amount >= 0 AND scholarship_amount >= 0 AND
        net_amount >= 0 AND amount_paid >= 0 AND amount_paid <= net_amount AND
        net_amount = original_amount - concession_amount - scholarship_amount + adjustment_amount AND
        balance_amount = net_amount - amount_paid
    ),
    CONSTRAINT fk_fee_item_assessment FOREIGN KEY (fee_assessment_id) REFERENCES student_fee_assessment(fee_assessment_id),
    CONSTRAINT fk_fee_item_type FOREIGN KEY (fee_type_id) REFERENCES fee_type(fee_type_id),
    CONSTRAINT fk_fee_item_structure_item FOREIGN KEY (fee_structure_item_id) REFERENCES fee_structure_item(fee_structure_item_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE fee_charge_source (
    charge_source_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    assessment_item_id BIGINT UNSIGNED NOT NULL,
    source_module VARCHAR(50) NOT NULL,
    source_entity VARCHAR(80) NOT NULL,
    source_entity_id BIGINT UNSIGNED NOT NULL,
    CONSTRAINT uq_fee_charge_source UNIQUE (assessment_item_id, source_module, source_entity, source_entity_id),
    CONSTRAINT fk_fee_charge_source_item FOREIGN KEY (assessment_item_id) REFERENCES student_fee_assessment_item(assessment_item_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE concession_type (
    concession_type_id SMALLINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    concession_code VARCHAR(40) NOT NULL UNIQUE,
    concession_name VARCHAR(150) NOT NULL,
    concession_basis ENUM('PERCENTAGE','FIXED_AMOUNT') NOT NULL,
    maximum_percentage DECIMAL(5,2) NULL,
    maximum_amount DECIMAL(12,2) NULL,
    approval_required BOOLEAN NOT NULL DEFAULT TRUE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE student_fee_concession (
    student_concession_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    student_id BIGINT UNSIGNED NOT NULL,
    concession_type_id SMALLINT UNSIGNED NOT NULL,
    academic_year_id SMALLINT UNSIGNED NOT NULL,
    application_number VARCHAR(50) NULL,
    application_date DATE NULL,
    approved_percentage DECIMAL(5,2) NULL,
    approved_amount DECIMAL(12,2) NULL,
    valid_from DATE NULL,
    valid_to DATE NULL,
    approval_status ENUM('DRAFT','SUBMITTED','APPROVED','REJECTED','EXPIRED','CANCELLED') NOT NULL DEFAULT 'DRAFT',
    approved_by BIGINT UNSIGNED NULL,
    approved_at DATETIME NULL,
    remarks VARCHAR(500) NULL,
    CONSTRAINT fk_student_concession_student FOREIGN KEY (student_id) REFERENCES student(student_id),
    CONSTRAINT fk_student_concession_type FOREIGN KEY (concession_type_id) REFERENCES concession_type(concession_type_id),
    CONSTRAINT fk_student_concession_year FOREIGN KEY (academic_year_id) REFERENCES academic_year(academic_year_id),
    CONSTRAINT fk_student_concession_approver FOREIGN KEY (approved_by) REFERENCES user_account(user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE scholarship_scheme (
    scholarship_scheme_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    scheme_code VARCHAR(50) NOT NULL UNIQUE,
    scheme_name VARCHAR(200) NOT NULL,
    sponsoring_authority VARCHAR(200) NULL,
    scheme_type ENUM('GOVERNMENT','INSTITUTIONAL','PRIVATE','CSR','OTHER') NOT NULL,
    maximum_amount DECIMAL(12,2) NULL,
    is_reimbursable BOOLEAN NOT NULL DEFAULT FALSE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE student_scholarship (
    student_scholarship_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    student_id BIGINT UNSIGNED NOT NULL,
    scholarship_scheme_id INT UNSIGNED NOT NULL,
    academic_year_id SMALLINT UNSIGNED NOT NULL,
    application_number VARCHAR(60) NULL,
    sanction_number VARCHAR(60) NULL,
    applied_amount DECIMAL(12,2) NULL,
    sanctioned_amount DECIMAL(12,2) NULL,
    received_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    application_status ENUM('DRAFT','SUBMITTED','VERIFIED','SANCTIONED','REJECTED','RECEIVED','CANCELLED') NOT NULL DEFAULT 'DRAFT',
    sanction_date DATE NULL,
    received_date DATE NULL,
    remarks VARCHAR(500) NULL,
    CONSTRAINT fk_student_scholarship_student FOREIGN KEY (student_id) REFERENCES student(student_id),
    CONSTRAINT fk_student_scholarship_scheme FOREIGN KEY (scholarship_scheme_id) REFERENCES scholarship_scheme(scholarship_scheme_id),
    CONSTRAINT fk_student_scholarship_year FOREIGN KEY (academic_year_id) REFERENCES academic_year(academic_year_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE student_sponsorship (
    student_sponsorship_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    student_id BIGINT UNSIGNED NOT NULL,
    academic_year_id SMALLINT UNSIGNED NOT NULL,
    sponsoring_authority VARCHAR(200) NOT NULL,
    sanction_reference VARCHAR(100) NOT NULL,
    sanctioned_amount DECIMAL(12,2) NOT NULL,
    valid_from DATE NULL,
    valid_to DATE NULL,
    approval_status ENUM('PENDING','APPROVED','REJECTED','CANCELLED') NOT NULL DEFAULT 'PENDING',
    approved_by BIGINT UNSIGNED NULL,
    approved_at DATETIME NULL,
    CONSTRAINT uq_student_sponsorship_reference UNIQUE (student_id, academic_year_id, sanction_reference),
    CONSTRAINT chk_student_sponsorship_amount CHECK (sanctioned_amount > 0),
    CONSTRAINT chk_student_sponsorship_dates CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to >= valid_from),
    CONSTRAINT fk_student_sponsorship_student FOREIGN KEY (student_id) REFERENCES student(student_id),
    CONSTRAINT fk_student_sponsorship_year FOREIGN KEY (academic_year_id) REFERENCES academic_year(academic_year_id),
    CONSTRAINT fk_student_sponsorship_approver FOREIGN KEY (approved_by) REFERENCES user_account(user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE fee_assessment_benefit (
    assessment_benefit_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    assessment_item_id BIGINT UNSIGNED NOT NULL,
    benefit_type ENUM('CONCESSION','SCHOLARSHIP','SPONSORSHIP') NOT NULL,
    student_concession_id BIGINT UNSIGNED NULL,
    student_scholarship_id BIGINT UNSIGNED NULL,
    student_sponsorship_id BIGINT UNSIGNED NULL,
    benefit_amount DECIMAL(12,2) NOT NULL,
    applied_date DATE NOT NULL,
    approved_by BIGINT UNSIGNED NULL,
    CONSTRAINT chk_fee_benefit_amount CHECK (benefit_amount > 0),
    CONSTRAINT chk_fee_benefit_source CHECK (
        (benefit_type='CONCESSION' AND student_concession_id IS NOT NULL AND student_scholarship_id IS NULL AND student_sponsorship_id IS NULL) OR
        (benefit_type='SCHOLARSHIP' AND student_concession_id IS NULL AND student_scholarship_id IS NOT NULL AND student_sponsorship_id IS NULL) OR
        (benefit_type='SPONSORSHIP' AND student_concession_id IS NULL AND student_scholarship_id IS NULL AND student_sponsorship_id IS NOT NULL)
    ),
    CONSTRAINT fk_fee_benefit_item FOREIGN KEY (assessment_item_id) REFERENCES student_fee_assessment_item(assessment_item_id),
    CONSTRAINT fk_fee_benefit_concession FOREIGN KEY (student_concession_id) REFERENCES student_fee_concession(student_concession_id),
    CONSTRAINT fk_fee_benefit_scholarship FOREIGN KEY (student_scholarship_id) REFERENCES student_scholarship(student_scholarship_id),
    CONSTRAINT fk_fee_benefit_sponsorship FOREIGN KEY (student_sponsorship_id) REFERENCES student_sponsorship(student_sponsorship_id),
    CONSTRAINT fk_fee_benefit_approver FOREIGN KEY (approved_by) REFERENCES user_account(user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE installment_plan (
    installment_plan_id SMALLINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    plan_code VARCHAR(40) NOT NULL UNIQUE,
    plan_name VARCHAR(120) NOT NULL,
    number_of_installments TINYINT UNSIGNED NOT NULL,
    minimum_initial_percentage DECIMAL(5,2) NULL,
    approval_required BOOLEAN NOT NULL DEFAULT TRUE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE student_installment_schedule (
    student_installment_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    fee_assessment_id BIGINT UNSIGNED NOT NULL,
    installment_plan_id SMALLINT UNSIGNED NULL,
    installment_number TINYINT UNSIGNED NOT NULL,
    due_date DATE NOT NULL,
    installment_amount DECIMAL(12,2) NOT NULL,
    amount_paid DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    balance_amount DECIMAL(12,2) NOT NULL,
    installment_status ENUM('PENDING','PARTIALLY_PAID','PAID','OVERDUE','WAIVED','CANCELLED') NOT NULL DEFAULT 'PENDING',
    CONSTRAINT uq_student_installment UNIQUE (fee_assessment_id, installment_number),
    CONSTRAINT fk_installment_assessment FOREIGN KEY (fee_assessment_id) REFERENCES student_fee_assessment(fee_assessment_id),
    CONSTRAINT fk_installment_plan FOREIGN KEY (installment_plan_id) REFERENCES installment_plan(installment_plan_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE payment_mode (
    payment_mode_id TINYINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    mode_code VARCHAR(30) NOT NULL UNIQUE,
    mode_name VARCHAR(80) NOT NULL UNIQUE,
    requires_reference BOOLEAN NOT NULL DEFAULT FALSE,
    is_online BOOLEAN NOT NULL DEFAULT FALSE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE payment_transaction (
    payment_transaction_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    transaction_number VARCHAR(60) NOT NULL UNIQUE,
    student_account_id BIGINT UNSIGNED NULL,
    application_id BIGINT UNSIGNED NULL,
    transaction_date DATETIME NOT NULL,
    payment_mode_id TINYINT UNSIGNED NOT NULL,
    amount DECIMAL(12,2) NOT NULL,
    currency_code CHAR(3) NOT NULL DEFAULT 'INR',
    payment_status ENUM('INITIATED','PENDING','SUCCESS','FAILED','CANCELLED','REVERSED','PARTIALLY_REFUNDED','REFUNDED') NOT NULL,
    gateway_name VARCHAR(80) NULL,
    gateway_transaction_id VARCHAR(120) NULL,
    bank_reference_number VARCHAR(120) NULL,
    cheque_number VARCHAR(50) NULL,
    cheque_date DATE NULL,
    bank_name VARCHAR(150) NULL,
    payer_name VARCHAR(150) NULL,
    payer_contact VARCHAR(100) NULL,
    received_by BIGINT UNSIGNED NULL,
    remarks VARCHAR(500) NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_payment_context CHECK (student_account_id IS NOT NULL OR application_id IS NOT NULL),
    CONSTRAINT chk_payment_amount CHECK (amount > 0),
    CONSTRAINT uq_payment_application_owner UNIQUE (payment_transaction_id, application_id),
    CONSTRAINT fk_payment_account FOREIGN KEY (student_account_id) REFERENCES student_financial_account(student_account_id),
    CONSTRAINT fk_payment_application FOREIGN KEY (application_id) REFERENCES admission_application(application_id),
    CONSTRAINT fk_payment_mode FOREIGN KEY (payment_mode_id) REFERENCES payment_mode(payment_mode_id),
    CONSTRAINT fk_payment_receiver FOREIGN KEY (received_by) REFERENCES user_account(user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Admission payments now use the same payment_transaction ledger as all other fees.
CREATE TABLE admission_payment (
    admission_payment_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    application_id BIGINT UNSIGNED NOT NULL,
    payment_transaction_id BIGINT UNSIGNED NOT NULL UNIQUE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_admission_payment_application FOREIGN KEY (application_id) REFERENCES admission_application(application_id),
    CONSTRAINT fk_admission_payment_transaction_application FOREIGN KEY (payment_transaction_id, application_id)
        REFERENCES payment_transaction(payment_transaction_id, application_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE payment_allocation (
    payment_allocation_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    payment_transaction_id BIGINT UNSIGNED NOT NULL,
    assessment_item_id BIGINT UNSIGNED NOT NULL,
    allocated_amount DECIMAL(12,2) NOT NULL,
    allocation_date DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    allocated_by BIGINT UNSIGNED NULL,
    CONSTRAINT uq_payment_allocation UNIQUE (payment_transaction_id, assessment_item_id),
    CONSTRAINT chk_allocated_amount CHECK (allocated_amount > 0),
    CONSTRAINT fk_payment_allocation_payment FOREIGN KEY (payment_transaction_id) REFERENCES payment_transaction(payment_transaction_id),
    CONSTRAINT fk_payment_allocation_item FOREIGN KEY (assessment_item_id) REFERENCES student_fee_assessment_item(assessment_item_id),
    CONSTRAINT fk_payment_allocation_user FOREIGN KEY (allocated_by) REFERENCES user_account(user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE fee_receipt (
    fee_receipt_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    receipt_number VARCHAR(60) NOT NULL UNIQUE,
    payment_transaction_id BIGINT UNSIGNED NOT NULL,
    receipt_date DATETIME NOT NULL,
    receipt_amount DECIMAL(12,2) NOT NULL,
    receipt_status ENUM('ISSUED','CANCELLED','REPLACED','REVERSED') NOT NULL DEFAULT 'ISSUED',
    issued_by BIGINT UNSIGNED NULL,
    cancelled_by BIGINT UNSIGNED NULL,
    cancelled_at DATETIME NULL,
    cancellation_reason VARCHAR(500) NULL,
    original_receipt_id BIGINT UNSIGNED NULL,
    CONSTRAINT fk_fee_receipt_payment FOREIGN KEY (payment_transaction_id) REFERENCES payment_transaction(payment_transaction_id),
    CONSTRAINT fk_fee_receipt_issuer FOREIGN KEY (issued_by) REFERENCES user_account(user_id),
    CONSTRAINT fk_fee_receipt_canceller FOREIGN KEY (cancelled_by) REFERENCES user_account(user_id),
    CONSTRAINT fk_fee_receipt_original FOREIGN KEY (original_receipt_id) REFERENCES fee_receipt(fee_receipt_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE fee_adjustment (
    fee_adjustment_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    adjustment_number VARCHAR(60) NOT NULL UNIQUE,
    student_account_id BIGINT UNSIGNED NOT NULL,
    assessment_item_id BIGINT UNSIGNED NULL,
    adjustment_type ENUM('CREDIT','DEBIT','WAIVER','WRITE_OFF','TRANSFER','CORRECTION') NOT NULL,
    adjustment_date DATE NOT NULL,
    adjustment_amount DECIMAL(12,2) NOT NULL,
    reason VARCHAR(500) NOT NULL,
    approval_status ENUM('DRAFT','SUBMITTED','APPROVED','REJECTED','CANCELLED') NOT NULL DEFAULT 'DRAFT',
    approved_by BIGINT UNSIGNED NULL,
    approved_at DATETIME NULL,
    CONSTRAINT chk_adjustment_amount CHECK (adjustment_amount > 0),
    CONSTRAINT fk_fee_adjustment_account FOREIGN KEY (student_account_id) REFERENCES student_financial_account(student_account_id),
    CONSTRAINT fk_fee_adjustment_item FOREIGN KEY (assessment_item_id) REFERENCES student_fee_assessment_item(assessment_item_id),
    CONSTRAINT fk_fee_adjustment_approver FOREIGN KEY (approved_by) REFERENCES user_account(user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE refund_request (
    refund_request_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    refund_request_number VARCHAR(60) NOT NULL UNIQUE,
    student_account_id BIGINT UNSIGNED NOT NULL,
    payment_transaction_id BIGINT UNSIGNED NULL,
    request_date DATE NOT NULL,
    refund_reason VARCHAR(500) NOT NULL,
    requested_amount DECIMAL(12,2) NOT NULL,
    approved_amount DECIMAL(12,2) NULL,
    request_status ENUM('SUBMITTED','UNDER_REVIEW','APPROVED','REJECTED','PROCESSED','CANCELLED') NOT NULL DEFAULT 'SUBMITTED',
    approved_by BIGINT UNSIGNED NULL,
    approved_at DATETIME NULL,
    CONSTRAINT chk_refund_request_amounts CHECK (
        requested_amount > 0 AND (approved_amount IS NULL OR (approved_amount >= 0 AND approved_amount <= requested_amount))
    ),
    CONSTRAINT fk_refund_request_account FOREIGN KEY (student_account_id) REFERENCES student_financial_account(student_account_id),
    CONSTRAINT fk_refund_request_payment FOREIGN KEY (payment_transaction_id) REFERENCES payment_transaction(payment_transaction_id),
    CONSTRAINT fk_refund_request_approver FOREIGN KEY (approved_by) REFERENCES user_account(user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE fee_refund (
    fee_refund_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    refund_request_id BIGINT UNSIGNED NOT NULL,
    refund_transaction_number VARCHAR(60) NOT NULL UNIQUE,
    refund_date DATETIME NOT NULL,
    refund_amount DECIMAL(12,2) NOT NULL,
    refund_mode_id TINYINT UNSIGNED NOT NULL,
    bank_reference_number VARCHAR(120) NULL,
    processed_by BIGINT UNSIGNED NULL,
    refund_status ENUM('INITIATED','PROCESSING','SUCCESS','FAILED','CANCELLED') NOT NULL,
    remarks VARCHAR(500) NULL,
    CONSTRAINT chk_refund_amount CHECK (refund_amount > 0),
    CONSTRAINT fk_fee_refund_request FOREIGN KEY (refund_request_id) REFERENCES refund_request(refund_request_id),
    CONSTRAINT fk_fee_refund_mode FOREIGN KEY (refund_mode_id) REFERENCES payment_mode(payment_mode_id),
    CONSTRAINT fk_fee_refund_processor FOREIGN KEY (processed_by) REFERENCES user_account(user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE student_fee_penalty (
    fee_penalty_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    student_account_id BIGINT UNSIGNED NOT NULL,
    assessment_item_id BIGINT UNSIGNED NULL,
    fee_type_id INT UNSIGNED NOT NULL,
    penalty_date DATE NOT NULL,
    penalty_reason VARCHAR(500) NOT NULL,
    penalty_amount DECIMAL(12,2) NOT NULL,
    waived_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    net_penalty_amount DECIMAL(12,2) NOT NULL,
    penalty_status ENUM('ASSESSED','PARTIALLY_PAID','PAID','WAIVED','CANCELLED') NOT NULL DEFAULT 'ASSESSED',
    approved_by BIGINT UNSIGNED NULL,
    CONSTRAINT fk_fee_penalty_account FOREIGN KEY (student_account_id) REFERENCES student_financial_account(student_account_id),
    CONSTRAINT fk_fee_penalty_item FOREIGN KEY (assessment_item_id) REFERENCES student_fee_assessment_item(assessment_item_id),
    CONSTRAINT fk_fee_penalty_type FOREIGN KEY (fee_type_id) REFERENCES fee_type(fee_type_id),
    CONSTRAINT fk_fee_penalty_approver FOREIGN KEY (approved_by) REFERENCES user_account(user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE service_fee_request (
    service_fee_request_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    request_number VARCHAR(50) NOT NULL UNIQUE,
    student_id BIGINT UNSIGNED NOT NULL,
    certificate_request_id BIGINT UNSIGNED NULL,
    fee_type_id INT UNSIGNED NOT NULL,
    request_date DATE NOT NULL,
    service_description VARCHAR(500) NULL,
    quantity SMALLINT UNSIGNED NOT NULL DEFAULT 1,
    unit_amount DECIMAL(12,2) NOT NULL,
    total_amount DECIMAL(12,2) NOT NULL,
    fee_assessment_id BIGINT UNSIGNED NULL,
    request_status ENUM('DRAFT','SUBMITTED','ASSESSED','PAID','PROCESSING','COMPLETED','REJECTED','CANCELLED') NOT NULL DEFAULT 'DRAFT',
    processed_by BIGINT UNSIGNED NULL,
    processed_at DATETIME NULL,
    CONSTRAINT fk_service_fee_student FOREIGN KEY (student_id) REFERENCES student(student_id),
    CONSTRAINT fk_service_fee_certificate FOREIGN KEY (certificate_request_id) REFERENCES certificate_request(certificate_request_id),
    CONSTRAINT fk_service_fee_type FOREIGN KEY (fee_type_id) REFERENCES fee_type(fee_type_id),
    CONSTRAINT fk_service_fee_assessment FOREIGN KEY (fee_assessment_id) REFERENCES student_fee_assessment(fee_assessment_id),
    CONSTRAINT fk_service_fee_processor FOREIGN KEY (processed_by) REFERENCES user_account(user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE student_financial_hold (
    financial_hold_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    student_account_id BIGINT UNSIGNED NOT NULL,
    hold_type ENUM('REGISTRATION','EXAMINATION','HALL_TICKET','RESULT','CERTIFICATE','HOSTEL_CHECKOUT','GRADUATION','OTHER') NOT NULL,
    hold_reason VARCHAR(500) NOT NULL,
    placed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    placed_by BIGINT UNSIGNED NOT NULL,
    released_at DATETIME NULL,
    released_by BIGINT UNSIGNED NULL,
    release_reason VARCHAR(500) NULL,
    hold_status ENUM('ACTIVE','RELEASED','CANCELLED') NOT NULL DEFAULT 'ACTIVE',
    CONSTRAINT fk_financial_hold_account FOREIGN KEY (student_account_id) REFERENCES student_financial_account(student_account_id),
    CONSTRAINT fk_financial_hold_placed_by FOREIGN KEY (placed_by) REFERENCES user_account(user_id),
    CONSTRAINT fk_financial_hold_released_by FOREIGN KEY (released_by) REFERENCES user_account(user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE fee_activity_audit (
    fee_audit_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT UNSIGNED NULL,
    action_code VARCHAR(50) NOT NULL,
    entity_name VARCHAR(80) NOT NULL,
    entity_id BIGINT UNSIGNED NOT NULL,
    old_values JSON NULL,
    new_values JSON NULL,
    ip_address VARCHAR(45) NULL,
    performed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_fee_audit_user FOREIGN KEY (user_id) REFERENCES user_account(user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT INTO fee_category (category_code, category_name, display_order, is_refundable) VALUES
('ADMISSION','Admission Fees',10,FALSE),('ACADEMIC','Academic Fees',20,FALSE),
('EXAMINATION','Examination Fees',30,FALSE),('HOSTEL','Hostel Fees',40,TRUE),
('TRANSPORT','Transport Fees',50,TRUE),('LIBRARY','Library Fees and Penalties',60,FALSE),
('CERTIFICATE','Certificate and Document Fees',70,FALSE),('PENALTY','Fines and Penalties',80,FALSE),
('OTHER','Other Fees',90,FALSE);

INSERT INTO payment_mode (mode_code, mode_name, requires_reference, is_online) VALUES
('CASH','Cash',FALSE,FALSE),('CARD','Card',TRUE,TRUE),('UPI','UPI',TRUE,TRUE),
('NET_BANKING','Net Banking',TRUE,TRUE),('BANK_TRANSFER','Bank Transfer',TRUE,FALSE),
('CHEQUE','Cheque',TRUE,FALSE),('DEMAND_DRAFT','Demand Draft',TRUE,FALSE),
('PAYMENT_GATEWAY','Payment Gateway',TRUE,TRUE),('SCHOLARSHIP','Scholarship Credit',TRUE,FALSE),
('SPONSOR','Sponsor Payment',TRUE,FALSE),('ADJUSTMENT','Account Adjustment',TRUE,FALSE);

INSERT IGNORE INTO role (role_code, role_name, role_category, role_level, description, is_system_role) VALUES
('FINANCE_OFFICER','Finance Officer','ADMINISTRATIVE','INSTITUTION','Approves fee structures, refunds and financial reports.',TRUE),
('ACCOUNTANT','Accountant','ADMINISTRATIVE','CAMPUS','Maintains fee assessments, allocations and reconciliation.',TRUE),
('CASHIER','Cashier','ADMINISTRATIVE','CAMPUS','Receives payments and issues receipts.',TRUE),
('FEE_VERIFICATION_OFFICER','Fee Verification Officer','ADMINISTRATIVE','CAMPUS','Verifies concessions, scholarships and fee records.',TRUE),
('SCHOLARSHIP_OFFICER','Scholarship Officer','ADMINISTRATIVE','INSTITUTION','Administers scholarships and sponsorships.',TRUE);

INSERT IGNORE INTO access_module (module_code, module_name, description, display_order)
VALUES ('FEES','Fees and Financial Management','Student fee structures, assessments, payments, concessions, refunds and audit.',160);

INSERT IGNORE INTO access_resource (access_module_id, resource_code, resource_name, description)
SELECT access_module_id, 'FEE_STRUCTURE', 'Fee Structure', 'Configure and approve programme fee structures.' FROM access_module WHERE module_code='FEES';
INSERT IGNORE INTO access_resource (access_module_id, resource_code, resource_name, description)
SELECT access_module_id, 'FEE_ASSESSMENT', 'Student Fee Assessment', 'Raise and maintain student fee demands.' FROM access_module WHERE module_code='FEES';
INSERT IGNORE INTO access_resource (access_module_id, resource_code, resource_name, description)
SELECT access_module_id, 'FEE_PAYMENT', 'Fee Payment and Receipt', 'Record payments, allocate collections and issue receipts.' FROM access_module WHERE module_code='FEES';
INSERT IGNORE INTO access_resource (access_module_id, resource_code, resource_name, description)
SELECT access_module_id, 'FEE_BENEFIT', 'Concession and Scholarship', 'Administer concessions, scholarships and sponsorships.' FROM access_module WHERE module_code='FEES';
INSERT IGNORE INTO access_resource (access_module_id, resource_code, resource_name, description)
SELECT access_module_id, 'FEE_REFUND', 'Refund and Adjustment', 'Approve and process refunds, waivers and adjustments.' FROM access_module WHERE module_code='FEES';
INSERT IGNORE INTO access_resource (access_module_id, resource_code, resource_name, description)
SELECT access_module_id, 'FEE_REPORT', 'Fee Reports and Audit', 'View outstanding dues, collections and audit reports.' FROM access_module WHERE module_code='FEES';

INSERT IGNORE INTO permission (access_resource_id, access_action_id, permission_code, permission_name, is_sensitive)
SELECT ar.access_resource_id, aa.access_action_id,
       CONCAT('FEES.', ar.resource_code, '.', aa.action_code),
       CONCAT(aa.action_name, ' ', ar.resource_name),
       CASE WHEN aa.action_code IN ('APPROVE','DELETE','CONFIGURE','EXPORT') THEN TRUE ELSE FALSE END
FROM access_resource ar
JOIN access_module am ON am.access_module_id=ar.access_module_id AND am.module_code='FEES'
CROSS JOIN access_action aa
WHERE aa.action_code IN ('CREATE','READ','UPDATE','DELETE','APPROVE','VERIFY','EXPORT','CONFIGURE');

INSERT IGNORE INTO role_permission (role_id, permission_id)
SELECT r.role_id, p.permission_id FROM role r CROSS JOIN permission p
WHERE r.role_code='FINANCE_OFFICER' AND p.permission_code LIKE 'FEES.%';

INSERT IGNORE INTO role_permission (role_id, permission_id)
SELECT r.role_id, p.permission_id FROM role r CROSS JOIN permission p
JOIN access_action aa ON aa.access_action_id=p.access_action_id
WHERE r.role_code='ACCOUNTANT' AND p.permission_code LIKE 'FEES.%'
  AND aa.action_code IN ('CREATE','READ','UPDATE','VERIFY','EXPORT');

INSERT IGNORE INTO role_permission (role_id, permission_id)
SELECT r.role_id, p.permission_id FROM role r CROSS JOIN permission p
JOIN access_resource ar ON ar.access_resource_id=p.access_resource_id
JOIN access_action aa ON aa.access_action_id=p.access_action_id
WHERE r.role_code='CASHIER' AND ar.resource_code='FEE_PAYMENT'
  AND aa.action_code IN ('CREATE','READ','UPDATE','VERIFY');

INSERT IGNORE INTO role_permission (role_id, permission_id)
SELECT r.role_id, p.permission_id FROM role r CROSS JOIN permission p
JOIN access_resource ar ON ar.access_resource_id=p.access_resource_id
JOIN access_action aa ON aa.access_action_id=p.access_action_id
WHERE r.role_code IN ('SCHOLARSHIP_OFFICER','FEE_VERIFICATION_OFFICER')
  AND ar.resource_code IN ('FEE_BENEFIT','FEE_ASSESSMENT','FEE_REPORT')
  AND aa.action_code IN ('CREATE','READ','UPDATE','APPROVE','VERIFY','EXPORT');

CREATE OR REPLACE VIEW v_student_fee_balance AS
SELECT sfa.student_account_id, sfa.student_id, sfa.account_number,
       COALESCE(SUM(sfa2.net_payable_amount),0.00) AS total_assessed,
       COALESCE(SUM(sfa2.amount_paid),0.00) AS total_paid,
       COALESCE(SUM(sfa2.balance_amount),0.00) AS total_outstanding,
       sfa.credit_balance
FROM student_financial_account sfa
LEFT JOIN student_fee_assessment sfa2 ON sfa2.student_account_id=sfa.student_account_id
 AND sfa2.assessment_status NOT IN ('CANCELLED','WAIVED')
GROUP BY sfa.student_account_id, sfa.student_id, sfa.account_number, sfa.credit_balance;

CREATE OR REPLACE VIEW v_fee_collection_summary AS
SELECT DATE(pt.transaction_date) AS collection_date, pm.mode_code,
       COUNT(*) AS transaction_count, SUM(pt.amount) AS collected_amount
FROM payment_transaction pt
JOIN payment_mode pm ON pm.payment_mode_id=pt.payment_mode_id
WHERE pt.payment_status='SUCCESS'
GROUP BY DATE(pt.transaction_date), pm.mode_code;


-- =============================================================
-- 17A. ENFORCEMENT TRIGGERS FOR CROSS-ROW / CROSS-TABLE RULES
-- =============================================================
DELIMITER $$

CREATE TRIGGER trg_user_role_assignment_scope_bi
BEFORE INSERT ON user_role_assignment
FOR EACH ROW
BEGIN
    DECLARE v_role_level VARCHAR(20);
    SELECT role_level INTO v_role_level FROM role WHERE role_id = NEW.role_id;
    IF v_role_level <> NEW.scope_type THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Role level must match assignment scope_type';
    END IF;
END$$

CREATE TRIGGER trg_user_role_assignment_scope_bu
BEFORE UPDATE ON user_role_assignment
FOR EACH ROW
BEGIN
    DECLARE v_role_level VARCHAR(20);
    SELECT role_level INTO v_role_level FROM role WHERE role_id = NEW.role_id;
    IF v_role_level <> NEW.scope_type THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Role level must match assignment scope_type';
    END IF;
END$$

CREATE TRIGGER trg_user_permission_override_scope_bi
BEFORE INSERT ON user_permission_override
FOR EACH ROW
BEGIN
    IF NEW.scope_type='INSTITUTION' AND NOT EXISTS (SELECT 1 FROM institution WHERE institution_id=NEW.scope_entity_id) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Invalid institution scope_entity_id';
    ELSEIF NEW.scope_type='CAMPUS' AND NOT EXISTS (SELECT 1 FROM campus WHERE campus_id=NEW.scope_entity_id) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Invalid campus scope_entity_id';
    ELSEIF NEW.scope_type='DEPARTMENT' AND NOT EXISTS (SELECT 1 FROM department WHERE department_id=NEW.scope_entity_id) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Invalid department scope_entity_id';
    ELSEIF NEW.scope_type='PROGRAMME' AND NOT EXISTS (SELECT 1 FROM programme WHERE programme_id=NEW.scope_entity_id) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Invalid programme scope_entity_id';
    END IF;
END$$

CREATE TRIGGER trg_user_permission_override_scope_bu
BEFORE UPDATE ON user_permission_override
FOR EACH ROW
BEGIN
    IF NEW.scope_type='INSTITUTION' AND NOT EXISTS (SELECT 1 FROM institution WHERE institution_id=NEW.scope_entity_id) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Invalid institution scope_entity_id';
    ELSEIF NEW.scope_type='CAMPUS' AND NOT EXISTS (SELECT 1 FROM campus WHERE campus_id=NEW.scope_entity_id) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Invalid campus scope_entity_id';
    ELSEIF NEW.scope_type='DEPARTMENT' AND NOT EXISTS (SELECT 1 FROM department WHERE department_id=NEW.scope_entity_id) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Invalid department scope_entity_id';
    ELSEIF NEW.scope_type='PROGRAMME' AND NOT EXISTS (SELECT 1 FROM programme WHERE programme_id=NEW.scope_entity_id) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Invalid programme scope_entity_id';
    END IF;
END$$

-- Keep fee-assessment header totals synchronized with its detail items.
CREATE TRIGGER trg_fee_item_ai
AFTER INSERT ON student_fee_assessment_item
FOR EACH ROW
BEGIN
    UPDATE student_fee_assessment a
    SET gross_amount=(SELECT COALESCE(SUM(i.original_amount),0) FROM student_fee_assessment_item i WHERE i.fee_assessment_id=NEW.fee_assessment_id),
        concession_amount=(SELECT COALESCE(SUM(i.concession_amount),0) FROM student_fee_assessment_item i WHERE i.fee_assessment_id=NEW.fee_assessment_id),
        scholarship_amount=(SELECT COALESCE(SUM(i.scholarship_amount),0) FROM student_fee_assessment_item i WHERE i.fee_assessment_id=NEW.fee_assessment_id),
        adjustment_amount=(SELECT COALESCE(SUM(i.adjustment_amount),0) FROM student_fee_assessment_item i WHERE i.fee_assessment_id=NEW.fee_assessment_id),
        net_payable_amount=(SELECT COALESCE(SUM(i.net_amount),0) FROM student_fee_assessment_item i WHERE i.fee_assessment_id=NEW.fee_assessment_id),
        amount_paid=(SELECT COALESCE(SUM(i.amount_paid),0) FROM student_fee_assessment_item i WHERE i.fee_assessment_id=NEW.fee_assessment_id),
        balance_amount=(SELECT COALESCE(SUM(i.balance_amount),0) FROM student_fee_assessment_item i WHERE i.fee_assessment_id=NEW.fee_assessment_id)
    WHERE a.fee_assessment_id=NEW.fee_assessment_id;
END$$

CREATE TRIGGER trg_fee_item_au
AFTER UPDATE ON student_fee_assessment_item
FOR EACH ROW
BEGIN
    UPDATE student_fee_assessment a
    SET gross_amount=(SELECT COALESCE(SUM(i.original_amount),0) FROM student_fee_assessment_item i WHERE i.fee_assessment_id=NEW.fee_assessment_id),
        concession_amount=(SELECT COALESCE(SUM(i.concession_amount),0) FROM student_fee_assessment_item i WHERE i.fee_assessment_id=NEW.fee_assessment_id),
        scholarship_amount=(SELECT COALESCE(SUM(i.scholarship_amount),0) FROM student_fee_assessment_item i WHERE i.fee_assessment_id=NEW.fee_assessment_id),
        adjustment_amount=(SELECT COALESCE(SUM(i.adjustment_amount),0) FROM student_fee_assessment_item i WHERE i.fee_assessment_id=NEW.fee_assessment_id),
        net_payable_amount=(SELECT COALESCE(SUM(i.net_amount),0) FROM student_fee_assessment_item i WHERE i.fee_assessment_id=NEW.fee_assessment_id),
        amount_paid=(SELECT COALESCE(SUM(i.amount_paid),0) FROM student_fee_assessment_item i WHERE i.fee_assessment_id=NEW.fee_assessment_id),
        balance_amount=(SELECT COALESCE(SUM(i.balance_amount),0) FROM student_fee_assessment_item i WHERE i.fee_assessment_id=NEW.fee_assessment_id)
    WHERE a.fee_assessment_id=NEW.fee_assessment_id;
    IF OLD.fee_assessment_id <> NEW.fee_assessment_id THEN
        UPDATE student_fee_assessment a
        SET gross_amount=(SELECT COALESCE(SUM(i.original_amount),0) FROM student_fee_assessment_item i WHERE i.fee_assessment_id=OLD.fee_assessment_id),
            concession_amount=(SELECT COALESCE(SUM(i.concession_amount),0) FROM student_fee_assessment_item i WHERE i.fee_assessment_id=OLD.fee_assessment_id),
            scholarship_amount=(SELECT COALESCE(SUM(i.scholarship_amount),0) FROM student_fee_assessment_item i WHERE i.fee_assessment_id=OLD.fee_assessment_id),
            adjustment_amount=(SELECT COALESCE(SUM(i.adjustment_amount),0) FROM student_fee_assessment_item i WHERE i.fee_assessment_id=OLD.fee_assessment_id),
            net_payable_amount=(SELECT COALESCE(SUM(i.net_amount),0) FROM student_fee_assessment_item i WHERE i.fee_assessment_id=OLD.fee_assessment_id),
            amount_paid=(SELECT COALESCE(SUM(i.amount_paid),0) FROM student_fee_assessment_item i WHERE i.fee_assessment_id=OLD.fee_assessment_id),
            balance_amount=(SELECT COALESCE(SUM(i.balance_amount),0) FROM student_fee_assessment_item i WHERE i.fee_assessment_id=OLD.fee_assessment_id)
        WHERE a.fee_assessment_id=OLD.fee_assessment_id;
    END IF;
END$$

CREATE TRIGGER trg_fee_item_ad
AFTER DELETE ON student_fee_assessment_item
FOR EACH ROW
BEGIN
    UPDATE student_fee_assessment a
    SET gross_amount=(SELECT COALESCE(SUM(i.original_amount),0) FROM student_fee_assessment_item i WHERE i.fee_assessment_id=OLD.fee_assessment_id),
        concession_amount=(SELECT COALESCE(SUM(i.concession_amount),0) FROM student_fee_assessment_item i WHERE i.fee_assessment_id=OLD.fee_assessment_id),
        scholarship_amount=(SELECT COALESCE(SUM(i.scholarship_amount),0) FROM student_fee_assessment_item i WHERE i.fee_assessment_id=OLD.fee_assessment_id),
        adjustment_amount=(SELECT COALESCE(SUM(i.adjustment_amount),0) FROM student_fee_assessment_item i WHERE i.fee_assessment_id=OLD.fee_assessment_id),
        net_payable_amount=(SELECT COALESCE(SUM(i.net_amount),0) FROM student_fee_assessment_item i WHERE i.fee_assessment_id=OLD.fee_assessment_id),
        amount_paid=(SELECT COALESCE(SUM(i.amount_paid),0) FROM student_fee_assessment_item i WHERE i.fee_assessment_id=OLD.fee_assessment_id),
        balance_amount=(SELECT COALESCE(SUM(i.balance_amount),0) FROM student_fee_assessment_item i WHERE i.fee_assessment_id=OLD.fee_assessment_id)
    WHERE a.fee_assessment_id=OLD.fee_assessment_id;
END$$

-- Payment allocation may only use a successful payment, may not exceed the payment,
-- may not exceed the fee item's net amount, and must match the same account/application context.
CREATE TRIGGER trg_payment_allocation_bi
BEFORE INSERT ON payment_allocation
FOR EACH ROW
BEGIN
    DECLARE v_payment_amount DECIMAL(12,2);
    DECLARE v_status VARCHAR(30);
    DECLARE v_payment_account BIGINT UNSIGNED;
    DECLARE v_payment_application BIGINT UNSIGNED;
    DECLARE v_item_net DECIMAL(12,2);
    DECLARE v_assessment_account BIGINT UNSIGNED;
    DECLARE v_assessment_application BIGINT UNSIGNED;
    DECLARE v_existing_payment DECIMAL(12,2);
    DECLARE v_existing_item DECIMAL(12,2);
    SELECT amount,payment_status,student_account_id,application_id
      INTO v_payment_amount,v_status,v_payment_account,v_payment_application
      FROM payment_transaction WHERE payment_transaction_id=NEW.payment_transaction_id FOR UPDATE;
    IF v_status <> 'SUCCESS' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Only SUCCESS payments can be allocated'; END IF;
    SELECT i.net_amount,a.student_account_id,a.application_id
      INTO v_item_net,v_assessment_account,v_assessment_application
      FROM student_fee_assessment_item i JOIN student_fee_assessment a ON a.fee_assessment_id=i.fee_assessment_id
      WHERE i.assessment_item_id=NEW.assessment_item_id FOR UPDATE;
    IF NOT ((v_payment_account IS NOT NULL AND v_payment_account <=> v_assessment_account)
            OR (v_payment_application IS NOT NULL AND v_payment_application <=> v_assessment_application)) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Payment and assessment contexts do not match';
    END IF;
    SELECT COALESCE(SUM(allocated_amount),0) INTO v_existing_payment FROM payment_allocation WHERE payment_transaction_id=NEW.payment_transaction_id;
    IF v_existing_payment + NEW.allocated_amount > v_payment_amount THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Allocation exceeds payment amount'; END IF;
    SELECT COALESCE(SUM(allocated_amount),0) INTO v_existing_item FROM payment_allocation WHERE assessment_item_id=NEW.assessment_item_id;
    IF v_existing_item + NEW.allocated_amount > v_item_net THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Allocation exceeds assessment item net amount'; END IF;
END$$

CREATE TRIGGER trg_payment_allocation_bu
BEFORE UPDATE ON payment_allocation
FOR EACH ROW
BEGIN
    DECLARE v_payment_amount DECIMAL(12,2);
    DECLARE v_status VARCHAR(30);
    DECLARE v_payment_account BIGINT UNSIGNED;
    DECLARE v_payment_application BIGINT UNSIGNED;
    DECLARE v_item_net DECIMAL(12,2);
    DECLARE v_assessment_account BIGINT UNSIGNED;
    DECLARE v_assessment_application BIGINT UNSIGNED;
    DECLARE v_existing_payment DECIMAL(12,2);
    DECLARE v_existing_item DECIMAL(12,2);
    SELECT amount,payment_status,student_account_id,application_id
      INTO v_payment_amount,v_status,v_payment_account,v_payment_application
      FROM payment_transaction WHERE payment_transaction_id=NEW.payment_transaction_id FOR UPDATE;
    IF v_status <> 'SUCCESS' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Only SUCCESS payments can be allocated'; END IF;
    SELECT i.net_amount,a.student_account_id,a.application_id
      INTO v_item_net,v_assessment_account,v_assessment_application
      FROM student_fee_assessment_item i JOIN student_fee_assessment a ON a.fee_assessment_id=i.fee_assessment_id
      WHERE i.assessment_item_id=NEW.assessment_item_id FOR UPDATE;
    IF NOT ((v_payment_account IS NOT NULL AND v_payment_account <=> v_assessment_account)
            OR (v_payment_application IS NOT NULL AND v_payment_application <=> v_assessment_application)) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Payment and assessment contexts do not match';
    END IF;
    SELECT COALESCE(SUM(allocated_amount),0) INTO v_existing_payment FROM payment_allocation WHERE payment_transaction_id=NEW.payment_transaction_id AND payment_allocation_id<>OLD.payment_allocation_id;
    IF v_existing_payment + NEW.allocated_amount > v_payment_amount THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Allocation exceeds payment amount'; END IF;
    SELECT COALESCE(SUM(allocated_amount),0) INTO v_existing_item FROM payment_allocation WHERE assessment_item_id=NEW.assessment_item_id AND payment_allocation_id<>OLD.payment_allocation_id;
    IF v_existing_item + NEW.allocated_amount > v_item_net THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Allocation exceeds assessment item net amount'; END IF;
END$$

CREATE TRIGGER trg_payment_allocation_ai
AFTER INSERT ON payment_allocation
FOR EACH ROW
BEGIN
    UPDATE student_fee_assessment_item i
    SET amount_paid=(SELECT COALESCE(SUM(pa.allocated_amount),0) FROM payment_allocation pa WHERE pa.assessment_item_id=NEW.assessment_item_id),
        balance_amount=net_amount-(SELECT COALESCE(SUM(pa.allocated_amount),0) FROM payment_allocation pa WHERE pa.assessment_item_id=NEW.assessment_item_id)
    WHERE i.assessment_item_id=NEW.assessment_item_id;
END$$

CREATE TRIGGER trg_payment_allocation_au
AFTER UPDATE ON payment_allocation
FOR EACH ROW
BEGIN
    UPDATE student_fee_assessment_item i
    SET amount_paid=(SELECT COALESCE(SUM(pa.allocated_amount),0) FROM payment_allocation pa WHERE pa.assessment_item_id=NEW.assessment_item_id),
        balance_amount=net_amount-(SELECT COALESCE(SUM(pa.allocated_amount),0) FROM payment_allocation pa WHERE pa.assessment_item_id=NEW.assessment_item_id)
    WHERE i.assessment_item_id=NEW.assessment_item_id;
    IF OLD.assessment_item_id <> NEW.assessment_item_id THEN
        UPDATE student_fee_assessment_item i
        SET amount_paid=(SELECT COALESCE(SUM(pa.allocated_amount),0) FROM payment_allocation pa WHERE pa.assessment_item_id=OLD.assessment_item_id),
            balance_amount=net_amount-(SELECT COALESCE(SUM(pa.allocated_amount),0) FROM payment_allocation pa WHERE pa.assessment_item_id=OLD.assessment_item_id)
        WHERE i.assessment_item_id=OLD.assessment_item_id;
    END IF;
END$$

CREATE TRIGGER trg_payment_allocation_ad
AFTER DELETE ON payment_allocation
FOR EACH ROW
BEGIN
    UPDATE student_fee_assessment_item i
    SET amount_paid=(SELECT COALESCE(SUM(pa.allocated_amount),0) FROM payment_allocation pa WHERE pa.assessment_item_id=OLD.assessment_item_id),
        balance_amount=net_amount-(SELECT COALESCE(SUM(pa.allocated_amount),0) FROM payment_allocation pa WHERE pa.assessment_item_id=OLD.assessment_item_id)
    WHERE i.assessment_item_id=OLD.assessment_item_id;
END$$

-- Benefit totals cannot exceed the original assessed item amount.
CREATE TRIGGER trg_fee_benefit_bi
BEFORE INSERT ON fee_assessment_benefit
FOR EACH ROW
BEGIN
    DECLARE v_original DECIMAL(12,2);
    DECLARE v_existing DECIMAL(12,2);
    SELECT original_amount INTO v_original FROM student_fee_assessment_item WHERE assessment_item_id=NEW.assessment_item_id FOR UPDATE;
    SELECT COALESCE(SUM(benefit_amount),0) INTO v_existing FROM fee_assessment_benefit WHERE assessment_item_id=NEW.assessment_item_id;
    IF v_existing + NEW.benefit_amount > v_original THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Benefits exceed original assessment item amount'; END IF;
END$$

CREATE TRIGGER trg_fee_benefit_bu
BEFORE UPDATE ON fee_assessment_benefit
FOR EACH ROW
BEGIN
    DECLARE v_original DECIMAL(12,2);
    DECLARE v_existing DECIMAL(12,2);
    SELECT original_amount INTO v_original FROM student_fee_assessment_item WHERE assessment_item_id=NEW.assessment_item_id FOR UPDATE;
    SELECT COALESCE(SUM(benefit_amount),0) INTO v_existing FROM fee_assessment_benefit WHERE assessment_item_id=NEW.assessment_item_id AND assessment_benefit_id<>OLD.assessment_benefit_id;
    IF v_existing + NEW.benefit_amount > v_original THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Benefits exceed original assessment item amount'; END IF;
END$$

-- Refund processing cannot exceed request approval or the original payment amount.
CREATE TRIGGER trg_fee_refund_bi
BEFORE INSERT ON fee_refund
FOR EACH ROW
BEGIN
    DECLARE v_approved DECIMAL(12,2);
    DECLARE v_request_status VARCHAR(30);
    DECLARE v_payment_id BIGINT UNSIGNED;
    DECLARE v_payment_amount DECIMAL(12,2);
    DECLARE v_request_refunded DECIMAL(12,2);
    DECLARE v_payment_refunded DECIMAL(12,2);
    SELECT approved_amount,request_status,payment_transaction_id INTO v_approved,v_request_status,v_payment_id
      FROM refund_request WHERE refund_request_id=NEW.refund_request_id FOR UPDATE;
    IF v_approved IS NULL OR v_request_status NOT IN ('APPROVED','PROCESSED') THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Refund request must be approved'; END IF;
    SELECT COALESCE(SUM(refund_amount),0) INTO v_request_refunded FROM fee_refund WHERE refund_request_id=NEW.refund_request_id AND refund_status='SUCCESS';
    IF NEW.refund_status='SUCCESS' AND v_request_refunded + NEW.refund_amount > v_approved THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Refund exceeds approved amount'; END IF;
    IF v_payment_id IS NOT NULL AND NEW.refund_status='SUCCESS' THEN
        SELECT amount INTO v_payment_amount FROM payment_transaction WHERE payment_transaction_id=v_payment_id FOR UPDATE;
        SELECT COALESCE(SUM(fr.refund_amount),0) INTO v_payment_refunded
          FROM fee_refund fr JOIN refund_request rr ON rr.refund_request_id=fr.refund_request_id
          WHERE rr.payment_transaction_id=v_payment_id AND fr.refund_status='SUCCESS';
        IF v_payment_refunded + NEW.refund_amount > v_payment_amount THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Cumulative refund exceeds payment amount'; END IF;
    END IF;
END$$

CREATE TRIGGER trg_fee_refund_bu
BEFORE UPDATE ON fee_refund
FOR EACH ROW
BEGIN
    DECLARE v_approved DECIMAL(12,2);
    DECLARE v_request_status VARCHAR(30);
    DECLARE v_payment_id BIGINT UNSIGNED;
    DECLARE v_payment_amount DECIMAL(12,2);
    DECLARE v_request_refunded DECIMAL(12,2);
    DECLARE v_payment_refunded DECIMAL(12,2);
    SELECT approved_amount,request_status,payment_transaction_id INTO v_approved,v_request_status,v_payment_id
      FROM refund_request WHERE refund_request_id=NEW.refund_request_id FOR UPDATE;
    IF v_approved IS NULL OR v_request_status NOT IN ('APPROVED','PROCESSED') THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Refund request must be approved'; END IF;
    SELECT COALESCE(SUM(refund_amount),0) INTO v_request_refunded FROM fee_refund WHERE refund_request_id=NEW.refund_request_id AND refund_status='SUCCESS' AND fee_refund_id<>OLD.fee_refund_id;
    IF NEW.refund_status='SUCCESS' AND v_request_refunded + NEW.refund_amount > v_approved THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Refund exceeds approved amount'; END IF;
    IF v_payment_id IS NOT NULL AND NEW.refund_status='SUCCESS' THEN
        SELECT amount INTO v_payment_amount FROM payment_transaction WHERE payment_transaction_id=v_payment_id FOR UPDATE;
        SELECT COALESCE(SUM(fr.refund_amount),0) INTO v_payment_refunded
          FROM fee_refund fr JOIN refund_request rr ON rr.refund_request_id=fr.refund_request_id
          WHERE rr.payment_transaction_id=v_payment_id AND fr.refund_status='SUCCESS' AND fr.fee_refund_id<>OLD.fee_refund_id;
        IF v_payment_refunded + NEW.refund_amount > v_payment_amount THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Cumulative refund exceeds payment amount'; END IF;
    END IF;
END$$

DELIMITER ;

-- =============================================================
-- 18. PERFORMANCE INDEXES
-- =============================================================
CREATE INDEX idx_student_name ON student(last_name, first_name);
CREATE INDEX idx_employee_name ON employee(last_name, first_name);
CREATE INDEX idx_admission_applicant_name ON admission_applicant(last_name, first_name);
CREATE INDEX idx_student_status ON student(student_status);
CREATE INDEX idx_employee_status ON employee(employment_status);
CREATE INDEX idx_employee_institution_source ON employee(institution_id, employment_source_id, employment_status);
CREATE INDEX idx_employee_external_agency ON employee(external_agency_id, employment_status);
CREATE INDEX idx_employee_assignment_location ON employee_assignment(campus_id, department_id, designation_id, is_primary);
CREATE INDEX idx_staff_category_type ON staff_category(staff_type_id, is_active);
CREATE INDEX idx_designation_category ON designation(staff_category_id, is_active);
CREATE INDEX idx_external_agency_institution ON external_agency(institution_id, is_active);
CREATE INDEX idx_application_status ON admission_application(application_status, academic_year_id);
CREATE INDEX idx_enrolment_status ON student_programme_enrolment(enrolment_status);
CREATE INDEX idx_term_registration_section ON student_term_registration(class_section_id, registration_status);
CREATE INDEX idx_course_registration_status ON student_course_registration(course_offering_id, registration_status);
CREATE INDEX idx_class_session_date ON class_session(session_date, course_offering_section_id);
CREATE INDEX idx_student_attendance_roster ON student_attendance(course_offering_section_student_id, attendance_status_id);
CREATE INDEX idx_assessment_event_date ON assessment_event(assessment_date);
CREATE INDEX idx_course_result_status ON student_course_result(result_status);
CREATE INDEX idx_grievance_status ON grievance(status, priority, submitted_at);
CREATE INDEX idx_announcement_publish ON announcement(approval_status, publish_from, publish_to);
CREATE INDEX idx_activity_audit_entity ON activity_audit(entity_name, entity_id, activity_at);
CREATE INDEX idx_user_account_status ON user_account(account_status, username);
CREATE INDEX idx_user_role_active ON user_role_assignment(user_id, assignment_status, valid_from, valid_to);
CREATE INDEX idx_user_role_scope ON user_role_assignment(scope_type, scope_entity_id);
CREATE INDEX idx_role_permission_effect ON role_permission(role_id, permission_effect);
CREATE INDEX idx_permission_lookup ON permission(access_resource_id, access_action_id, is_active);
CREATE INDEX idx_login_audit_user_time ON login_audit(user_id, login_at);
CREATE INDEX idx_password_history_user_time ON password_history(user_id, changed_at);

CREATE INDEX idx_fee_structure_scope ON fee_structure(academic_year_id, programme_id, admission_category_id, approval_status);
CREATE INDEX idx_fee_assessment_account_status ON student_fee_assessment(student_account_id, assessment_status, due_date);
CREATE INDEX idx_fee_assessment_year_term ON student_fee_assessment(academic_year_id, academic_term_id, assessment_type);
CREATE INDEX idx_fee_item_balance ON student_fee_assessment_item(item_status, due_date, balance_amount);
CREATE INDEX idx_payment_account_date ON payment_transaction(student_account_id, transaction_date);
CREATE INDEX idx_payment_gateway_reference ON payment_transaction(gateway_transaction_id);
CREATE INDEX idx_payment_status_date ON payment_transaction(payment_status, transaction_date);
CREATE INDEX idx_payment_allocation_item ON payment_allocation(assessment_item_id);
CREATE INDEX idx_receipt_date_status ON fee_receipt(receipt_date, receipt_status);
CREATE INDEX idx_concession_student_year ON student_fee_concession(student_id, academic_year_id, approval_status);
CREATE INDEX idx_scholarship_student_year ON student_scholarship(student_id, academic_year_id, application_status);
CREATE INDEX idx_refund_status_date ON refund_request(request_status, request_date);
CREATE INDEX idx_fee_audit_entity ON fee_activity_audit(entity_name, entity_id, performed_at);

-- New employee HR/security indexes.
CREATE INDEX idx_education_institution_lookup ON education_institution(institution_name, city, country_id, is_active);
CREATE INDEX idx_awarding_body_lookup ON awarding_body(awarding_body_name, university_type, country_id, is_active);
CREATE INDEX idx_employee_qualification_employee ON employee_qualification(employee_id, qualification_level_id, qualification_status, deleted_at);
CREATE INDEX idx_employee_qualification_passing ON employee_qualification(passing_year, is_highest_qualification);
CREATE INDEX idx_previous_organization_lookup ON previous_organization(organization_name, previous_organization_type_id, city, country_id);
CREATE INDEX idx_employee_previous_employment_employee ON employee_previous_employment(employee_id, employment_start_date, employment_end_date, deleted_at);
CREATE INDEX idx_employee_bank_employee_status ON employee_bank_account(employee_id, account_status, verification_status, is_primary, deleted_at);
CREATE INDEX idx_employee_bank_ifsc ON employee_bank_account(ifsc_code, bank_name);
CREATE INDEX idx_employee_pan_status ON employee_pan(employee_id, verification_status, deleted_at);
CREATE INDEX idx_employee_aadhaar_status ON employee_aadhaar(employee_id, verification_status, deleted_at);
CREATE INDEX idx_employee_document_owner_scope ON employee_document(employee_id, document_scope, is_active, deleted_at);
CREATE INDEX idx_employee_document_qualification ON employee_document(employee_qualification_id, verification_status, approval_status);
CREATE INDEX idx_employee_document_experience ON employee_document(employee_previous_employment_id, verification_status, approval_status);
CREATE INDEX idx_employee_document_bank ON employee_document(employee_bank_account_id, verification_status, approval_status);
CREATE INDEX idx_employee_document_pan ON employee_document(employee_pan_id, verification_status, approval_status);
CREATE INDEX idx_employee_document_aadhaar ON employee_document(employee_aadhaar_id, verification_status, approval_status);
CREATE INDEX idx_employee_document_category_type ON employee_document(employee_document_category_id, document_type_id, confidentiality_level);
CREATE INDEX idx_employee_document_file ON employee_document(file_object_id);
CREATE INDEX idx_employee_document_access_role ON employee_document_access_rule(role_id, valid_from, valid_to);
CREATE INDEX idx_employee_document_access_user ON employee_document_access_rule(user_id, valid_from, valid_to);
CREATE INDEX idx_employee_sensitive_audit_employee ON employee_sensitive_access_audit(employee_id, entity_type, accessed_at);
CREATE INDEX idx_employee_sensitive_audit_user ON employee_sensitive_access_audit(user_id, accessed_at);
CREATE INDEX idx_file_object_confidentiality ON file_object(confidentiality_level, is_encrypted, deleted_at);

-- Staff academic/research/evidence extension follows before FK checks are restored.

-- =============================================================
-- END OF SIMS V6 CORRECTED / ENFORCED SCHEMA
-- University + Academic + HR + RBAC + Unified Financial Integrity
-- =============================================================


-- =============================================================
-- 19+. STAFF ACADEMIC / RESEARCH / EVIDENCE EXTENSION (CONSOLIDATED)
-- =============================================================
-- =============================================================
-- SIMS V6 EXTENSION
-- STAFF ACADEMIC, RESEARCH, PROFESSIONAL DEVELOPMENT,
-- INDUSTRY, CO-CURRICULAR, EXTRA-CURRICULAR PROFILE
-- AND CENTRALIZED EVIDENCE MANAGEMENT
-- MySQL 8.0+
--
-- Baseline:
--   sims_v6_independent_student_staff_full_schema.sql
--
-- This module is integrated into this full schema. It preserves the independent
-- student and employee root entities while extending the Staff module.
-- Existing organizational hierarchy:
--   university -> institution -> campus -> department
-- Existing independent staff root entity:
--   employee (no generic person inheritance)
-- =============================================================

-- Integrated full-schema section; database selection and character set are controlled at the top of this file.
-- Foreign key checks are controlled by the consolidated schema.

-- =============================================================
-- 18. EXTEND EXISTING FILE STORAGE METADATA
-- =============================================================

ALTER TABLE file_object
    ADD COLUMN stored_file_name VARCHAR(255) NULL AFTER original_file_name,
    ADD COLUMN file_extension VARCHAR(20) NULL AFTER stored_file_name,
    ADD COLUMN storage_url VARCHAR(1000) NULL AFTER storage_key,
    ADD COLUMN is_encrypted BOOLEAN NOT NULL DEFAULT FALSE AFTER checksum_sha256,
    ADD COLUMN encryption_key_reference VARCHAR(255) NULL AFTER is_encrypted,
    ADD COLUMN virus_scan_status ENUM('NOT_SCANNED','PENDING','CLEAN','INFECTED','ERROR')
        NOT NULL DEFAULT 'NOT_SCANNED' AFTER encryption_key_reference,
    ADD COLUMN virus_scanned_at DATETIME NULL AFTER virus_scan_status;

-- =============================================================
-- 19. STAFF PROFILE REFERENCE / MASTER DATA
-- =============================================================

CREATE TABLE publication_type (
    publication_type_id SMALLINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    publication_type_code VARCHAR(40) NOT NULL UNIQUE,
    publication_type_name VARCHAR(120) NOT NULL UNIQUE,
    description VARCHAR(500) NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE journal_type (
    journal_type_id TINYINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    journal_type_code VARCHAR(30) NOT NULL UNIQUE,
    journal_type_name VARCHAR(80) NOT NULL UNIQUE,
    description VARCHAR(300) NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE indexing_agency (
    indexing_agency_id SMALLINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    agency_code VARCHAR(40) NOT NULL UNIQUE,
    agency_name VARCHAR(150) NOT NULL UNIQUE,
    website_url VARCHAR(500) NULL,
    description VARCHAR(500) NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE metric_type (
    metric_type_id TINYINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    metric_code VARCHAR(30) NOT NULL UNIQUE,
    metric_name VARCHAR(100) NOT NULL UNIQUE,
    description VARCHAR(300) NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE organization_type (
    organization_type_id SMALLINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    organization_type_code VARCHAR(40) NOT NULL UNIQUE,
    organization_type_name VARCHAR(120) NOT NULL UNIQUE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE external_organization (
    organization_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    organization_code VARCHAR(60) NULL UNIQUE,
    organization_name VARCHAR(250) NOT NULL,
    short_name VARCHAR(100) NULL,
    website_url VARCHAR(500) NULL,
    email VARCHAR(254) NULL,
    phone VARCHAR(30) NULL,
    address_line_1 VARCHAR(250) NULL,
    address_line_2 VARCHAR(250) NULL,
    city VARCHAR(120) NULL,
    state_id SMALLINT UNSIGNED NULL,
    country_id SMALLINT UNSIGNED NULL,
    postal_code VARCHAR(20) NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT uq_external_organization_name UNIQUE (organization_name, city, country_id),
    CONSTRAINT fk_external_organization_state FOREIGN KEY (state_id) REFERENCES state(state_id),
    CONSTRAINT fk_external_organization_country FOREIGN KEY (country_id) REFERENCES country(country_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE external_organization_type (
    organization_id BIGINT UNSIGNED NOT NULL,
    organization_type_id SMALLINT UNSIGNED NOT NULL,
    PRIMARY KEY (organization_id, organization_type_id),
    CONSTRAINT fk_external_org_type_org FOREIGN KEY (organization_id)
        REFERENCES external_organization(organization_id),
    CONSTRAINT fk_external_org_type_type FOREIGN KEY (organization_type_id)
        REFERENCES organization_type(organization_type_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Role-specific reusable organization masters requested by the design.
CREATE TABLE organizer (
    organizer_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    organization_id BIGINT UNSIGNED NOT NULL UNIQUE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    CONSTRAINT fk_organizer_organization FOREIGN KEY (organization_id)
        REFERENCES external_organization(organization_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE publisher (
    publisher_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    organization_id BIGINT UNSIGNED NOT NULL UNIQUE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    CONSTRAINT fk_publisher_organization FOREIGN KEY (organization_id)
        REFERENCES external_organization(organization_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE funding_type (
    funding_type_id TINYINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    funding_type_code VARCHAR(30) NOT NULL UNIQUE,
    funding_type_name VARCHAR(100) NOT NULL UNIQUE,
    is_external BOOLEAN NOT NULL DEFAULT FALSE,
    description VARCHAR(300) NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE funding_agency (
    funding_agency_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    organization_id BIGINT UNSIGNED NOT NULL UNIQUE,
    funding_type_id TINYINT UNSIGNED NOT NULL,
    agency_category VARCHAR(100) NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    CONSTRAINT fk_funding_agency_org FOREIGN KEY (organization_id)
        REFERENCES external_organization(organization_id),
    CONSTRAINT fk_funding_agency_type FOREIGN KEY (funding_type_id)
        REFERENCES funding_type(funding_type_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE activity_type (
    activity_type_id SMALLINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    activity_type_code VARCHAR(50) NOT NULL UNIQUE,
    activity_type_name VARCHAR(150) NOT NULL UNIQUE,
    activity_group ENUM(
        'PUBLICATION','CONFERENCE','PROFESSIONAL_DEVELOPMENT','INTERNSHIP',
        'RESEARCH','CONSULTANCY','CO_CURRICULAR','EXTRA_CURRICULAR',
        'AWARD','MEMBERSHIP','ACADEMIC_PROFESSIONAL_CONTRIBUTION','OTHER'
    ) NOT NULL,
    description VARCHAR(500) NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE participation_level (
    participation_level_id TINYINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    level_code VARCHAR(30) NOT NULL UNIQUE,
    level_name VARCHAR(100) NOT NULL UNIQUE,
    display_order TINYINT UNSIGNED NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT TRUE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE role_type (
    role_type_id SMALLINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    role_code VARCHAR(50) NOT NULL UNIQUE,
    role_name VARCHAR(150) NOT NULL UNIQUE,
    description VARCHAR(500) NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE research_status (
    research_status_id TINYINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    status_code VARCHAR(30) NOT NULL UNIQUE,
    status_name VARCHAR(100) NOT NULL UNIQUE,
    display_order TINYINT UNSIGNED NOT NULL DEFAULT 0,
    is_terminal BOOLEAN NOT NULL DEFAULT FALSE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE event_mode (
    event_mode_id TINYINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    mode_code VARCHAR(20) NOT NULL UNIQUE,
    mode_name VARCHAR(60) NOT NULL UNIQUE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE evidence_type (
    evidence_type_id SMALLINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    evidence_type_code VARCHAR(60) NOT NULL UNIQUE,
    evidence_type_name VARCHAR(180) NOT NULL UNIQUE,
    description VARCHAR(500) NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE verification_status (
    verification_status_id TINYINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    status_code VARCHAR(30) NOT NULL UNIQUE,
    status_name VARCHAR(80) NOT NULL UNIQUE,
    is_terminal BOOLEAN NOT NULL DEFAULT FALSE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE approval_status (
    approval_status_id TINYINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    status_code VARCHAR(30) NOT NULL UNIQUE,
    status_name VARCHAR(80) NOT NULL UNIQUE,
    is_terminal BOOLEAN NOT NULL DEFAULT FALSE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE training_program_type (
    training_program_type_id SMALLINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    type_code VARCHAR(40) NOT NULL UNIQUE,
    type_name VARCHAR(120) NOT NULL UNIQUE,
    description VARCHAR(500) NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE conference_contribution_type (
    conference_contribution_type_id TINYINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    type_code VARCHAR(40) NOT NULL UNIQUE,
    type_name VARCHAR(120) NOT NULL UNIQUE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE industry_sector (
    industry_sector_id SMALLINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    sector_code VARCHAR(50) NOT NULL UNIQUE,
    sector_name VARCHAR(150) NOT NULL UNIQUE,
    description VARCHAR(500) NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE cocurricular_category (
    cocurricular_category_id SMALLINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    category_code VARCHAR(50) NOT NULL UNIQUE,
    category_name VARCHAR(150) NOT NULL UNIQUE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE extracurricular_category (
    extracurricular_category_id SMALLINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    category_code VARCHAR(50) NOT NULL UNIQUE,
    category_name VARCHAR(150) NOT NULL UNIQUE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE award_category (
    award_category_id SMALLINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    category_code VARCHAR(50) NOT NULL UNIQUE,
    category_name VARCHAR(150) NOT NULL UNIQUE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE membership_type (
    membership_type_id SMALLINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    type_code VARCHAR(50) NOT NULL UNIQUE,
    type_name VARCHAR(150) NOT NULL UNIQUE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE professional_contribution_type (
    professional_contribution_type_id SMALLINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    contribution_code VARCHAR(60) NOT NULL UNIQUE,
    contribution_name VARCHAR(180) NOT NULL UNIQUE,
    description VARCHAR(500) NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE confidentiality_level (
    confidentiality_level_id TINYINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    level_code VARCHAR(30) NOT NULL UNIQUE,
    level_name VARCHAR(80) NOT NULL UNIQUE,
    display_order TINYINT UNSIGNED NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT TRUE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- =============================================================
-- 20. STAFF ACTIVITY SUPERTYPE
-- Every specialized staff profile record has exactly one parent activity.
-- =============================================================

CREATE TABLE staff_activity (
    staff_activity_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    employee_id BIGINT UNSIGNED NOT NULL,
    activity_type_id SMALLINT UNSIGNED NOT NULL,
    academic_year_id SMALLINT UNSIGNED NULL,
    institution_id SMALLINT UNSIGNED NOT NULL,
    campus_id SMALLINT UNSIGNED NULL,
    department_id SMALLINT UNSIGNED NULL,
    participation_level_id TINYINT UNSIGNED NULL,
    primary_role_type_id SMALLINT UNSIGNED NULL,
    activity_title VARCHAR(500) NOT NULL,
    start_date DATE NULL,
    end_date DATE NULL,
    description TEXT NULL,
    outcomes TEXT NULL,
    remarks TEXT NULL,

    verification_status_id TINYINT UNSIGNED NOT NULL,
    verified_by_user_id BIGINT UNSIGNED NULL,
    verified_at DATETIME NULL,
    verification_remarks VARCHAR(1000) NULL,

    approval_status_id TINYINT UNSIGNED NOT NULL,
    approved_by_user_id BIGINT UNSIGNED NULL,
    approved_at DATETIME NULL,
    approval_remarks VARCHAR(1000) NULL,
    rejection_reason VARCHAR(1000) NULL,

    created_by_user_id BIGINT UNSIGNED NULL,
    updated_by_user_id BIGINT UNSIGNED NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    deleted_at DATETIME NULL,
    deleted_by_user_id BIGINT UNSIGNED NULL,
    deletion_reason VARCHAR(1000) NULL,

    CONSTRAINT chk_staff_activity_dates CHECK (
        end_date IS NULL OR start_date IS NULL OR end_date >= start_date
    ),
    CONSTRAINT fk_staff_activity_employee FOREIGN KEY (employee_id) REFERENCES employee(employee_id),
    CONSTRAINT fk_staff_activity_type FOREIGN KEY (activity_type_id) REFERENCES activity_type(activity_type_id),
    CONSTRAINT fk_staff_activity_year FOREIGN KEY (academic_year_id) REFERENCES academic_year(academic_year_id),
    CONSTRAINT fk_staff_activity_institution FOREIGN KEY (institution_id) REFERENCES institution(institution_id),
    CONSTRAINT fk_staff_activity_campus FOREIGN KEY (campus_id) REFERENCES campus(campus_id),
    CONSTRAINT fk_staff_activity_department FOREIGN KEY (department_id) REFERENCES department(department_id),
    CONSTRAINT fk_staff_activity_level FOREIGN KEY (participation_level_id) REFERENCES participation_level(participation_level_id),
    CONSTRAINT fk_staff_activity_role FOREIGN KEY (primary_role_type_id) REFERENCES role_type(role_type_id),
    CONSTRAINT fk_staff_activity_verification_status FOREIGN KEY (verification_status_id)
        REFERENCES verification_status(verification_status_id),
    CONSTRAINT fk_staff_activity_verified_by FOREIGN KEY (verified_by_user_id) REFERENCES user_account(user_id),
    CONSTRAINT fk_staff_activity_approval_status FOREIGN KEY (approval_status_id)
        REFERENCES approval_status(approval_status_id),
    CONSTRAINT fk_staff_activity_approved_by FOREIGN KEY (approved_by_user_id) REFERENCES user_account(user_id),
    CONSTRAINT fk_staff_activity_created_by FOREIGN KEY (created_by_user_id) REFERENCES user_account(user_id),
    CONSTRAINT fk_staff_activity_updated_by FOREIGN KEY (updated_by_user_id) REFERENCES user_account(user_id),
    CONSTRAINT fk_staff_activity_deleted_by FOREIGN KEY (deleted_by_user_id) REFERENCES user_account(user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Internal/external collaborators, co-authors, investigators, consultants,
-- team members and other participants.
CREATE TABLE staff_activity_contributor (
    staff_activity_contributor_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    staff_activity_id BIGINT UNSIGNED NOT NULL,
    employee_id BIGINT UNSIGNED NULL,
    external_person_name VARCHAR(250) NULL,
    external_person_email VARCHAR(254) NULL,
    external_organization_id BIGINT UNSIGNED NULL,
    affiliation_text VARCHAR(500) NULL,
    role_type_id SMALLINT UNSIGNED NULL,
    contributor_sequence SMALLINT UNSIGNED NULL,
    is_corresponding_author BOOLEAN NOT NULL DEFAULT FALSE,
    contribution_details VARCHAR(1000) NULL,
    is_primary BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT chk_staff_activity_contributor_identity CHECK (
        (employee_id IS NOT NULL AND external_person_name IS NULL)
        OR
        (employee_id IS NULL AND external_person_name IS NOT NULL)
    ),
    CONSTRAINT uq_staff_activity_internal_contributor UNIQUE
        (staff_activity_id, employee_id, role_type_id),
    CONSTRAINT fk_staff_activity_contributor_activity FOREIGN KEY (staff_activity_id)
        REFERENCES staff_activity(staff_activity_id),
    CONSTRAINT fk_staff_activity_contributor_employee FOREIGN KEY (employee_id)
        REFERENCES employee(employee_id),
    CONSTRAINT fk_staff_activity_contributor_org FOREIGN KEY (external_organization_id)
        REFERENCES external_organization(organization_id),
    CONSTRAINT fk_staff_activity_contributor_role FOREIGN KEY (role_type_id)
        REFERENCES role_type(role_type_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- =============================================================
-- 21. JOURNALS AND JOURNAL PUBLICATIONS
-- =============================================================

CREATE TABLE journal (
    journal_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    journal_name VARCHAR(300) NOT NULL,
    journal_type_id TINYINT UNSIGNED NOT NULL,
    publisher_id BIGINT UNSIGNED NULL,
    issn VARCHAR(20) NULL,
    eissn VARCHAR(20) NULL,
    website_url VARCHAR(500) NULL,
    country_id SMALLINT UNSIGNED NULL,
    is_peer_reviewed_default BOOLEAN NULL,
    is_open_access_default BOOLEAN NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    CONSTRAINT uq_journal_issn UNIQUE (issn),
    CONSTRAINT uq_journal_eissn UNIQUE (eissn),
    CONSTRAINT fk_journal_type FOREIGN KEY (journal_type_id) REFERENCES journal_type(journal_type_id),
    CONSTRAINT fk_journal_publisher FOREIGN KEY (publisher_id) REFERENCES publisher(publisher_id),
    CONSTRAINT fk_journal_country FOREIGN KEY (country_id) REFERENCES country(country_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE journal_publication (
    staff_activity_id BIGINT UNSIGNED PRIMARY KEY,
    publication_type_id SMALLINT UNSIGNED NOT NULL,
    journal_id BIGINT UNSIGNED NOT NULL,
    paper_title VARCHAR(500) NOT NULL,
    volume_number VARCHAR(50) NULL,
    issue_number VARCHAR(50) NULL,
    edition VARCHAR(100) NULL,
    page_from VARCHAR(30) NULL,
    page_to VARCHAR(30) NULL,
    article_number VARCHAR(60) NULL,
    publication_date DATE NULL,
    publication_year YEAR NOT NULL,
    doi VARCHAR(255) NULL,
    url VARCHAR(1000) NULL,
    peer_reviewed BOOLEAN NOT NULL DEFAULT FALSE,
    open_access BOOLEAN NOT NULL DEFAULT FALSE,
    primary_author_position SMALLINT UNSIGNED NULL,
    primary_staff_corresponding_author BOOLEAN NOT NULL DEFAULT FALSE,
    affiliation_text VARCHAR(500) NULL,
    abstract_text TEXT NULL,
    keywords TEXT NULL,

    CONSTRAINT uq_journal_publication_doi UNIQUE (doi),
    CONSTRAINT fk_journal_publication_activity FOREIGN KEY (staff_activity_id)
        REFERENCES staff_activity(staff_activity_id),
    CONSTRAINT fk_journal_publication_type FOREIGN KEY (publication_type_id)
        REFERENCES publication_type(publication_type_id),
    CONSTRAINT fk_journal_publication_journal FOREIGN KEY (journal_id)
        REFERENCES journal(journal_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE journal_publication_indexing (
    staff_activity_id BIGINT UNSIGNED NOT NULL,
    indexing_agency_id SMALLINT UNSIGNED NOT NULL,
    indexed_year YEAR NULL,
    indexing_status ENUM('CLAIMED','VERIFIED','DISCONTINUED','NOT_INDEXED') NOT NULL DEFAULT 'CLAIMED',
    source_url VARCHAR(1000) NULL,
    remarks VARCHAR(500) NULL,
    PRIMARY KEY (staff_activity_id, indexing_agency_id),
    CONSTRAINT fk_journal_indexing_publication FOREIGN KEY (staff_activity_id)
        REFERENCES journal_publication(staff_activity_id),
    CONSTRAINT fk_journal_indexing_agency FOREIGN KEY (indexing_agency_id)
        REFERENCES indexing_agency(indexing_agency_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE journal_metric (
    journal_metric_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    journal_id BIGINT UNSIGNED NOT NULL,
    metric_type_id TINYINT UNSIGNED NOT NULL,
    metric_year YEAR NOT NULL,
    metric_value DECIMAL(12,4) NOT NULL,
    quartile VARCHAR(10) NULL,
    source_name VARCHAR(150) NULL,
    source_url VARCHAR(1000) NULL,
    verified_at DATETIME NULL,
    CONSTRAINT uq_journal_metric UNIQUE (journal_id, metric_type_id, metric_year),
    CONSTRAINT chk_journal_metric_value CHECK (metric_value >= 0),
    CONSTRAINT fk_journal_metric_journal FOREIGN KEY (journal_id) REFERENCES journal(journal_id),
    CONSTRAINT fk_journal_metric_type FOREIGN KEY (metric_type_id) REFERENCES metric_type(metric_type_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- =============================================================
-- 22. CONFERENCES, PUBLICATIONS AND PRESENTATIONS
-- =============================================================

CREATE TABLE conference_event (
    conference_event_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    conference_title VARCHAR(500) NOT NULL,
    conference_edition VARCHAR(100) NULL,
    organizer_id BIGINT UNSIGNED NULL,
    sponsoring_organization_id BIGINT UNSIGNED NULL,
    proceedings_publisher_id BIGINT UNSIGNED NULL,
    participation_level_id TINYINT UNSIGNED NULL,
    event_mode_id TINYINT UNSIGNED NULL,
    venue_name VARCHAR(250) NULL,
    city VARCHAR(120) NULL,
    state_id SMALLINT UNSIGNED NULL,
    country_id SMALLINT UNSIGNED NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    conference_website VARCHAR(1000) NULL,
    brochure_url VARCHAR(1000) NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    CONSTRAINT chk_conference_event_dates CHECK (end_date >= start_date),
    CONSTRAINT fk_conference_event_organizer FOREIGN KEY (organizer_id) REFERENCES organizer(organizer_id),
    CONSTRAINT fk_conference_event_sponsor FOREIGN KEY (sponsoring_organization_id)
        REFERENCES external_organization(organization_id),
    CONSTRAINT fk_conference_event_publisher FOREIGN KEY (proceedings_publisher_id)
        REFERENCES publisher(publisher_id),
    CONSTRAINT fk_conference_event_level FOREIGN KEY (participation_level_id)
        REFERENCES participation_level(participation_level_id),
    CONSTRAINT fk_conference_event_mode FOREIGN KEY (event_mode_id) REFERENCES event_mode(event_mode_id),
    CONSTRAINT fk_conference_event_state FOREIGN KEY (state_id) REFERENCES state(state_id),
    CONSTRAINT fk_conference_event_country FOREIGN KEY (country_id) REFERENCES country(country_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE conference_activity (
    staff_activity_id BIGINT UNSIGNED PRIMARY KEY,
    conference_event_id BIGINT UNSIGNED NOT NULL,
    conference_contribution_type_id TINYINT UNSIGNED NOT NULL,
    publication_type_id SMALLINT UNSIGNED NULL,
    paper_title VARCHAR(500) NULL,
    abstract_text TEXT NULL,
    proceedings_title VARCHAR(500) NULL,
    proceedings_volume VARCHAR(100) NULL,
    proceedings_issue VARCHAR(100) NULL,
    page_from VARCHAR(30) NULL,
    page_to VARCHAR(30) NULL,
    isbn VARCHAR(30) NULL,
    issn VARCHAR(20) NULL,
    doi VARCHAR(255) NULL,
    proceedings_url VARCHAR(1000) NULL,
    presentation_title VARCHAR(500) NULL,
    award_name VARCHAR(250) NULL,
    award_details TEXT NULL,
    award_date DATE NULL,

    CONSTRAINT uq_conference_activity_doi UNIQUE (doi),
    CONSTRAINT fk_conference_activity_parent FOREIGN KEY (staff_activity_id)
        REFERENCES staff_activity(staff_activity_id),
    CONSTRAINT fk_conference_activity_event FOREIGN KEY (conference_event_id)
        REFERENCES conference_event(conference_event_id),
    CONSTRAINT fk_conference_activity_contribution_type FOREIGN KEY (conference_contribution_type_id)
        REFERENCES conference_contribution_type(conference_contribution_type_id),
    CONSTRAINT fk_conference_activity_publication_type FOREIGN KEY (publication_type_id)
        REFERENCES publication_type(publication_type_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE conference_activity_indexing (
    staff_activity_id BIGINT UNSIGNED NOT NULL,
    indexing_agency_id SMALLINT UNSIGNED NOT NULL,
    indexing_status ENUM('CLAIMED','VERIFIED','DISCONTINUED','NOT_INDEXED') NOT NULL DEFAULT 'CLAIMED',
    source_url VARCHAR(1000) NULL,
    remarks VARCHAR(500) NULL,
    PRIMARY KEY (staff_activity_id, indexing_agency_id),
    CONSTRAINT fk_conference_activity_indexing_activity FOREIGN KEY (staff_activity_id)
        REFERENCES conference_activity(staff_activity_id),
    CONSTRAINT fk_conference_activity_indexing_agency FOREIGN KEY (indexing_agency_id)
        REFERENCES indexing_agency(indexing_agency_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- =============================================================
-- 23. WORKSHOP / FDP / STTP / TRAINING / CERTIFICATION
-- =============================================================

CREATE TABLE professional_development_activity (
    staff_activity_id BIGINT UNSIGNED PRIMARY KEY,
    training_program_type_id SMALLINT UNSIGNED NOT NULL,
    program_title VARCHAR(500) NOT NULL,
    organizer_id BIGINT UNSIGNED NULL,
    sponsoring_organization_id BIGINT UNSIGNED NULL,
    funding_agency_id BIGINT UNSIGNED NULL,
    venue_name VARCHAR(250) NULL,
    city VARCHAR(120) NULL,
    state_id SMALLINT UNSIGNED NULL,
    country_id SMALLINT UNSIGNED NULL,
    event_mode_id TINYINT UNSIGNED NULL,
    duration_days DECIMAL(8,2) NULL,
    duration_hours DECIMAL(10,2) NULL,
    financial_support_received BOOLEAN NOT NULL DEFAULT FALSE,
    financial_support_amount DECIMAL(14,2) NULL,
    currency_code CHAR(3) NOT NULL DEFAULT 'INR',
    certificate_number VARCHAR(120) NULL,
    learning_outcomes TEXT NULL,

    CONSTRAINT chk_prof_dev_duration CHECK (
        (duration_days IS NULL OR duration_days >= 0)
        AND (duration_hours IS NULL OR duration_hours >= 0)
    ),
    CONSTRAINT chk_prof_dev_support CHECK (
        financial_support_amount IS NULL OR financial_support_amount >= 0
    ),
    CONSTRAINT fk_prof_dev_activity FOREIGN KEY (staff_activity_id)
        REFERENCES staff_activity(staff_activity_id),
    CONSTRAINT fk_prof_dev_type FOREIGN KEY (training_program_type_id)
        REFERENCES training_program_type(training_program_type_id),
    CONSTRAINT fk_prof_dev_organizer FOREIGN KEY (organizer_id) REFERENCES organizer(organizer_id),
    CONSTRAINT fk_prof_dev_sponsor FOREIGN KEY (sponsoring_organization_id)
        REFERENCES external_organization(organization_id),
    CONSTRAINT fk_prof_dev_funder FOREIGN KEY (funding_agency_id) REFERENCES funding_agency(funding_agency_id),
    CONSTRAINT fk_prof_dev_state FOREIGN KEY (state_id) REFERENCES state(state_id),
    CONSTRAINT fk_prof_dev_country FOREIGN KEY (country_id) REFERENCES country(country_id),
    CONSTRAINT fk_prof_dev_mode FOREIGN KEY (event_mode_id) REFERENCES event_mode(event_mode_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- =============================================================
-- 24. INDUSTRY / FACULTY INTERNSHIP
-- =============================================================

CREATE TABLE faculty_internship (
    staff_activity_id BIGINT UNSIGNED PRIMARY KEY,
    organization_id BIGINT UNSIGNED NOT NULL,
    internship_title VARCHAR(500) NOT NULL,
    internship_domain VARCHAR(250) NULL,
    industry_sector_id SMALLINT UNSIGNED NULL,
    location_text VARCHAR(300) NULL,
    mentor_name VARCHAR(200) NULL,
    mentor_designation VARCHAR(150) NULL,
    mentor_email VARCHAR(254) NULL,
    work_undertaken TEXT NULL,
    technologies_tools TEXT NULL,
    outcomes TEXT NULL,
    stipend_incentive_type ENUM('NONE','STIPEND','INCENTIVE','HONORARIUM','OTHER') NOT NULL DEFAULT 'NONE',
    stipend_incentive_amount DECIMAL(14,2) NULL,
    currency_code CHAR(3) NOT NULL DEFAULT 'INR',
    funding_source VARCHAR(250) NULL,
    mou_reference VARCHAR(150) NULL,
    collaboration_reference VARCHAR(250) NULL,

    CONSTRAINT chk_faculty_internship_amount CHECK (
        stipend_incentive_amount IS NULL OR stipend_incentive_amount >= 0
    ),
    CONSTRAINT fk_faculty_internship_activity FOREIGN KEY (staff_activity_id)
        REFERENCES staff_activity(staff_activity_id),
    CONSTRAINT fk_faculty_internship_org FOREIGN KEY (organization_id)
        REFERENCES external_organization(organization_id),
    CONSTRAINT fk_faculty_internship_sector FOREIGN KEY (industry_sector_id)
        REFERENCES industry_sector(industry_sector_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- =============================================================
-- 25. RESEARCH PROPOSALS
-- =============================================================

CREATE TABLE research_proposal (
    staff_activity_id BIGINT UNSIGNED PRIMARY KEY,
    proposal_title VARCHAR(500) NOT NULL,
    principal_investigator_employee_id BIGINT UNSIGNED NOT NULL,
    department_id SMALLINT UNSIGNED NOT NULL,
    proposal_submission_date DATE NULL,
    funding_agency_id BIGINT UNSIGNED NULL,
    funding_type_id TINYINT UNSIGNED NULL,
    scheme_program_name VARCHAR(300) NULL,
    requested_amount DECIMAL(16,2) NULL,
    currency_code CHAR(3) NOT NULL DEFAULT 'INR',
    research_status_id TINYINT UNSIGNED NOT NULL,
    proposal_reference_number VARCHAR(150) NULL,
    project_objectives TEXT NULL,
    research_domain VARCHAR(300) NULL,
    expected_outcomes TEXT NULL,
    review_comments TEXT NULL,

    CONSTRAINT chk_research_proposal_requested_amount CHECK (
        requested_amount IS NULL OR requested_amount >= 0
    ),
    CONSTRAINT fk_research_proposal_activity FOREIGN KEY (staff_activity_id)
        REFERENCES staff_activity(staff_activity_id),
    CONSTRAINT fk_research_proposal_pi FOREIGN KEY (principal_investigator_employee_id)
        REFERENCES employee(employee_id),
    CONSTRAINT fk_research_proposal_department FOREIGN KEY (department_id)
        REFERENCES department(department_id),
    CONSTRAINT fk_research_proposal_funder FOREIGN KEY (funding_agency_id)
        REFERENCES funding_agency(funding_agency_id),
    CONSTRAINT fk_research_proposal_funding_type FOREIGN KEY (funding_type_id)
        REFERENCES funding_type(funding_type_id),
    CONSTRAINT fk_research_proposal_status FOREIGN KEY (research_status_id)
        REFERENCES research_status(research_status_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- =============================================================
-- 26. FUNDED RESEARCH PROJECTS
-- A funded project may originate from a research proposal.
-- =============================================================

CREATE TABLE funded_research_project (
    staff_activity_id BIGINT UNSIGNED PRIMARY KEY,
    source_proposal_activity_id BIGINT UNSIGNED NULL,
    project_title VARCHAR(500) NOT NULL,
    principal_investigator_employee_id BIGINT UNSIGNED NOT NULL,
    department_id SMALLINT UNSIGNED NOT NULL,
    funding_agency_id BIGINT UNSIGNED NOT NULL,
    funding_type_id TINYINT UNSIGNED NOT NULL,
    scheme_program_name VARCHAR(300) NULL,
    requested_amount DECIMAL(16,2) NULL,
    sanctioned_amount DECIMAL(16,2) NOT NULL,
    amount_received DECIMAL(16,2) NOT NULL DEFAULT 0.00,
    amount_utilized DECIMAL(16,2) NOT NULL DEFAULT 0.00,
    currency_code CHAR(3) NOT NULL DEFAULT 'INR',
    sanction_date DATE NOT NULL,
    sanction_order_number VARCHAR(150) NULL,
    project_start_date DATE NOT NULL,
    project_end_date DATE NULL,
    duration_months SMALLINT UNSIGNED NULL,
    research_status_id TINYINT UNSIGNED NOT NULL,
    project_objectives TEXT NULL,
    research_domain VARCHAR(300) NULL,
    project_outcomes TEXT NULL,
    publications_generated TEXT NULL,
    patents_generated TEXT NULL,
    products_generated TEXT NULL,
    other_outputs TEXT NULL,
    utilization_summary TEXT NULL,
    completion_date DATE NULL,

    CONSTRAINT chk_funded_project_amounts CHECK (
        sanctioned_amount >= 0
        AND amount_received >= 0
        AND amount_utilized >= 0
        AND (requested_amount IS NULL OR requested_amount >= 0)
    ),
    CONSTRAINT chk_funded_project_dates CHECK (
        project_end_date IS NULL OR project_end_date >= project_start_date
    ),
    CONSTRAINT fk_funded_project_activity FOREIGN KEY (staff_activity_id)
        REFERENCES staff_activity(staff_activity_id),
    CONSTRAINT fk_funded_project_proposal FOREIGN KEY (source_proposal_activity_id)
        REFERENCES research_proposal(staff_activity_id),
    CONSTRAINT fk_funded_project_pi FOREIGN KEY (principal_investigator_employee_id)
        REFERENCES employee(employee_id),
    CONSTRAINT fk_funded_project_department FOREIGN KEY (department_id)
        REFERENCES department(department_id),
    CONSTRAINT fk_funded_project_funder FOREIGN KEY (funding_agency_id)
        REFERENCES funding_agency(funding_agency_id),
    CONSTRAINT fk_funded_project_funding_type FOREIGN KEY (funding_type_id)
        REFERENCES funding_type(funding_type_id),
    CONSTRAINT fk_funded_project_status FOREIGN KEY (research_status_id)
        REFERENCES research_status(research_status_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE research_project_financial_utilization (
    utilization_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    staff_activity_id BIGINT UNSIGNED NOT NULL,
    financial_year VARCHAR(9) NULL,
    reporting_period_from DATE NULL,
    reporting_period_to DATE NULL,
    opening_balance DECIMAL(16,2) NOT NULL DEFAULT 0.00,
    amount_received DECIMAL(16,2) NOT NULL DEFAULT 0.00,
    expenditure_amount DECIMAL(16,2) NOT NULL DEFAULT 0.00,
    closing_balance DECIMAL(16,2) NOT NULL DEFAULT 0.00,
    utilization_certificate_number VARCHAR(150) NULL,
    statement_of_expenditure_number VARCHAR(150) NULL,
    remarks TEXT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT chk_project_utilization_amounts CHECK (
        opening_balance >= 0 AND amount_received >= 0
        AND expenditure_amount >= 0 AND closing_balance >= 0
    ),
    CONSTRAINT chk_project_utilization_dates CHECK (
        reporting_period_to IS NULL OR reporting_period_from IS NULL
        OR reporting_period_to >= reporting_period_from
    ),
    CONSTRAINT fk_project_utilization_project FOREIGN KEY (staff_activity_id)
        REFERENCES funded_research_project(staff_activity_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- =============================================================
-- 27. CONSULTANCY / INDUSTRY-SPONSORED PROJECT
-- =============================================================

CREATE TABLE consultancy_project (
    staff_activity_id BIGINT UNSIGNED PRIMARY KEY,
    consultancy_title VARCHAR(500) NOT NULL,
    client_organization_id BIGINT UNSIGNED NOT NULL,
    principal_consultant_employee_id BIGINT UNSIGNED NOT NULL,
    consultancy_type ENUM('CONSULTANCY','INDUSTRY_SPONSORED_PROJECT','TESTING_SERVICE','TRAINING_SERVICE','OTHER')
        NOT NULL DEFAULT 'CONSULTANCY',
    work_order_number VARCHAR(150) NULL,
    agreement_number VARCHAR(150) NULL,
    purchase_order_number VARCHAR(150) NULL,
    project_start_date DATE NOT NULL,
    completion_date DATE NULL,
    consultancy_amount DECIMAL(16,2) NOT NULL DEFAULT 0.00,
    amount_received DECIMAL(16,2) NOT NULL DEFAULT 0.00,
    faculty_incentive_share DECIMAL(16,2) NULL,
    currency_code CHAR(3) NOT NULL DEFAULT 'INR',
    deliverables TEXT NULL,
    status ENUM('PROPOSED','APPROVED','ONGOING','COMPLETED','CANCELLED','CLOSED') NOT NULL DEFAULT 'PROPOSED',
    client_feedback TEXT NULL,

    CONSTRAINT chk_consultancy_dates CHECK (
        completion_date IS NULL OR completion_date >= project_start_date
    ),
    CONSTRAINT chk_consultancy_amounts CHECK (
        consultancy_amount >= 0 AND amount_received >= 0
        AND (faculty_incentive_share IS NULL OR faculty_incentive_share >= 0)
    ),
    CONSTRAINT fk_consultancy_activity FOREIGN KEY (staff_activity_id)
        REFERENCES staff_activity(staff_activity_id),
    CONSTRAINT fk_consultancy_client FOREIGN KEY (client_organization_id)
        REFERENCES external_organization(organization_id),
    CONSTRAINT fk_consultancy_principal FOREIGN KEY (principal_consultant_employee_id)
        REFERENCES employee(employee_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- =============================================================
-- 28. CO-CURRICULAR ACTIVITIES
-- =============================================================

CREATE TABLE cocurricular_activity (
    staff_activity_id BIGINT UNSIGNED PRIMARY KEY,
    cocurricular_category_id SMALLINT UNSIGNED NOT NULL,
    event_name VARCHAR(500) NOT NULL,
    organizer_id BIGINT UNSIGNED NULL,
    institution_organization_id BIGINT UNSIGNED NULL,
    event_date DATE NULL,
    venue_name VARCHAR(250) NULL,
    city VARCHAR(120) NULL,
    state_id SMALLINT UNSIGNED NULL,
    country_id SMALLINT UNSIGNED NULL,
    achievement_award VARCHAR(500) NULL,
    contribution_details TEXT NULL,

    CONSTRAINT fk_cocurricular_activity_parent FOREIGN KEY (staff_activity_id)
        REFERENCES staff_activity(staff_activity_id),
    CONSTRAINT fk_cocurricular_activity_category FOREIGN KEY (cocurricular_category_id)
        REFERENCES cocurricular_category(cocurricular_category_id),
    CONSTRAINT fk_cocurricular_activity_organizer FOREIGN KEY (organizer_id)
        REFERENCES organizer(organizer_id),
    CONSTRAINT fk_cocurricular_activity_org FOREIGN KEY (institution_organization_id)
        REFERENCES external_organization(organization_id),
    CONSTRAINT fk_cocurricular_activity_state FOREIGN KEY (state_id) REFERENCES state(state_id),
    CONSTRAINT fk_cocurricular_activity_country FOREIGN KEY (country_id) REFERENCES country(country_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- =============================================================
-- 29. EXTRA-CURRICULAR ACTIVITIES
-- =============================================================

CREATE TABLE extracurricular_activity (
    staff_activity_id BIGINT UNSIGNED PRIMARY KEY,
    extracurricular_category_id SMALLINT UNSIGNED NOT NULL,
    event_name VARCHAR(500) NOT NULL,
    organizer_id BIGINT UNSIGNED NULL,
    institution_organization_id BIGINT UNSIGNED NULL,
    event_date DATE NULL,
    venue_name VARCHAR(250) NULL,
    city VARCHAR(120) NULL,
    state_id SMALLINT UNSIGNED NULL,
    country_id SMALLINT UNSIGNED NULL,
    award_recognition VARCHAR(500) NULL,
    activity_details TEXT NULL,

    CONSTRAINT fk_extracurricular_activity_parent FOREIGN KEY (staff_activity_id)
        REFERENCES staff_activity(staff_activity_id),
    CONSTRAINT fk_extracurricular_activity_category FOREIGN KEY (extracurricular_category_id)
        REFERENCES extracurricular_category(extracurricular_category_id),
    CONSTRAINT fk_extracurricular_activity_organizer FOREIGN KEY (organizer_id)
        REFERENCES organizer(organizer_id),
    CONSTRAINT fk_extracurricular_activity_org FOREIGN KEY (institution_organization_id)
        REFERENCES external_organization(organization_id),
    CONSTRAINT fk_extracurricular_activity_state FOREIGN KEY (state_id) REFERENCES state(state_id),
    CONSTRAINT fk_extracurricular_activity_country FOREIGN KEY (country_id) REFERENCES country(country_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- =============================================================
-- 30. AWARDS, HONOURS AND RECOGNITIONS
-- =============================================================

CREATE TABLE staff_award (
    staff_activity_id BIGINT UNSIGNED PRIMARY KEY,
    award_category_id SMALLINT UNSIGNED NULL,
    award_name VARCHAR(500) NOT NULL,
    awarding_organization_id BIGINT UNSIGNED NULL,
    award_date DATE NOT NULL,
    citation_details TEXT NULL,
    cash_prize_amount DECIMAL(14,2) NULL,
    incentive_amount DECIMAL(14,2) NULL,
    currency_code CHAR(3) NOT NULL DEFAULT 'INR',
    award_reference_number VARCHAR(150) NULL,

    CONSTRAINT chk_staff_award_amounts CHECK (
        (cash_prize_amount IS NULL OR cash_prize_amount >= 0)
        AND (incentive_amount IS NULL OR incentive_amount >= 0)
    ),
    CONSTRAINT fk_staff_award_activity FOREIGN KEY (staff_activity_id)
        REFERENCES staff_activity(staff_activity_id),
    CONSTRAINT fk_staff_award_category FOREIGN KEY (award_category_id)
        REFERENCES award_category(award_category_id),
    CONSTRAINT fk_staff_award_org FOREIGN KEY (awarding_organization_id)
        REFERENCES external_organization(organization_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- =============================================================
-- 31. PROFESSIONAL MEMBERSHIPS AND ACADEMIC BODIES
-- =============================================================

CREATE TABLE staff_professional_membership (
    staff_activity_id BIGINT UNSIGNED PRIMARY KEY,
    organization_id BIGINT UNSIGNED NOT NULL,
    membership_type_id SMALLINT UNSIGNED NOT NULL,
    membership_number VARCHAR(150) NULL,
    membership_start_date DATE NULL,
    membership_expiry_date DATE NULL,
    is_lifetime_membership BOOLEAN NOT NULL DEFAULT FALSE,
    role_type_id SMALLINT UNSIGNED NULL,
    participation_level_id TINYINT UNSIGNED NULL,
    renewal_required BOOLEAN NOT NULL DEFAULT FALSE,
    membership_status ENUM('ACTIVE','EXPIRED','SUSPENDED','CANCELLED','LIFETIME') NOT NULL DEFAULT 'ACTIVE',

    CONSTRAINT chk_staff_membership_dates CHECK (
        membership_expiry_date IS NULL OR membership_start_date IS NULL
        OR membership_expiry_date >= membership_start_date
    ),
    CONSTRAINT uq_staff_membership_number UNIQUE (organization_id, membership_number),
    CONSTRAINT fk_staff_membership_activity FOREIGN KEY (staff_activity_id)
        REFERENCES staff_activity(staff_activity_id),
    CONSTRAINT fk_staff_membership_org FOREIGN KEY (organization_id)
        REFERENCES external_organization(organization_id),
    CONSTRAINT fk_staff_membership_type FOREIGN KEY (membership_type_id)
        REFERENCES membership_type(membership_type_id),
    CONSTRAINT fk_staff_membership_role FOREIGN KEY (role_type_id)
        REFERENCES role_type(role_type_id),
    CONSTRAINT fk_staff_membership_level FOREIGN KEY (participation_level_id)
        REFERENCES participation_level(participation_level_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- =============================================================
-- 32. ACADEMIC AND PROFESSIONAL CONTRIBUTIONS
-- =============================================================

CREATE TABLE staff_professional_contribution (
    staff_activity_id BIGINT UNSIGNED PRIMARY KEY,
    professional_contribution_type_id SMALLINT UNSIGNED NOT NULL,
    organization_id BIGINT UNSIGNED NULL,
    journal_id BIGINT UNSIGNED NULL,
    conference_event_id BIGINT UNSIGNED NULL,
    programme_id SMALLINT UNSIGNED NULL,
    course_id INT UNSIGNED NULL,
    student_id BIGINT UNSIGNED NULL,
    title_topic VARCHAR(500) NULL,
    appointment_reference_number VARCHAR(150) NULL,
    contribution_date DATE NULL,
    start_date DATE NULL,
    end_date DATE NULL,
    number_of_reviews SMALLINT UNSIGNED NULL,
    number_of_candidates SMALLINT UNSIGNED NULL,
    contribution_details TEXT NULL,
    outcome_details TEXT NULL,

    CONSTRAINT chk_prof_contribution_dates CHECK (
        end_date IS NULL OR start_date IS NULL OR end_date >= start_date
    ),
    CONSTRAINT fk_prof_contribution_activity FOREIGN KEY (staff_activity_id)
        REFERENCES staff_activity(staff_activity_id),
    CONSTRAINT fk_prof_contribution_type FOREIGN KEY (professional_contribution_type_id)
        REFERENCES professional_contribution_type(professional_contribution_type_id),
    CONSTRAINT fk_prof_contribution_org FOREIGN KEY (organization_id)
        REFERENCES external_organization(organization_id),
    CONSTRAINT fk_prof_contribution_journal FOREIGN KEY (journal_id) REFERENCES journal(journal_id),
    CONSTRAINT fk_prof_contribution_conference FOREIGN KEY (conference_event_id)
        REFERENCES conference_event(conference_event_id),
    CONSTRAINT fk_prof_contribution_programme FOREIGN KEY (programme_id) REFERENCES programme(programme_id),
    CONSTRAINT fk_prof_contribution_course FOREIGN KEY (course_id) REFERENCES course_catalog(course_id),
    CONSTRAINT fk_prof_contribution_student FOREIGN KEY (student_id) REFERENCES student(student_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Research supervision supports PG/PhD supervision with multiple scholars.
CREATE TABLE research_supervision (
    research_supervision_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    staff_activity_id BIGINT UNSIGNED NOT NULL,
    supervision_level ENUM('PG','MPHIL','PHD','POST_DOCTORAL','OTHER') NOT NULL,
    scholar_name VARCHAR(250) NOT NULL,
    student_id BIGINT UNSIGNED NULL,
    registration_number VARCHAR(100) NULL,
    research_title VARCHAR(500) NULL,
    registration_date DATE NULL,
    completion_date DATE NULL,
    supervision_role ENUM('SUPERVISOR','CO_SUPERVISOR','GUIDE','CO_GUIDE','ADVISOR') NOT NULL,
    status ENUM('REGISTERED','ONGOING','SUBMITTED','AWARDED','DISCONTINUED') NOT NULL DEFAULT 'ONGOING',
    awarding_organization_id BIGINT UNSIGNED NULL,

    CONSTRAINT chk_research_supervision_dates CHECK (
        completion_date IS NULL OR registration_date IS NULL OR completion_date >= registration_date
    ),
    CONSTRAINT fk_research_supervision_activity FOREIGN KEY (staff_activity_id)
        REFERENCES staff_professional_contribution(staff_activity_id),
    CONSTRAINT fk_research_supervision_student FOREIGN KEY (student_id) REFERENCES student(student_id),
    CONSTRAINT fk_research_supervision_org FOREIGN KEY (awarding_organization_id)
        REFERENCES external_organization(organization_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- =============================================================
-- 33. CENTRALIZED EVIDENCE / DOCUMENT MANAGEMENT
-- =============================================================

CREATE TABLE evidence_document (
    evidence_document_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    staff_activity_id BIGINT UNSIGNED NOT NULL,
    document_type_id SMALLINT UNSIGNED NOT NULL,
    evidence_type_id SMALLINT UNSIGNED NULL,
    confidentiality_level_id TINYINT UNSIGNED NOT NULL,

    document_title VARCHAR(500) NOT NULL,
    description TEXT NULL,
    academic_year_id SMALLINT UNSIGNED NULL,

    document_issue_date DATE NULL,
    issuing_authority VARCHAR(300) NULL,
    issuing_organization_id BIGINT UNSIGNED NULL,
    certificate_document_number VARCHAR(150) NULL,
    expiry_date DATE NULL,

    verification_status_id TINYINT UNSIGNED NOT NULL,
    verified_by_user_id BIGINT UNSIGNED NULL,
    verified_at DATETIME NULL,
    verification_remarks VARCHAR(1000) NULL,

    approval_status_id TINYINT UNSIGNED NOT NULL,
    approved_by_user_id BIGINT UNSIGNED NULL,
    approved_at DATETIME NULL,
    rejection_reason VARCHAR(1000) NULL,

    current_version_number SMALLINT UNSIGNED NOT NULL DEFAULT 1,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,

    created_by_user_id BIGINT UNSIGNED NOT NULL,
    updated_by_user_id BIGINT UNSIGNED NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    deleted_at DATETIME NULL,
    deleted_by_user_id BIGINT UNSIGNED NULL,
    deletion_reason VARCHAR(1000) NULL,

    CONSTRAINT chk_evidence_document_dates CHECK (
        expiry_date IS NULL OR document_issue_date IS NULL OR expiry_date >= document_issue_date
    ),
    CONSTRAINT chk_evidence_document_version CHECK (current_version_number >= 1),

    CONSTRAINT fk_evidence_document_activity FOREIGN KEY (staff_activity_id)
        REFERENCES staff_activity(staff_activity_id),
    CONSTRAINT fk_evidence_document_document_type FOREIGN KEY (document_type_id)
        REFERENCES document_type(document_type_id),
    CONSTRAINT fk_evidence_document_evidence_type FOREIGN KEY (evidence_type_id)
        REFERENCES evidence_type(evidence_type_id),
    CONSTRAINT fk_evidence_document_confidentiality FOREIGN KEY (confidentiality_level_id)
        REFERENCES confidentiality_level(confidentiality_level_id),
    CONSTRAINT fk_evidence_document_year FOREIGN KEY (academic_year_id)
        REFERENCES academic_year(academic_year_id),
    CONSTRAINT fk_evidence_document_issuing_org FOREIGN KEY (issuing_organization_id)
        REFERENCES external_organization(organization_id),
    CONSTRAINT fk_evidence_document_verification_status FOREIGN KEY (verification_status_id)
        REFERENCES verification_status(verification_status_id),
    CONSTRAINT fk_evidence_document_verified_by FOREIGN KEY (verified_by_user_id)
        REFERENCES user_account(user_id),
    CONSTRAINT fk_evidence_document_approval_status FOREIGN KEY (approval_status_id)
        REFERENCES approval_status(approval_status_id),
    CONSTRAINT fk_evidence_document_approved_by FOREIGN KEY (approved_by_user_id)
        REFERENCES user_account(user_id),
    CONSTRAINT fk_evidence_document_created_by FOREIGN KEY (created_by_user_id)
        REFERENCES user_account(user_id),
    CONSTRAINT fk_evidence_document_updated_by FOREIGN KEY (updated_by_user_id)
        REFERENCES user_account(user_id),
    CONSTRAINT fk_evidence_document_deleted_by FOREIGN KEY (deleted_by_user_id)
        REFERENCES user_account(user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE evidence_document_version (
    evidence_document_version_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    evidence_document_id BIGINT UNSIGNED NOT NULL,
    version_number SMALLINT UNSIGNED NOT NULL,
    file_object_id BIGINT UNSIGNED NOT NULL,
    change_reason VARCHAR(1000) NULL,
    uploaded_by_user_id BIGINT UNSIGNED NOT NULL,
    uploaded_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    is_current BOOLEAN NOT NULL DEFAULT TRUE,

    CONSTRAINT uq_evidence_document_version UNIQUE (evidence_document_id, version_number),
    CONSTRAINT uq_evidence_document_file UNIQUE (evidence_document_id, file_object_id),
    CONSTRAINT chk_evidence_version_number CHECK (version_number >= 1),
    CONSTRAINT fk_evidence_version_document FOREIGN KEY (evidence_document_id)
        REFERENCES evidence_document(evidence_document_id),
    CONSTRAINT fk_evidence_version_file FOREIGN KEY (file_object_id)
        REFERENCES file_object(file_object_id),
    CONSTRAINT fk_evidence_version_uploaded_by FOREIGN KEY (uploaded_by_user_id)
        REFERENCES user_account(user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Optional evidence tags make searching/reporting easier.
CREATE TABLE evidence_tag (
    evidence_tag_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    tag_code VARCHAR(60) NOT NULL UNIQUE,
    tag_name VARCHAR(120) NOT NULL UNIQUE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE evidence_document_tag (
    evidence_document_id BIGINT UNSIGNED NOT NULL,
    evidence_tag_id INT UNSIGNED NOT NULL,
    PRIMARY KEY (evidence_document_id, evidence_tag_id),
    CONSTRAINT fk_evidence_document_tag_document FOREIGN KEY (evidence_document_id)
        REFERENCES evidence_document(evidence_document_id),
    CONSTRAINT fk_evidence_document_tag_tag FOREIGN KEY (evidence_tag_id)
        REFERENCES evidence_tag(evidence_tag_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Full audit trail for upload/update/replace/delete/verification/approval/download.
CREATE TABLE evidence_document_audit (
    evidence_document_audit_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    evidence_document_id BIGINT UNSIGNED NOT NULL,
    evidence_document_version_id BIGINT UNSIGNED NULL,
    action_code ENUM(
        'CREATE','UPLOAD','REPLACE','UPDATE_METADATA','PREVIEW','DOWNLOAD',
        'VERIFY','REJECT_VERIFICATION','APPROVE','REJECT_APPROVAL',
        'SOFT_DELETE','RESTORE','ACCESS_DENIED'
    ) NOT NULL,
    performed_by_user_id BIGINT UNSIGNED NULL,
    performed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ip_address VARCHAR(45) NULL,
    user_agent VARCHAR(500) NULL,
    before_values JSON NULL,
    after_values JSON NULL,
    remarks VARCHAR(1000) NULL,

    CONSTRAINT fk_evidence_audit_document FOREIGN KEY (evidence_document_id)
        REFERENCES evidence_document(evidence_document_id),
    CONSTRAINT fk_evidence_audit_version FOREIGN KEY (evidence_document_version_id)
        REFERENCES evidence_document_version(evidence_document_version_id),
    CONSTRAINT fk_evidence_audit_user FOREIGN KEY (performed_by_user_id)
        REFERENCES user_account(user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- =============================================================
-- 34. DOCUMENT/EVIDENCE REQUIREMENT CONFIGURATION
-- Defines which evidence types are expected for each activity type.
-- =============================================================

CREATE TABLE activity_evidence_requirement (
    activity_evidence_requirement_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    activity_type_id SMALLINT UNSIGNED NOT NULL,
    evidence_type_id SMALLINT UNSIGNED NOT NULL,
    document_type_id SMALLINT UNSIGNED NULL,
    is_mandatory BOOLEAN NOT NULL DEFAULT FALSE,
    minimum_files TINYINT UNSIGNED NOT NULL DEFAULT 0,
    maximum_files TINYINT UNSIGNED NULL,
    valid_from DATE NULL,
    valid_to DATE NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,

    CONSTRAINT uq_activity_evidence_requirement UNIQUE
        (activity_type_id, evidence_type_id, document_type_id),
    CONSTRAINT chk_activity_evidence_file_counts CHECK (
        maximum_files IS NULL OR maximum_files >= minimum_files
    ),
    CONSTRAINT chk_activity_evidence_requirement_dates CHECK (
        valid_to IS NULL OR valid_from IS NULL OR valid_to >= valid_from
    ),
    CONSTRAINT fk_activity_evidence_requirement_activity FOREIGN KEY (activity_type_id)
        REFERENCES activity_type(activity_type_id),
    CONSTRAINT fk_activity_evidence_requirement_evidence FOREIGN KEY (evidence_type_id)
        REFERENCES evidence_type(evidence_type_id),
    CONSTRAINT fk_activity_evidence_requirement_document FOREIGN KEY (document_type_id)
        REFERENCES document_type(document_type_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- =============================================================
-- 35. SEED REFERENCE DATA
-- =============================================================

INSERT INTO publication_type (publication_type_code, publication_type_name, description) VALUES
('JOURNAL_ARTICLE','Journal Article','Article or paper published in a journal'),
('CONFERENCE_PAPER','Conference Paper','Paper published in conference proceedings'),
('BOOK_CHAPTER','Book Chapter','Chapter published in an edited book'),
('OTHER_PUBLICATION','Other Publication','Other scholarly publication');

INSERT INTO journal_type (journal_type_code, journal_type_name) VALUES
('INTERNATIONAL','International'),
('NATIONAL','National');

INSERT INTO indexing_agency (agency_code, agency_name) VALUES
('SCOPUS','Scopus'),
('WOS','Web of Science'),
('SCI','Science Citation Index'),
('SCIE','Science Citation Index Expanded'),
('ESCI','Emerging Sources Citation Index'),
('UGC_CARE','UGC-CARE'),
('PUBMED','PubMed'),
('DOAJ','Directory of Open Access Journals'),
('IEEE_XPLORE','IEEE Xplore'),
('DBLP','DBLP');

INSERT INTO metric_type (metric_code, metric_name) VALUES
('IMPACT_FACTOR','Impact Factor'),
('CITESCORE','CiteScore'),
('SJR','SCImago Journal Rank'),
('SNIP','Source Normalized Impact per Paper'),
('H_INDEX','H-Index');

INSERT INTO funding_type (funding_type_code, funding_type_name, is_external) VALUES
('INTERNAL','Internal Funding',FALSE),
('EXTERNAL','External Funding',TRUE),
('INDUSTRY','Industry Funding',TRUE),
('GOVERNMENT','Government Funding',TRUE),
('CENTRAL_GOVERNMENT','Central Government Funding',TRUE),
('STATE_GOVERNMENT','State Government Funding',TRUE),
('CSR','Corporate Social Responsibility Funding',TRUE),
('UNIVERSITY','University Funding',FALSE);

INSERT INTO participation_level (level_code, level_name, display_order) VALUES
('DEPARTMENT','Department',10),
('INSTITUTE','Institute',20),
('UNIVERSITY','University',30),
('REGIONAL','Regional',40),
('STATE','State',50),
('NATIONAL','National',60),
('INTERNATIONAL','International',70);

INSERT INTO event_mode (mode_code, mode_name) VALUES
('ONLINE','Online'),
('OFFLINE','Offline'),
('HYBRID','Hybrid');

INSERT INTO verification_status (status_code, status_name, is_terminal) VALUES
('NOT_SUBMITTED','Not Submitted',FALSE),
('PENDING','Pending Verification',FALSE),
('UNDER_VERIFICATION','Under Verification',FALSE),
('VERIFIED','Verified',TRUE),
('REJECTED','Rejected',TRUE),
('NEEDS_CORRECTION','Needs Correction',FALSE);

INSERT INTO approval_status (status_code, status_name, is_terminal) VALUES
('DRAFT','Draft',FALSE),
('SUBMITTED','Submitted',FALSE),
('UNDER_REVIEW','Under Review',FALSE),
('APPROVED','Approved',TRUE),
('REJECTED','Rejected',TRUE),
('ARCHIVED','Archived',TRUE);

INSERT INTO research_status (status_code, status_name, display_order, is_terminal) VALUES
('DRAFT','Draft',10,FALSE),
('SUBMITTED','Submitted',20,FALSE),
('UNDER_REVIEW','Under Review',30,FALSE),
('APPROVED','Approved',40,FALSE),
('SANCTIONED','Sanctioned',50,FALSE),
('REJECTED','Rejected',60,TRUE),
('ONGOING','Ongoing',70,FALSE),
('COMPLETED','Completed',80,TRUE),
('CLOSED','Closed',90,TRUE);

INSERT INTO training_program_type (type_code, type_name) VALUES
('WORKSHOP','Workshop'),
('FDP','Faculty Development Programme'),
('STTP','Short-Term Training Programme'),
('REFRESHER','Refresher Course'),
('ORIENTATION','Orientation Programme'),
('CERTIFICATION','Certification Programme'),
('INDUSTRIAL_TRAINING','Industrial Training'),
('PROFESSIONAL_TRAINING','Professional Training'),
('OTHER','Other Training Programme');

INSERT INTO conference_contribution_type (type_code, type_name) VALUES
('PAPER_PRESENTATION','Paper Presentation'),
('POSTER_PRESENTATION','Poster Presentation'),
('PAPER_PUBLICATION','Paper Publication'),
('PARTICIPATION','Participation'),
('INVITED_TALK','Invited Talk'),
('KEYNOTE','Keynote Address'),
('SESSION_CHAIR','Session Chair'),
('CONFERENCE_CHAIR','Conference Chair'),
('OTHER','Other Contribution');

INSERT INTO extracurricular_category (category_code, category_name) VALUES
('SPORTS','Sports'),
('CULTURAL','Cultural Activity'),
('SOCIAL_SERVICE','Social Service'),
('NSS','NSS Activity'),
('NCC','NCC Activity'),
('CLUB','Club Activity'),
('PROFESSIONAL_SOCIETY','Professional Society Activity'),
('COMMUNITY_OUTREACH','Community Outreach'),
('INSTITUTIONAL_ACTIVITY','Institutional Activity'),
('COMPETITION','Competition'),
('OTHER','Other Extra-Curricular Activity');

INSERT INTO cocurricular_category (category_code, category_name) VALUES
('TECHNICAL_EVENT','Technical Event'),
('HACKATHON','Hackathon'),
('PROJECT_EXHIBITION','Project Exhibition'),
('ACADEMIC_COMPETITION','Academic Competition'),
('MENTORING_EVENT','Mentoring Event'),
('JUDGING','Judging / Evaluation'),
('COMMITTEE_ACTIVITY','Committee Activity'),
('OTHER','Other Co-Curricular Activity');

INSERT INTO award_category (category_code, category_name) VALUES
('ACADEMIC','Academic Award'),
('RESEARCH','Research Award'),
('TEACHING','Teaching Award'),
('PROFESSIONAL','Professional Award'),
('SERVICE','Service Recognition'),
('SPORTS','Sports Award'),
('CULTURAL','Cultural Award'),
('OTHER','Other Award');

INSERT INTO membership_type (type_code, type_name) VALUES
('MEMBER','Member'),
('LIFE_MEMBER','Life Member'),
('FELLOW','Fellow'),
('SENIOR_MEMBER','Senior Member'),
('ASSOCIATE_MEMBER','Associate Member'),
('HONORARY_MEMBER','Honorary Member'),
('OFFICE_BEARER','Office Bearer'),
('OTHER','Other Membership');

INSERT INTO role_type (role_code, role_name) VALUES
('AUTHOR','Author'),
('CO_AUTHOR','Co-Author'),
('CORRESPONDING_AUTHOR','Corresponding Author'),
('PI','Principal Investigator'),
('CO_PI','Co-Principal Investigator'),
('CO_INVESTIGATOR','Co-Investigator'),
('PRINCIPAL_CONSULTANT','Principal Consultant'),
('TEAM_MEMBER','Team Member'),
('PARTICIPANT','Participant'),
('COORDINATOR','Coordinator'),
('RESOURCE_PERSON','Resource Person'),
('TRAINER','Trainer'),
('JUDGE','Judge'),
('MENTOR','Mentor'),
('COMMITTEE_MEMBER','Committee Member'),
('CHAIRPERSON','Chairperson'),
('OFFICE_BEARER','Office Bearer'),
('REVIEWER','Reviewer'),
('EDITOR','Editor'),
('EDITORIAL_BOARD_MEMBER','Editorial Board Member'),
('SESSION_CHAIR','Session Chair'),
('SUPERVISOR','Supervisor'),
('CO_SUPERVISOR','Co-Supervisor'),
('INVITED_SPEAKER','Invited Speaker'),
('GUEST_LECTURER','Guest Lecturer'),
('OTHER','Other');

INSERT INTO professional_contribution_type (contribution_code, contribution_name) VALUES
('JOURNAL_REVIEWER','Journal Reviewer'),
('CONFERENCE_REVIEWER','Conference Reviewer'),
('JOURNAL_EDITOR','Journal Editor'),
('EDITORIAL_BOARD','Editorial Board Member'),
('CONFERENCE_CHAIR','Conference Chair'),
('SESSION_CHAIR','Session Chair'),
('BOARD_OF_STUDIES','Board of Studies Member'),
('ACADEMIC_COUNCIL','Academic Council Member'),
('EXAMINATION_DUTY','Examination Duty'),
('QUESTION_PAPER_SETTING','Question Paper Setting'),
('PHD_SUPERVISION','Ph.D. Research Supervision'),
('PG_SUPERVISION','PG Research Supervision'),
('INVITED_TALK','Invited Talk'),
('GUEST_LECTURE','Guest Lecture'),
('RESOURCE_PERSON','Resource Person Activity'),
('MENTORING','Mentoring'),
('CURRICULUM_DEVELOPMENT','Curriculum Development'),
('INSTITUTIONAL_COMMITTEE','Institutional Committee'),
('OTHER','Other Professional Contribution');

INSERT INTO confidentiality_level (level_code, level_name, display_order) VALUES
('PUBLIC','Public',10),
('INTERNAL','Internal',20),
('RESTRICTED','Restricted',30),
('CONFIDENTIAL','Confidential',40),
('HIGHLY_CONFIDENTIAL','Highly Confidential',50);

INSERT INTO activity_type (activity_type_code, activity_type_name, activity_group) VALUES
('JOURNAL_PUBLICATION','Journal Publication','PUBLICATION'),
('CONFERENCE_PUBLICATION','Conference Publication','CONFERENCE'),
('CONFERENCE_PRESENTATION','Conference Presentation','CONFERENCE'),
('WORKSHOP','Workshop','PROFESSIONAL_DEVELOPMENT'),
('FDP','Faculty Development Programme','PROFESSIONAL_DEVELOPMENT'),
('STTP','Short-Term Training Programme','PROFESSIONAL_DEVELOPMENT'),
('TRAINING','Training Programme','PROFESSIONAL_DEVELOPMENT'),
('FACULTY_INTERNSHIP','Faculty / Industry Internship','INTERNSHIP'),
('RESEARCH_PROPOSAL','Research Proposal','RESEARCH'),
('FUNDED_RESEARCH_PROJECT','Funded Research Project','RESEARCH'),
('CONSULTANCY','Consultancy Assignment','CONSULTANCY'),
('INDUSTRY_SPONSORED_PROJECT','Industry-Sponsored Project','CONSULTANCY'),
('CO_CURRICULAR','Co-Curricular Activity','CO_CURRICULAR'),
('EXTRA_CURRICULAR','Extra-Curricular Activity','EXTRA_CURRICULAR'),
('AWARD_RECOGNITION','Award / Honour / Recognition','AWARD'),
('PROFESSIONAL_MEMBERSHIP','Professional Membership / Academic Body','MEMBERSHIP'),
('ACADEMIC_PROFESSIONAL_CONTRIBUTION','Academic / Professional Contribution','ACADEMIC_PROFESSIONAL_CONTRIBUTION');

-- Common evidence categories.
INSERT INTO evidence_type (evidence_type_code, evidence_type_name) VALUES
('PUBLISHED_PAPER','Published Paper PDF'),
('FIRST_PAGE','First Page of Publication'),
('JOURNAL_COVER','Journal Cover Page'),
('TABLE_OF_CONTENTS','Table of Contents'),
('DOI_PROOF','DOI Proof'),
('INDEXING_PROOF','Indexing Proof'),
('ACCEPTANCE_LETTER','Acceptance Letter'),
('PUBLICATION_CERTIFICATE','Publication Certificate'),
('CONFERENCE_PAPER','Conference Paper'),
('PROCEEDINGS_COPY','Proceedings Copy'),
('PRESENTATION_CERTIFICATE','Presentation Certificate'),
('PARTICIPATION_CERTIFICATE','Participation Certificate'),
('COMPLETION_CERTIFICATE','Completion Certificate'),
('RESOURCE_PERSON_CERTIFICATE','Resource Person Certificate'),
('REGISTRATION_PROOF','Registration Proof'),
('AWARD_CERTIFICATE','Award / Best Paper Certificate'),
('BROCHURE','Program / Conference Brochure'),
('PHOTOGRAPH','Photograph'),
('INVITATION_LETTER','Invitation Letter'),
('ATTENDANCE_PROOF','Attendance Proof'),
('TRAINING_MATERIAL','Training Material'),
('INTERNSHIP_OFFER','Internship Offer Letter'),
('INTERNSHIP_CERTIFICATE','Internship Certificate'),
('INDUSTRY_EVALUATION','Industry Evaluation'),
('INTERNSHIP_REPORT','Internship Report'),
('STIPEND_PROOF','Stipend / Incentive Proof'),
('MOU_AGREEMENT','MoU / Agreement'),
('RESEARCH_PROPOSAL','Research Proposal'),
('SUBMISSION_ACK','Proposal Submission Acknowledgement'),
('APPROVAL_LETTER','Approval Letter'),
('SANCTION_LETTER','Sanction Letter'),
('FUNDING_ORDER','Funding Order'),
('PROGRESS_REPORT','Progress Report'),
('UTILIZATION_CERTIFICATE','Utilization Certificate'),
('STATEMENT_EXPENDITURE','Statement of Expenditure'),
('AUDITED_STATEMENT','Audited Financial Statement'),
('PROJECT_COMPLETION_REPORT','Project Completion Report'),
('OUTCOME_REPORT','Outcome Report'),
('WORK_ORDER','Work Order'),
('PURCHASE_ORDER','Purchase Order'),
('INVOICE','Invoice'),
('PAYMENT_PROOF','Payment Proof'),
('CLIENT_FEEDBACK','Client Feedback'),
('CONSULTANCY_REPORT','Consultancy Report'),
('APPRECIATION_CERTIFICATE','Appreciation Certificate'),
('APPOINTMENT_ORDER','Appointment / Order Letter'),
('CITATION','Citation'),
('AWARD_LETTER','Award Letter'),
('MEDIA_EVIDENCE','Newspaper / Media Evidence'),
('MEMBERSHIP_CERTIFICATE','Membership Certificate / Card'),
('RENEWAL_DOCUMENT','Renewal Document'),
('REVIEWER_CERTIFICATE','Reviewer Certificate'),
('EDITORIAL_BOARD_CERTIFICATE','Editorial Board Certificate'),
('ACKNOWLEDGEMENT_LETTER','Acknowledgement Letter'),
('OFFICIAL_ORDER','Official Order'),
('OTHER_SUPPORTING','Other Supporting Evidence');

-- =============================================================
-- 36. RBAC REGISTRATION FOR STAFF PROFILE AND EVIDENCE
-- =============================================================

INSERT IGNORE INTO access_module
    (module_code, module_name, description, display_order)
VALUES
    ('STAFF_PROFILE',
     'Staff Academic and Professional Profile',
     'Academic, research, professional development, industry, consultancy, awards, memberships, co-curricular and extra-curricular staff profile.',
     170);

INSERT IGNORE INTO access_resource
    (access_module_id, resource_code, resource_name, description)
SELECT access_module_id, 'STAFF_ACTIVITY', 'Staff Activity Records',
       'Create and maintain staff academic and professional activity records.'
FROM access_module WHERE module_code='STAFF_PROFILE';

INSERT IGNORE INTO access_resource
    (access_module_id, resource_code, resource_name, description)
SELECT access_module_id, 'STAFF_EVIDENCE', 'Staff Evidence Documents',
       'Upload, preview, download, version, verify and approve staff evidence documents.'
FROM access_module WHERE module_code='STAFF_PROFILE';

INSERT IGNORE INTO access_resource
    (access_module_id, resource_code, resource_name, description)
SELECT access_module_id, 'STAFF_RESEARCH', 'Staff Research and Projects',
       'Maintain research proposals, funded projects and project utilization.'
FROM access_module WHERE module_code='STAFF_PROFILE';

INSERT IGNORE INTO access_resource
    (access_module_id, resource_code, resource_name, description)
SELECT access_module_id, 'STAFF_REPORT', 'Staff Profile Reports',
       'Search, filter, report and export staff profile and evidence data.'
FROM access_module WHERE module_code='STAFF_PROFILE';

INSERT IGNORE INTO permission
    (access_resource_id, access_action_id, permission_code, permission_name, is_sensitive)
SELECT ar.access_resource_id,
       aa.access_action_id,
       CONCAT('STAFF_PROFILE.', ar.resource_code, '.', aa.action_code),
       CONCAT(aa.action_name, ' ', ar.resource_name),
       CASE
           WHEN ar.resource_code='STAFF_EVIDENCE'
                AND aa.action_code IN ('DELETE','APPROVE','VERIFY','EXPORT')
           THEN TRUE
           WHEN aa.action_code IN ('DELETE','APPROVE','CONFIGURE')
           THEN TRUE
           ELSE FALSE
       END
FROM access_resource ar
JOIN access_module am
  ON am.access_module_id=ar.access_module_id
 AND am.module_code='STAFF_PROFILE'
CROSS JOIN access_action aa
WHERE aa.action_code IN
      ('CREATE','READ','UPDATE','DELETE','APPROVE','VERIFY','EXPORT','CONFIGURE');

-- Faculty: self-service creation/read/update of own profile records.
INSERT IGNORE INTO role_permission (role_id, permission_id)
SELECT r.role_id, p.permission_id
FROM role r
CROSS JOIN permission p
JOIN access_action aa ON aa.access_action_id=p.access_action_id
WHERE r.role_code IN ('FACULTY','LAB_INSTRUCTOR')
  AND p.permission_code LIKE 'STAFF_PROFILE.%'
  AND aa.action_code IN ('CREATE','READ','UPDATE');

-- Department leadership: departmental read/verification/approval/reporting.
INSERT IGNORE INTO role_permission (role_id, permission_id)
SELECT r.role_id, p.permission_id
FROM role r
CROSS JOIN permission p
JOIN access_action aa ON aa.access_action_id=p.access_action_id
WHERE r.role_code IN ('HEAD_DEPARTMENT','DEAN_ACADEMICS')
  AND p.permission_code LIKE 'STAFF_PROFILE.%'
  AND aa.action_code IN ('CREATE','READ','UPDATE','VERIFY','APPROVE','EXPORT');

-- Internal auditor: read/export verified evidence within authorized scope.
INSERT IGNORE INTO role_permission (role_id, permission_id)
SELECT r.role_id, p.permission_id
FROM role r
CROSS JOIN permission p
JOIN access_action aa ON aa.access_action_id=p.access_action_id
WHERE r.role_code='INTERNAL_AUDITOR'
  AND p.permission_code LIKE 'STAFF_PROFILE.%'
  AND aa.action_code IN ('READ','EXPORT');

-- Super admin automatically receives new permissions.
INSERT IGNORE INTO role_permission (role_id, permission_id)
SELECT r.role_id, p.permission_id
FROM role r
CROSS JOIN permission p
WHERE r.role_code='SUPER_ADMIN'
  AND p.permission_code LIKE 'STAFF_PROFILE.%';

-- =============================================================
-- 37. REPORTING / SEARCH VIEWS
-- =============================================================

CREATE OR REPLACE VIEW v_staff_activity_profile AS
SELECT
    sa.staff_activity_id,
    sa.employee_id,
    e.employee_number,
    e.display_name AS staff_name,
    at.activity_type_code,
    at.activity_type_name,
    at.activity_group,
    sa.activity_title,
    ay.year_code AS academic_year,
    u.university_name,
    i.institution_name,
    c.campus_name,
    d.department_name,
    pl.level_name AS participation_level,
    rt.role_name AS primary_role,
    sa.start_date,
    sa.end_date,
    vs.status_name AS verification_status,
    aps.status_name AS approval_status,
    sa.created_at,
    sa.updated_at,
    sa.deleted_at
FROM staff_activity sa
JOIN employee e ON e.employee_id=sa.employee_id
JOIN activity_type at ON at.activity_type_id=sa.activity_type_id
LEFT JOIN academic_year ay ON ay.academic_year_id=sa.academic_year_id
JOIN institution i ON i.institution_id=sa.institution_id
JOIN university u ON u.university_id=i.university_id
LEFT JOIN campus c ON c.campus_id=sa.campus_id
LEFT JOIN department d ON d.department_id=sa.department_id
LEFT JOIN participation_level pl ON pl.participation_level_id=sa.participation_level_id
LEFT JOIN role_type rt ON rt.role_type_id=sa.primary_role_type_id
JOIN verification_status vs ON vs.verification_status_id=sa.verification_status_id
JOIN approval_status aps ON aps.approval_status_id=sa.approval_status_id;

CREATE OR REPLACE VIEW v_staff_evidence_search AS
SELECT
    ed.evidence_document_id,
    ed.staff_activity_id,
    sa.employee_id,
    e.employee_number,
    e.display_name AS staff_name,
    d.department_id,
    d.department_name,
    at.activity_type_code,
    at.activity_type_name,
    ay.year_code AS academic_year,
    dt.document_code,
    dt.document_name,
    et.evidence_type_code,
    et.evidence_type_name,
    ed.document_title,
    ed.certificate_document_number,
    ed.document_issue_date,
    ed.expiry_date,
    vs.status_name AS verification_status,
    aps.status_name AS approval_status,
    cl.level_name AS confidentiality_level,
    ed.current_version_number,
    ed.is_active,
    ed.created_at,
    ed.updated_at,
    ed.deleted_at
FROM evidence_document ed
JOIN staff_activity sa ON sa.staff_activity_id=ed.staff_activity_id
JOIN employee e ON e.employee_id=sa.employee_id
JOIN activity_type at ON at.activity_type_id=sa.activity_type_id
LEFT JOIN academic_year ay ON ay.academic_year_id=ed.academic_year_id
LEFT JOIN department d ON d.department_id=sa.department_id
JOIN document_type dt ON dt.document_type_id=ed.document_type_id
LEFT JOIN evidence_type et ON et.evidence_type_id=ed.evidence_type_id
JOIN verification_status vs ON vs.verification_status_id=ed.verification_status_id
JOIN approval_status aps ON aps.approval_status_id=ed.approval_status_id
JOIN confidentiality_level cl ON cl.confidentiality_level_id=ed.confidentiality_level_id;

-- =============================================================
-- 38. PERFORMANCE INDEXES
-- =============================================================

CREATE INDEX idx_staff_activity_employee_year
    ON staff_activity(employee_id, academic_year_id, activity_type_id, deleted_at);

CREATE INDEX idx_staff_activity_department_year
    ON staff_activity(department_id, academic_year_id, activity_type_id, deleted_at);

CREATE INDEX idx_staff_activity_verification
    ON staff_activity(verification_status_id, approval_status_id, created_at);

CREATE INDEX idx_staff_activity_scope
    ON staff_activity(institution_id, campus_id, department_id);

CREATE INDEX idx_staff_activity_dates
    ON staff_activity(start_date, end_date);

CREATE INDEX idx_staff_activity_contributor_activity
    ON staff_activity_contributor(staff_activity_id, contributor_sequence);

CREATE INDEX idx_staff_activity_contributor_employee
    ON staff_activity_contributor(employee_id, staff_activity_id);

CREATE INDEX idx_journal_publication_year
    ON journal_publication(publication_year, journal_id);

CREATE INDEX idx_journal_publication_title
    ON journal_publication(paper_title(191));

CREATE INDEX idx_journal_name
    ON journal(journal_name(191));

CREATE INDEX idx_conference_event_dates
    ON conference_event(start_date, end_date, participation_level_id);

CREATE INDEX idx_conference_activity_event
    ON conference_activity(conference_event_id, conference_contribution_type_id);

CREATE INDEX idx_prof_dev_type_mode
    ON professional_development_activity(training_program_type_id, event_mode_id);

CREATE INDEX idx_internship_org
    ON faculty_internship(organization_id, industry_sector_id);

CREATE INDEX idx_research_proposal_status
    ON research_proposal(research_status_id, funding_agency_id, proposal_submission_date);

CREATE INDEX idx_funded_project_status
    ON funded_research_project(research_status_id, funding_agency_id, project_start_date, project_end_date);

CREATE INDEX idx_consultancy_client_status
    ON consultancy_project(client_organization_id, status, project_start_date);

CREATE INDEX idx_membership_org_status
    ON staff_professional_membership(organization_id, membership_status, membership_expiry_date);

CREATE INDEX idx_prof_contribution_type_date
    ON staff_professional_contribution(professional_contribution_type_id, contribution_date);

CREATE INDEX idx_evidence_activity
    ON evidence_document(staff_activity_id, document_type_id, evidence_type_id, is_active);

CREATE INDEX idx_evidence_verification
    ON evidence_document(verification_status_id, approval_status_id, created_at);

CREATE INDEX idx_evidence_academic_year
    ON evidence_document(academic_year_id, document_type_id);

CREATE INDEX idx_evidence_certificate_number
    ON evidence_document(certificate_document_number);

CREATE INDEX idx_evidence_expiry
    ON evidence_document(expiry_date, is_active);

CREATE INDEX idx_evidence_version_current
    ON evidence_document_version(evidence_document_id, is_current, version_number);

CREATE INDEX idx_evidence_audit_time
    ON evidence_document_audit(evidence_document_id, performed_at);

CREATE INDEX idx_external_org_name
    ON external_organization(organization_name(191), city, country_id);

-- =============================================================
-- 39. DATA-INTEGRITY NOTES ENFORCED AT APPLICATION/SERVICE LAYER
-- =============================================================
-- 1. Exactly one specialized child table should exist for each staff_activity,
--    matching activity_type.activity_group/activity_type_code.
-- 2. staff_activity.employee_id must be within the authorized RBAC row scope.
-- 3. campus_id and department_id should match the employee assignment valid
--    for the activity date when the institution requires historical accuracy.
-- 4. Only allowed MIME types/extensions should be accepted:
--      PDF, JPG/JPEG, PNG, DOC/DOCX, XLS/XLSX, PPT/PPTX, ZIP.
-- 5. Validate MIME type from file content; do not trust extension alone.
-- 6. Restrict executable/script formats and scan uploads for malware.
-- 7. For confidential evidence, storage objects should be private and accessed
--    through authorization-checked signed/temporary URLs.
-- 8. Replacement should create a new evidence_document_version; do not overwrite
--    prior file_object records when version retention is required.
-- 9. Exactly one version should have is_current=TRUE for each evidence document.
-- 10. Verification and approval actions should append evidence_document_audit rows
--     and the existing activity_audit log.
-- 11. Soft deletion should be the normal delete path for staff_activity and
--     evidence_document. Hard deletion should be restricted to privileged admins.
-- 12. DOI, ISSN, ISBN, membership numbers, sanction/order numbers and certificate
--     numbers should receive format validation appropriate to their issuing source.
-- 13. Sanctioned/received/utilized research amounts should be reconciled by service
--     logic and financial reports.
-- 14. Search results must enforce confidentiality and row-level RBAC before
--     exposing evidence metadata or file download URLs.
-- =============================================================

-- Foreign key checks restored by the consolidated schema footer.

-- =============================================================
-- END OF SIMS V5 STAFF PROFILE / RESEARCH / EVIDENCE EXTENSION
-- =============================================================


-- =============================================================
-- 40. STUDENT ACTIVITY & EVIDENCE MODULE
-- Independent student co-curricular / extra-curricular portfolio
-- =============================================================

CREATE TABLE student_activity_type (
    student_activity_type_id SMALLINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    type_code VARCHAR(50) NOT NULL UNIQUE,
    type_name VARCHAR(150) NOT NULL UNIQUE,
    activity_group ENUM(
        'CONFERENCE','WORKSHOP','HACKATHON','SPORTS','CULTURAL','TECHNICAL',
        'COMPETITION','CERTIFICATION','CLUB','NSS','NCC','COMMUNITY_SERVICE',
        'ENTREPRENEURSHIP','INNOVATION','OTHER'
    ) NOT NULL,
    description VARCHAR(500) NULL,
    requires_team_details BOOLEAN NOT NULL DEFAULT FALSE,
    supports_achievement BOOLEAN NOT NULL DEFAULT TRUE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE student_activity (
    student_activity_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    student_id BIGINT UNSIGNED NOT NULL,
    student_activity_type_id SMALLINT UNSIGNED NOT NULL,
    academic_year_id SMALLINT UNSIGNED NULL,
    institution_id SMALLINT UNSIGNED NOT NULL,
    campus_id SMALLINT UNSIGNED NULL,
    department_id SMALLINT UNSIGNED NULL,
    programme_id SMALLINT UNSIGNED NULL,
    participation_level_id TINYINT UNSIGNED NULL,
    event_mode_id TINYINT UNSIGNED NULL,
    external_organization_id BIGINT UNSIGNED NULL,
    organizer_name VARCHAR(300) NULL,
    activity_title VARCHAR(500) NOT NULL,
    event_name VARCHAR(500) NULL,
    team_name VARCHAR(250) NULL,
    participation_role VARCHAR(150) NULL,
    start_date DATE NULL,
    end_date DATE NULL,
    venue_name VARCHAR(250) NULL,
    city VARCHAR(120) NULL,
    state_id SMALLINT UNSIGNED NULL,
    country_id SMALLINT UNSIGNED NULL,
    achievement_type ENUM(
        'PARTICIPATION','WINNER','RUNNER_UP','FIRST_PLACE','SECOND_PLACE','THIRD_PLACE',
        'MERIT','SPECIAL_MENTION','QUALIFIED','FINALIST','MEDAL_GOLD','MEDAL_SILVER',
        'MEDAL_BRONZE','RECOGNITION','OTHER'
    ) NOT NULL DEFAULT 'PARTICIPATION',
    position_rank SMALLINT UNSIGNED NULL,
    award_name VARCHAR(500) NULL,
    award_details TEXT NULL,
    cash_prize_amount DECIMAL(14,2) NULL,
    currency_code CHAR(3) NOT NULL DEFAULT 'INR',
    certificate_number VARCHAR(150) NULL,
    activity_url VARCHAR(1000) NULL,
    description TEXT NULL,
    outcomes TEXT NULL,
    remarks TEXT NULL,
    verification_status_id TINYINT UNSIGNED NOT NULL,
    verified_by_user_id BIGINT UNSIGNED NULL,
    verified_at DATETIME NULL,
    verification_remarks VARCHAR(1000) NULL,
    approval_status_id TINYINT UNSIGNED NOT NULL,
    approved_by_user_id BIGINT UNSIGNED NULL,
    approved_at DATETIME NULL,
    approval_remarks VARCHAR(1000) NULL,
    rejection_reason VARCHAR(1000) NULL,
    created_by_user_id BIGINT UNSIGNED NULL,
    updated_by_user_id BIGINT UNSIGNED NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at DATETIME NULL,
    deleted_by_user_id BIGINT UNSIGNED NULL,
    deletion_reason VARCHAR(1000) NULL,

    CONSTRAINT chk_student_activity_dates CHECK (
        end_date IS NULL OR start_date IS NULL OR end_date >= start_date
    ),
    CONSTRAINT chk_student_activity_prize CHECK (
        cash_prize_amount IS NULL OR cash_prize_amount >= 0
    ),
    CONSTRAINT chk_student_activity_rank CHECK (
        position_rank IS NULL OR position_rank > 0
    ),
    CONSTRAINT fk_student_activity_student FOREIGN KEY (student_id) REFERENCES student(student_id),
    CONSTRAINT fk_student_activity_type FOREIGN KEY (student_activity_type_id) REFERENCES student_activity_type(student_activity_type_id),
    CONSTRAINT fk_student_activity_year FOREIGN KEY (academic_year_id) REFERENCES academic_year(academic_year_id),
    CONSTRAINT fk_student_activity_institution FOREIGN KEY (institution_id) REFERENCES institution(institution_id),
    CONSTRAINT fk_student_activity_campus FOREIGN KEY (campus_id) REFERENCES campus(campus_id),
    CONSTRAINT fk_student_activity_department FOREIGN KEY (department_id) REFERENCES department(department_id),
    CONSTRAINT fk_student_activity_programme FOREIGN KEY (programme_id) REFERENCES programme(programme_id),
    CONSTRAINT fk_student_activity_level FOREIGN KEY (participation_level_id) REFERENCES participation_level(participation_level_id),
    CONSTRAINT fk_student_activity_mode FOREIGN KEY (event_mode_id) REFERENCES event_mode(event_mode_id),
    CONSTRAINT fk_student_activity_org FOREIGN KEY (external_organization_id) REFERENCES external_organization(organization_id),
    CONSTRAINT fk_student_activity_state FOREIGN KEY (state_id) REFERENCES state(state_id),
    CONSTRAINT fk_student_activity_country FOREIGN KEY (country_id) REFERENCES country(country_id),
    CONSTRAINT fk_student_activity_verification_status FOREIGN KEY (verification_status_id) REFERENCES verification_status(verification_status_id),
    CONSTRAINT fk_student_activity_verified_by FOREIGN KEY (verified_by_user_id) REFERENCES user_account(user_id),
    CONSTRAINT fk_student_activity_approval_status FOREIGN KEY (approval_status_id) REFERENCES approval_status(approval_status_id),
    CONSTRAINT fk_student_activity_approved_by FOREIGN KEY (approved_by_user_id) REFERENCES user_account(user_id),
    CONSTRAINT fk_student_activity_created_by FOREIGN KEY (created_by_user_id) REFERENCES user_account(user_id),
    CONSTRAINT fk_student_activity_updated_by FOREIGN KEY (updated_by_user_id) REFERENCES user_account(user_id),
    CONSTRAINT fk_student_activity_deleted_by FOREIGN KEY (deleted_by_user_id) REFERENCES user_account(user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Optional team / collaborator details for hackathons, sports and group events.
CREATE TABLE student_activity_team_member (
    student_activity_team_member_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    student_activity_id BIGINT UNSIGNED NOT NULL,
    student_id BIGINT UNSIGNED NULL,
    external_member_name VARCHAR(250) NULL,
    external_member_email VARCHAR(254) NULL,
    external_organization_id BIGINT UNSIGNED NULL,
    member_role VARCHAR(150) NULL,
    member_sequence SMALLINT UNSIGNED NULL,
    is_team_lead BOOLEAN NOT NULL DEFAULT FALSE,
    remarks VARCHAR(500) NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_student_activity_member_identity CHECK (
        (student_id IS NOT NULL AND external_member_name IS NULL)
        OR (student_id IS NULL AND external_member_name IS NOT NULL)
    ),
    CONSTRAINT uq_student_activity_internal_member UNIQUE (student_activity_id, student_id),
    CONSTRAINT fk_student_activity_member_activity FOREIGN KEY (student_activity_id) REFERENCES student_activity(student_activity_id),
    CONSTRAINT fk_student_activity_member_student FOREIGN KEY (student_id) REFERENCES student(student_id),
    CONSTRAINT fk_student_activity_member_org FOREIGN KEY (external_organization_id) REFERENCES external_organization(organization_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE student_activity_evidence (
    student_activity_evidence_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    student_activity_id BIGINT UNSIGNED NOT NULL,
    document_type_id SMALLINT UNSIGNED NOT NULL,
    evidence_type_id SMALLINT UNSIGNED NULL,
    confidentiality_level_id TINYINT UNSIGNED NOT NULL,
    document_title VARCHAR(500) NOT NULL,
    description TEXT NULL,
    academic_year_id SMALLINT UNSIGNED NULL,
    document_issue_date DATE NULL,
    issuing_authority VARCHAR(300) NULL,
    issuing_organization_id BIGINT UNSIGNED NULL,
    certificate_document_number VARCHAR(150) NULL,
    expiry_date DATE NULL,
    verification_status_id TINYINT UNSIGNED NOT NULL,
    verified_by_user_id BIGINT UNSIGNED NULL,
    verified_at DATETIME NULL,
    verification_remarks VARCHAR(1000) NULL,
    approval_status_id TINYINT UNSIGNED NOT NULL,
    approved_by_user_id BIGINT UNSIGNED NULL,
    approved_at DATETIME NULL,
    rejection_reason VARCHAR(1000) NULL,
    current_version_number SMALLINT UNSIGNED NOT NULL DEFAULT 1,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_by_user_id BIGINT UNSIGNED NOT NULL,
    updated_by_user_id BIGINT UNSIGNED NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at DATETIME NULL,
    deleted_by_user_id BIGINT UNSIGNED NULL,
    deletion_reason VARCHAR(1000) NULL,
    CONSTRAINT chk_student_evidence_dates CHECK (
        expiry_date IS NULL OR document_issue_date IS NULL OR expiry_date >= document_issue_date
    ),
    CONSTRAINT chk_student_evidence_version CHECK (current_version_number >= 1),
    CONSTRAINT fk_student_evidence_activity FOREIGN KEY (student_activity_id) REFERENCES student_activity(student_activity_id),
    CONSTRAINT fk_student_evidence_document_type FOREIGN KEY (document_type_id) REFERENCES document_type(document_type_id),
    CONSTRAINT fk_student_evidence_evidence_type FOREIGN KEY (evidence_type_id) REFERENCES evidence_type(evidence_type_id),
    CONSTRAINT fk_student_evidence_confidentiality FOREIGN KEY (confidentiality_level_id) REFERENCES confidentiality_level(confidentiality_level_id),
    CONSTRAINT fk_student_evidence_year FOREIGN KEY (academic_year_id) REFERENCES academic_year(academic_year_id),
    CONSTRAINT fk_student_evidence_issuing_org FOREIGN KEY (issuing_organization_id) REFERENCES external_organization(organization_id),
    CONSTRAINT fk_student_evidence_verification_status FOREIGN KEY (verification_status_id) REFERENCES verification_status(verification_status_id),
    CONSTRAINT fk_student_evidence_verified_by FOREIGN KEY (verified_by_user_id) REFERENCES user_account(user_id),
    CONSTRAINT fk_student_evidence_approval_status FOREIGN KEY (approval_status_id) REFERENCES approval_status(approval_status_id),
    CONSTRAINT fk_student_evidence_approved_by FOREIGN KEY (approved_by_user_id) REFERENCES user_account(user_id),
    CONSTRAINT fk_student_evidence_created_by FOREIGN KEY (created_by_user_id) REFERENCES user_account(user_id),
    CONSTRAINT fk_student_evidence_updated_by FOREIGN KEY (updated_by_user_id) REFERENCES user_account(user_id),
    CONSTRAINT fk_student_evidence_deleted_by FOREIGN KEY (deleted_by_user_id) REFERENCES user_account(user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE student_activity_evidence_version (
    student_activity_evidence_version_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    student_activity_evidence_id BIGINT UNSIGNED NOT NULL,
    version_number SMALLINT UNSIGNED NOT NULL,
    file_object_id BIGINT UNSIGNED NOT NULL,
    change_reason VARCHAR(1000) NULL,
    uploaded_by_user_id BIGINT UNSIGNED NOT NULL,
    uploaded_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    is_current BOOLEAN NOT NULL DEFAULT TRUE,
    current_document_key BIGINT UNSIGNED GENERATED ALWAYS AS (
        CASE WHEN is_current = TRUE THEN student_activity_evidence_id ELSE NULL END
    ) STORED,
    CONSTRAINT uq_student_evidence_version UNIQUE (student_activity_evidence_id, version_number),
    CONSTRAINT uq_student_evidence_file UNIQUE (student_activity_evidence_id, file_object_id),
    CONSTRAINT uq_student_evidence_current UNIQUE (current_document_key),
    CONSTRAINT chk_student_evidence_version_number CHECK (version_number >= 1),
    CONSTRAINT fk_student_evidence_version_document FOREIGN KEY (student_activity_evidence_id) REFERENCES student_activity_evidence(student_activity_evidence_id),
    CONSTRAINT fk_student_evidence_version_file FOREIGN KEY (file_object_id) REFERENCES file_object(file_object_id),
    CONSTRAINT fk_student_evidence_version_uploaded_by FOREIGN KEY (uploaded_by_user_id) REFERENCES user_account(user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE student_activity_evidence_audit (
    student_activity_evidence_audit_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    student_activity_evidence_id BIGINT UNSIGNED NOT NULL,
    student_activity_evidence_version_id BIGINT UNSIGNED NULL,
    action_code ENUM(
        'CREATE','UPLOAD','REPLACE','UPDATE_METADATA','PREVIEW','DOWNLOAD',
        'VERIFY','REJECT_VERIFICATION','APPROVE','REJECT_APPROVAL',
        'SOFT_DELETE','RESTORE','ACCESS_DENIED'
    ) NOT NULL,
    performed_by_user_id BIGINT UNSIGNED NULL,
    performed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ip_address VARCHAR(45) NULL,
    user_agent VARCHAR(500) NULL,
    before_values JSON NULL,
    after_values JSON NULL,
    remarks VARCHAR(1000) NULL,
    CONSTRAINT fk_student_evidence_audit_document FOREIGN KEY (student_activity_evidence_id) REFERENCES student_activity_evidence(student_activity_evidence_id),
    CONSTRAINT fk_student_evidence_audit_version FOREIGN KEY (student_activity_evidence_version_id) REFERENCES student_activity_evidence_version(student_activity_evidence_version_id),
    CONSTRAINT fk_student_evidence_audit_user FOREIGN KEY (performed_by_user_id) REFERENCES user_account(user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE student_activity_evidence_requirement (
    student_activity_evidence_requirement_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    student_activity_type_id SMALLINT UNSIGNED NOT NULL,
    evidence_type_id SMALLINT UNSIGNED NOT NULL,
    document_type_id SMALLINT UNSIGNED NULL,
    is_mandatory BOOLEAN NOT NULL DEFAULT FALSE,
    minimum_files TINYINT UNSIGNED NOT NULL DEFAULT 0,
    maximum_files TINYINT UNSIGNED NULL,
    valid_from DATE NULL,
    valid_to DATE NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    document_type_key SMALLINT UNSIGNED GENERATED ALWAYS AS (COALESCE(document_type_id, 0)) STORED,
    CONSTRAINT uq_student_activity_evidence_requirement UNIQUE (student_activity_type_id, evidence_type_id, document_type_key),
    CONSTRAINT chk_student_activity_evidence_counts CHECK (maximum_files IS NULL OR maximum_files >= minimum_files),
    CONSTRAINT chk_student_activity_evidence_req_dates CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to >= valid_from),
    CONSTRAINT fk_student_activity_evidence_req_type FOREIGN KEY (student_activity_type_id) REFERENCES student_activity_type(student_activity_type_id),
    CONSTRAINT fk_student_activity_evidence_req_evidence FOREIGN KEY (evidence_type_id) REFERENCES evidence_type(evidence_type_id),
    CONSTRAINT fk_student_activity_evidence_req_document FOREIGN KEY (document_type_id) REFERENCES document_type(document_type_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Student activity reference data.
INSERT INTO student_activity_type
    (type_code, type_name, activity_group, requires_team_details, supports_achievement)
VALUES
('CONFERENCE_PARTICIPATION','Conference Participation','CONFERENCE',FALSE,TRUE),
('CONFERENCE_PRESENTATION','Conference Paper / Poster Presentation','CONFERENCE',FALSE,TRUE),
('WORKSHOP','Workshop','WORKSHOP',FALSE,TRUE),
('HACKATHON','Hackathon','HACKATHON',TRUE,TRUE),
('SPORTS','Sports','SPORTS',TRUE,TRUE),
('CULTURAL_EVENT','Cultural Event','CULTURAL',TRUE,TRUE),
('TECHNICAL_EVENT','Technical Event','TECHNICAL',TRUE,TRUE),
('COMPETITION','Competition','COMPETITION',TRUE,TRUE),
('CERTIFICATION','Certification','CERTIFICATION',FALSE,TRUE),
('CLUB_ACTIVITY','Club Activity','CLUB',TRUE,TRUE),
('NSS_ACTIVITY','NSS Activity','NSS',TRUE,TRUE),
('NCC_ACTIVITY','NCC Activity','NCC',TRUE,TRUE),
('COMMUNITY_SERVICE','Community / Social Service','COMMUNITY_SERVICE',TRUE,TRUE),
('ENTREPRENEURSHIP','Entrepreneurship Activity','ENTREPRENEURSHIP',TRUE,TRUE),
('INNOVATION','Innovation / Prototype Activity','INNOVATION',TRUE,TRUE),
('OTHER','Other Student Activity','OTHER',FALSE,TRUE);

-- Common evidence categories specific to student activities.
INSERT IGNORE INTO evidence_type (evidence_type_code, evidence_type_name) VALUES
('STUDENT_PARTICIPATION_CERTIFICATE','Student Participation Certificate'),
('STUDENT_ACHIEVEMENT_CERTIFICATE','Student Achievement / Winner Certificate'),
('STUDENT_MEDAL_PROOF','Medal / Sports Achievement Proof'),
('STUDENT_SCORE_SHEET','Competition Score / Result Sheet'),
('STUDENT_EVENT_PHOTO','Student Event Photograph'),
('STUDENT_HACKATHON_RESULT','Hackathon Result / Ranking Proof'),
('STUDENT_PRESENTATION_PROOF','Presentation / Paper Presentation Proof');

-- RBAC resources under the existing STUDENT module.
INSERT IGNORE INTO access_resource
    (access_module_id, resource_code, resource_name, description)
SELECT access_module_id, 'STUDENT_ACTIVITY', 'Student Activity Records',
       'Create and maintain student conference, workshop, hackathon, sports, cultural, technical and other activity records.'
FROM access_module WHERE module_code='STUDENT';

INSERT IGNORE INTO access_resource
    (access_module_id, resource_code, resource_name, description)
SELECT access_module_id, 'STUDENT_ACTIVITY_EVIDENCE', 'Student Activity Evidence',
       'Upload, preview, download, version, verify and approve evidence for student activities.'
FROM access_module WHERE module_code='STUDENT';

INSERT IGNORE INTO access_resource
    (access_module_id, resource_code, resource_name, description)
SELECT access_module_id, 'STUDENT_ACTIVITY_REPORT', 'Student Activity Reports',
       'Search, filter, report and export student activities and achievements.'
FROM access_module WHERE module_code='STUDENT';

INSERT IGNORE INTO permission
    (access_resource_id, access_action_id, permission_code, permission_name, is_sensitive)
SELECT ar.access_resource_id,
       aa.access_action_id,
       CONCAT('STUDENT.', ar.resource_code, '.', aa.action_code),
       CONCAT(aa.action_name, ' ', ar.resource_name),
       CASE WHEN ar.resource_code='STUDENT_ACTIVITY_EVIDENCE'
                 AND aa.action_code IN ('DELETE','APPROVE','VERIFY','EXPORT')
            THEN TRUE
            WHEN aa.action_code IN ('DELETE','APPROVE','CONFIGURE') THEN TRUE
            ELSE FALSE END
FROM access_resource ar
JOIN access_module am ON am.access_module_id=ar.access_module_id AND am.module_code='STUDENT'
CROSS JOIN access_action aa
WHERE ar.resource_code IN ('STUDENT_ACTIVITY','STUDENT_ACTIVITY_EVIDENCE','STUDENT_ACTIVITY_REPORT')
  AND aa.action_code IN ('CREATE','READ','UPDATE','DELETE','APPROVE','VERIFY','EXPORT','CONFIGURE');

-- Student self-service: own activity/evidence create/read/update.
INSERT IGNORE INTO role_permission (role_id, permission_id)
SELECT r.role_id, p.permission_id
FROM role r
CROSS JOIN permission p
JOIN access_resource ar ON ar.access_resource_id=p.access_resource_id
JOIN access_module am ON am.access_module_id=ar.access_module_id
JOIN access_action aa ON aa.access_action_id=p.access_action_id
WHERE r.role_code='STUDENT'
  AND am.module_code='STUDENT'
  AND ar.resource_code IN ('STUDENT_ACTIVITY','STUDENT_ACTIVITY_EVIDENCE')
  AND aa.action_code IN ('CREATE','READ','UPDATE');

-- Department/programme staff: review, verification and reporting within authorized scope.
INSERT IGNORE INTO role_permission (role_id, permission_id)
SELECT r.role_id, p.permission_id
FROM role r
CROSS JOIN permission p
JOIN access_resource ar ON ar.access_resource_id=p.access_resource_id
JOIN access_module am ON am.access_module_id=ar.access_module_id
JOIN access_action aa ON aa.access_action_id=p.access_action_id
WHERE r.role_code IN ('HEAD_DEPARTMENT','PROGRAMME_COORDINATOR','FACULTY_ADVISOR','MENTOR','STUDENT_SECTION_OFFICER','DOCUMENT_VERIFIER')
  AND am.module_code='STUDENT'
  AND ar.resource_code IN ('STUDENT_ACTIVITY','STUDENT_ACTIVITY_EVIDENCE','STUDENT_ACTIVITY_REPORT')
  AND aa.action_code IN ('CREATE','READ','UPDATE','VERIFY','APPROVE','EXPORT');

-- Internal auditor: read/export verified student activity evidence in authorized scope.
INSERT IGNORE INTO role_permission (role_id, permission_id)
SELECT r.role_id, p.permission_id
FROM role r
CROSS JOIN permission p
JOIN access_resource ar ON ar.access_resource_id=p.access_resource_id
JOIN access_module am ON am.access_module_id=ar.access_module_id
JOIN access_action aa ON aa.access_action_id=p.access_action_id
WHERE r.role_code='INTERNAL_AUDITOR'
  AND am.module_code='STUDENT'
  AND ar.resource_code IN ('STUDENT_ACTIVITY','STUDENT_ACTIVITY_EVIDENCE','STUDENT_ACTIVITY_REPORT')
  AND aa.action_code IN ('READ','EXPORT');

-- Super admin receives all new permissions.
INSERT IGNORE INTO role_permission (role_id, permission_id)
SELECT r.role_id, p.permission_id
FROM role r
CROSS JOIN permission p
WHERE r.role_code='SUPER_ADMIN'
  AND p.permission_code LIKE 'STUDENT.STUDENT_ACTIVITY%';

CREATE OR REPLACE VIEW v_student_activity_profile AS
SELECT
    sa.student_activity_id,
    sa.student_id,
    s.student_number,
    s.display_name AS student_name,
    sat.type_code AS activity_type_code,
    sat.type_name AS activity_type_name,
    sat.activity_group,
    sa.activity_title,
    sa.event_name,
    ay.year_code AS academic_year,
    i.institution_name,
    c.campus_name,
    d.department_name,
    p.programme_name,
    pl.level_name AS participation_level,
    em.mode_name AS event_mode,
    sa.start_date,
    sa.end_date,
    sa.achievement_type,
    sa.position_rank,
    sa.award_name,
    sa.cash_prize_amount,
    vs.status_name AS verification_status,
    aps.status_name AS approval_status,
    sa.created_at,
    sa.updated_at,
    sa.deleted_at
FROM student_activity sa
JOIN student s ON s.student_id=sa.student_id
JOIN student_activity_type sat ON sat.student_activity_type_id=sa.student_activity_type_id
LEFT JOIN academic_year ay ON ay.academic_year_id=sa.academic_year_id
JOIN institution i ON i.institution_id=sa.institution_id
LEFT JOIN campus c ON c.campus_id=sa.campus_id
LEFT JOIN department d ON d.department_id=sa.department_id
LEFT JOIN programme p ON p.programme_id=sa.programme_id
LEFT JOIN participation_level pl ON pl.participation_level_id=sa.participation_level_id
LEFT JOIN event_mode em ON em.event_mode_id=sa.event_mode_id
JOIN verification_status vs ON vs.verification_status_id=sa.verification_status_id
JOIN approval_status aps ON aps.approval_status_id=sa.approval_status_id;

CREATE OR REPLACE VIEW v_student_activity_evidence_search AS
SELECT
    sae.student_activity_evidence_id,
    sae.student_activity_id,
    sa.student_id,
    s.student_number,
    s.display_name AS student_name,
    sat.type_code AS activity_type_code,
    sat.type_name AS activity_type_name,
    d.department_id,
    d.department_name,
    p.programme_id,
    p.programme_name,
    ay.year_code AS academic_year,
    dt.document_code,
    dt.document_name,
    et.evidence_type_code,
    et.evidence_type_name,
    sae.document_title,
    sae.certificate_document_number,
    sae.document_issue_date,
    sae.expiry_date,
    vs.status_name AS verification_status,
    aps.status_name AS approval_status,
    cl.level_name AS confidentiality_level,
    sae.current_version_number,
    sae.is_active,
    sae.created_at,
    sae.updated_at,
    sae.deleted_at
FROM student_activity_evidence sae
JOIN student_activity sa ON sa.student_activity_id=sae.student_activity_id
JOIN student s ON s.student_id=sa.student_id
JOIN student_activity_type sat ON sat.student_activity_type_id=sa.student_activity_type_id
LEFT JOIN academic_year ay ON ay.academic_year_id=sae.academic_year_id
LEFT JOIN department d ON d.department_id=sa.department_id
LEFT JOIN programme p ON p.programme_id=sa.programme_id
JOIN document_type dt ON dt.document_type_id=sae.document_type_id
LEFT JOIN evidence_type et ON et.evidence_type_id=sae.evidence_type_id
JOIN verification_status vs ON vs.verification_status_id=sae.verification_status_id
JOIN approval_status aps ON aps.approval_status_id=sae.approval_status_id
JOIN confidentiality_level cl ON cl.confidentiality_level_id=sae.confidentiality_level_id;

CREATE INDEX idx_student_activity_student_year
    ON student_activity(student_id, academic_year_id, student_activity_type_id, deleted_at);
CREATE INDEX idx_student_activity_department_year
    ON student_activity(department_id, academic_year_id, student_activity_type_id, deleted_at);
CREATE INDEX idx_student_activity_programme_year
    ON student_activity(programme_id, academic_year_id, student_activity_type_id, deleted_at);
CREATE INDEX idx_student_activity_achievement
    ON student_activity(achievement_type, participation_level_id, start_date);
CREATE INDEX idx_student_activity_verification
    ON student_activity(verification_status_id, approval_status_id, created_at);
CREATE INDEX idx_student_activity_member_activity
    ON student_activity_team_member(student_activity_id, member_sequence);
CREATE INDEX idx_student_activity_member_student
    ON student_activity_team_member(student_id, student_activity_id);
CREATE INDEX idx_student_evidence_activity
    ON student_activity_evidence(student_activity_id, document_type_id, evidence_type_id, is_active);
CREATE INDEX idx_student_evidence_verification
    ON student_activity_evidence(verification_status_id, approval_status_id, created_at);
CREATE INDEX idx_student_evidence_expiry
    ON student_activity_evidence(expiry_date, is_active);
CREATE INDEX idx_student_evidence_version_current
    ON student_activity_evidence_version(student_activity_evidence_id, is_current, version_number);
CREATE INDEX idx_student_evidence_audit_time
    ON student_activity_evidence_audit(student_activity_evidence_id, performed_at);

==============

--