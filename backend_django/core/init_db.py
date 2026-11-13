import sqlite3
import hashlib
import uuid
import json
from pathlib import Path

def hash_pw(password: str, salt: str = None) -> tuple[str, str]:
    if not salt:
        salt = uuid.uuid4().hex[:16]
    pw_hash = hashlib.pbkdf2_hmac('sha512', password.encode('utf-8'), salt.encode('utf-8'), 10000).hex()
    return pw_hash, salt

def ensure_database_initialized(conn: sqlite3.Connection):
    """
    Ensures that all tables, foreign keys, migrations, and essential seed data
    (Super Admin accounts, default subscription plans, demo schools, active payment codes)
    exist in the SQLite database.
    """
    cursor = conn.cursor()

    # Enable WAL mode and foreign keys for durability
    cursor.execute('PRAGMA foreign_keys = ON;')
    cursor.execute('PRAGMA journal_mode = WAL;')
    cursor.execute('PRAGMA busy_timeout = 5000;')

    # Create all required tables
    cursor.executescript("""
        CREATE TABLE IF NOT EXISTS subscription_plans (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT,
            price REAL NOT NULL DEFAULT 0,
            billing_interval TEXT NOT NULL DEFAULT 'annual',
            max_students INTEGER NOT NULL DEFAULT 500,
            max_staff INTEGER NOT NULL DEFAULT 50,
            features_json TEXT NOT NULL DEFAULT '[]',
            is_active INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS schools (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            slug TEXT UNIQUE NOT NULL,
            email TEXT NOT NULL,
            phone TEXT,
            address TEXT,
            country TEXT NOT NULL DEFAULT 'Nigeria',
            state TEXT,
            school_level TEXT NOT NULL,
            logo_url TEXT,
            result_template_json TEXT,
            status TEXT NOT NULL DEFAULT 'approved',
            rejection_reason TEXT,
            is_payment_verified INTEGER NOT NULL DEFAULT 1,
            payment_verified_at TEXT,
            payment_code_used TEXT,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            school_id TEXT,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            salt TEXT NOT NULL,
            full_name TEXT NOT NULL,
            phone TEXT,
            role TEXT NOT NULL,
            is_active INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS school_subscriptions (
            id TEXT PRIMARY KEY,
            school_id TEXT NOT NULL,
            plan_id TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'active',
            start_date TEXT NOT NULL,
            expiry_date TEXT NOT NULL,
            amount_paid REAL NOT NULL DEFAULT 0,
            payment_method TEXT NOT NULL DEFAULT 'manual',
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE CASCADE,
            FOREIGN KEY (plan_id) REFERENCES subscription_plans(id)
        );

        CREATE TABLE IF NOT EXISTS academic_sessions (
            id TEXT PRIMARY KEY,
            school_id TEXT NOT NULL,
            name TEXT NOT NULL,
            is_current INTEGER NOT NULL DEFAULT 0,
            start_date TEXT,
            end_date TEXT,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS academic_terms (
            id TEXT PRIMARY KEY,
            school_id TEXT NOT NULL,
            session_id TEXT NOT NULL,
            name TEXT NOT NULL,
            is_current INTEGER NOT NULL DEFAULT 0,
            start_date TEXT,
            end_date TEXT,
            next_term_resumption TEXT,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE CASCADE,
            FOREIGN KEY (session_id) REFERENCES academic_sessions(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS classes (
            id TEXT PRIMARY KEY,
            school_id TEXT NOT NULL,
            name TEXT NOT NULL,
            level TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS class_arms (
            id TEXT PRIMARY KEY,
            school_id TEXT NOT NULL,
            class_id TEXT NOT NULL,
            name TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE CASCADE,
            FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS subjects (
            id TEXT PRIMARY KEY,
            school_id TEXT NOT NULL,
            name TEXT NOT NULL,
            code TEXT,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS teacher_profiles (
            id TEXT PRIMARY KEY,
            school_id TEXT NOT NULL,
            user_id TEXT NOT NULL UNIQUE,
            employee_id TEXT,
            qualification TEXT,
            specialization TEXT,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE CASCADE,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS teacher_assignments (
            id TEXT PRIMARY KEY,
            school_id TEXT NOT NULL,
            teacher_id TEXT NOT NULL,
            class_id TEXT NOT NULL,
            arm_id TEXT,
            subject_id TEXT NOT NULL,
            session_id TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE CASCADE,
            FOREIGN KEY (teacher_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE CASCADE,
            FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE CASCADE,
            FOREIGN KEY (session_id) REFERENCES academic_sessions(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS students (
            id TEXT PRIMARY KEY,
            school_id TEXT NOT NULL,
            admission_number TEXT NOT NULL,
            full_name TEXT NOT NULL,
            gender TEXT NOT NULL,
            date_of_birth TEXT,
            class_id TEXT NOT NULL,
            arm_id TEXT,
            parent_name TEXT,
            parent_phone TEXT,
            parent_email TEXT,
            address TEXT,
            photo_url TEXT,
            enrollment_status TEXT NOT NULL DEFAULT 'active',
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE CASCADE,
            FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE RESTRICT,
            FOREIGN KEY (arm_id) REFERENCES class_arms(id) ON DELETE RESTRICT,
            UNIQUE(school_id, admission_number)
        );

        CREATE TABLE IF NOT EXISTS grading_systems (
            id TEXT PRIMARY KEY,
            school_id TEXT NOT NULL,
            name TEXT NOT NULL DEFAULT 'Default Scale',
            scales_json TEXT NOT NULL,
            assessment_weights_json TEXT NOT NULL,
            is_active INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS student_scores (
            id TEXT PRIMARY KEY,
            school_id TEXT NOT NULL,
            student_id TEXT NOT NULL,
            subject_id TEXT NOT NULL,
            class_id TEXT NOT NULL,
            term_id TEXT NOT NULL,
            session_id TEXT NOT NULL,
            ca1 REAL NOT NULL DEFAULT 0,
            ca2 REAL NOT NULL DEFAULT 0,
            ca3 REAL NOT NULL DEFAULT 0,
            exam REAL NOT NULL DEFAULT 0,
            total REAL NOT NULL DEFAULT 0,
            grade TEXT NOT NULL DEFAULT 'F',
            remark TEXT NOT NULL DEFAULT 'Fail',
            teacher_comment TEXT,
            status TEXT NOT NULL DEFAULT 'draft',
            entered_by_user_id TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE CASCADE,
            FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
            FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE CASCADE,
            FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE CASCADE,
            FOREIGN KEY (term_id) REFERENCES academic_terms(id) ON DELETE CASCADE,
            FOREIGN KEY (session_id) REFERENCES academic_sessions(id) ON DELETE CASCADE,
            UNIQUE(school_id, student_id, subject_id, term_id, session_id)
        );

        CREATE TABLE IF NOT EXISTS term_results (
            id TEXT PRIMARY KEY,
            school_id TEXT NOT NULL,
            student_id TEXT NOT NULL,
            class_id TEXT NOT NULL,
            arm_id TEXT,
            term_id TEXT NOT NULL,
            session_id TEXT NOT NULL,
            total_score REAL NOT NULL DEFAULT 0,
            average_score REAL NOT NULL DEFAULT 0,
            position INTEGER,
            class_size INTEGER NOT NULL DEFAULT 0,
            status TEXT NOT NULL DEFAULT 'draft',
            teacher_comment TEXT,
            principal_comment TEXT,
            approved_by_user_id TEXT,
            approved_at TEXT,
            published_at TEXT,
            snapshot_json TEXT,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE CASCADE,
            FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
            FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE CASCADE,
            FOREIGN KEY (term_id) REFERENCES academic_terms(id) ON DELETE CASCADE,
            FOREIGN KEY (session_id) REFERENCES academic_sessions(id) ON DELETE CASCADE,
            UNIQUE(school_id, student_id, term_id, session_id)
        );

        CREATE TABLE IF NOT EXISTS result_verification_codes (
            id TEXT PRIMARY KEY,
            school_id TEXT NOT NULL,
            student_id TEXT NOT NULL,
            term_id TEXT NOT NULL,
            session_id TEXT NOT NULL,
            code_hash TEXT NOT NULL,
            code_display TEXT NOT NULL,
            usage_count INTEGER NOT NULL DEFAULT 0,
            max_usage INTEGER NOT NULL DEFAULT 10,
            is_revoked INTEGER NOT NULL DEFAULT 0,
            expires_at TEXT,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE CASCADE,
            FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS student_activities (
            id TEXT PRIMARY KEY,
            school_id TEXT NOT NULL,
            student_id TEXT NOT NULL,
            class_id TEXT NOT NULL,
            term_id TEXT NOT NULL,
            session_id TEXT NOT NULL,
            punctuality TEXT NOT NULL DEFAULT 'A',
            neatness TEXT NOT NULL DEFAULT 'A',
            politeness TEXT NOT NULL DEFAULT 'A',
            honesty TEXT NOT NULL DEFAULT 'A',
            attentiveness TEXT NOT NULL DEFAULT 'A',
            leadership TEXT NOT NULL DEFAULT 'B',
            handwriting TEXT NOT NULL DEFAULT 'A',
            sports TEXT NOT NULL DEFAULT 'B',
            crafts TEXT NOT NULL DEFAULT 'B',
            speaking TEXT NOT NULL DEFAULT 'A',
            practical TEXT NOT NULL DEFAULT 'A',
            remarks TEXT,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE CASCADE,
            FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
            UNIQUE(school_id, student_id, term_id, session_id)
        );

        CREATE TABLE IF NOT EXISTS attendance_records (
            id TEXT PRIMARY KEY,
            school_id TEXT NOT NULL,
            student_id TEXT NOT NULL,
            class_id TEXT NOT NULL,
            date TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'present',
            remarks TEXT,
            recorded_by_user_id TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE CASCADE,
            FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
            UNIQUE(school_id, student_id, date)
        );

        CREATE TABLE IF NOT EXISTS fee_categories (
            id TEXT PRIMARY KEY,
            school_id TEXT NOT NULL,
            name TEXT NOT NULL,
            amount REAL NOT NULL DEFAULT 0,
            term_id TEXT,
            session_id TEXT,
            is_active INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS fee_payments (
            id TEXT PRIMARY KEY,
            school_id TEXT NOT NULL,
            student_id TEXT NOT NULL,
            fee_category_id TEXT NOT NULL,
            amount_paid REAL NOT NULL,
            payment_method TEXT NOT NULL DEFAULT 'cash',
            receipt_number TEXT NOT NULL,
            payment_date TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            remarks TEXT,
            recorded_by_user_id TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE CASCADE,
            FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
            FOREIGN KEY (fee_category_id) REFERENCES fee_categories(id) ON DELETE CASCADE,
            UNIQUE(school_id, receipt_number)
        );

        CREATE TABLE IF NOT EXISTS audit_logs (
            id TEXT PRIMARY KEY,
            school_id TEXT,
            user_id TEXT,
            user_email TEXT,
            action TEXT NOT NULL,
            resource TEXT NOT NULL,
            ip_address TEXT,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS payment_verification_codes (
            id TEXT PRIMARY KEY,
            code TEXT UNIQUE NOT NULL,
            school_id TEXT,
            school_name TEXT,
            issued_to_email TEXT,
            notes TEXT,
            status TEXT NOT NULL DEFAULT 'active',
            created_by_user_id TEXT NOT NULL,
            created_by_name TEXT NOT NULL DEFAULT 'Platform Super Admin',
            redeemed_by_user_id TEXT,
            redeemed_by_email TEXT,
            redeemed_at TEXT,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE SET NULL
        );

        CREATE TABLE IF NOT EXISTS school_notifications (
            id TEXT PRIMARY KEY,
            school_id TEXT,
            school_name TEXT,
            sender_id TEXT,
            sender_name TEXT NOT NULL DEFAULT 'Platform Super Admin (Ahmad Auwal)',
            title TEXT NOT NULL,
            message TEXT NOT NULL,
            category TEXT NOT NULL DEFAULT 'announcement',
            priority TEXT NOT NULL DEFAULT 'normal',
            target_role TEXT NOT NULL DEFAULT 'all',
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS user_notification_reads (
            id TEXT PRIMARY KEY,
            notification_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            read_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(notification_id, user_id),
            FOREIGN KEY (notification_id) REFERENCES school_notifications(id) ON DELETE CASCADE,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );

        -- Django Framework Compatibility Tables
        CREATE TABLE IF NOT EXISTS django_session (
            session_key VARCHAR(40) PRIMARY KEY,
            session_data TEXT NOT NULL,
            expire_date DATETIME NOT NULL
        );
        CREATE INDEX IF NOT EXISTS django_session_expire_date_idx ON django_session(expire_date);

        CREATE TABLE IF NOT EXISTS django_content_type (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            app_label VARCHAR(100) NOT NULL,
            model VARCHAR(100) NOT NULL
        );

        CREATE TABLE IF NOT EXISTS django_migrations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            app VARCHAR(255) NOT NULL,
            name VARCHAR(255) NOT NULL,
            applied DATETIME NOT NULL
        );
    """)

    # Run safe column migrations
    for col, definition in [
        ('result_template_json', 'TEXT'),
        ('is_payment_verified', 'INTEGER NOT NULL DEFAULT 1'),
        ('payment_verified_at', 'TEXT'),
        ('payment_code_used', 'TEXT')
    ]:
        try:
            cursor.execute(f"ALTER TABLE schools ADD COLUMN {col} {definition};")
        except sqlite3.OperationalError:
            pass

    # Ensure Super Admin users exist with required credentials:
    # 'academiq.multi.tenant@gmail.com', 'academia.multi.tenant@gmail.com', 'ahmadauwal898@gmail.com'
    # with password '@Candfe69a9'
    super_pw_hash, super_salt = hash_pw('@Candfe69a9')
    super_admins = [
        ('usr_superadmin_q', 'academiq.multi.tenant@gmail.com'),
        ('usr_superadmin', 'academia.multi.tenant@gmail.com'),
        ('usr_superadmin_auwal', 'ahmadauwal898@gmail.com'),
    ]

    for uid, email in super_admins:
        cursor.execute("SELECT id FROM users WHERE LOWER(email) = ? OR id = ?", (email.lower(), uid))
        existing = cursor.fetchone()
        if not existing:
            cursor.execute("""
                INSERT INTO users (id, school_id, email, password_hash, salt, full_name, phone, role, is_active)
                VALUES (?, NULL, ?, ?, ?, 'Platform Super Administrator (Ahmad Auwal)', '+2349155377861', 'super_admin', 1)
            """, (uid, email.lower(), super_pw_hash, super_salt))
        else:
            cursor.execute("""
                UPDATE users
                SET email = ?, password_hash = ?, salt = ?, role = 'super_admin', school_id = NULL
                WHERE id = ?
            """, (email.lower(), super_pw_hash, super_salt, existing[0]))

    # Ensure Demo School Apex Academy exists
    cursor.execute("SELECT id FROM schools WHERE id = 'sch_apex'")
    if not cursor.fetchone():
        cursor.execute("""
            INSERT INTO schools (id, name, slug, email, phone, address, country, state, school_level, logo_url, status, is_payment_verified)
            VALUES ('sch_apex', 'Apex International College', 'apex-international-college', 'admin@apexacademy.edu', '+2348012345678', 'Plot 4, Victoria Island Extension', 'Nigeria', 'Lagos', 'Senior Secondary', 'https://images.unsplash.com/photo-1546410531-bb4caa6b424d?w=200&auto=format&fit=crop&q=80', 'approved', 1)
        """)

        # Demo users
        demo_pw_hash, demo_salt = hash_pw('@Candfe69a9')
        for du_id, du_email, du_name, du_role in [
            ('usr_apex_admin', 'admin@apexacademy.edu', 'Dr. Emmanuel Vance', 'school_admin'),
            ('usr_apex_teacher', 'teacher@apexacademy.edu', 'Mrs. Clara Adeyemi', 'teacher'),
            ('usr_apex_bursar', 'bursar@apexacademy.edu', 'Alhaji Musa Danjuma', 'bursar'),
        ]:
            cursor.execute("SELECT id FROM users WHERE id = ?", (du_id,))
            if not cursor.fetchone():
                cursor.execute("""
                    INSERT INTO users (id, school_id, email, password_hash, salt, full_name, phone, role, is_active)
                    VALUES (?, 'sch_apex', ?, ?, ?, ?, '+2348000000000', ?, 1)
                """, (du_id, du_email, demo_pw_hash, demo_salt, du_name, du_role))

        # Academic session & term
        cursor.execute("""
            INSERT OR IGNORE INTO academic_sessions (id, school_id, name, is_current)
            VALUES ('sess_2026', 'sch_apex', '2026/2027', 1)
        """)
        cursor.execute("""
            INSERT OR IGNORE INTO academic_terms (id, school_id, session_id, name, is_current)
            VALUES ('term_1', 'sch_apex', 'sess_2026', 'First Term', 1)
        """)

        # Classes & Arms
        cursor.execute("""
            INSERT OR IGNORE INTO classes (id, school_id, name, level)
            VALUES ('cls_ss1', 'sch_apex', 'SS 1', 'Senior Secondary')
        """)
        cursor.execute("""
            INSERT OR IGNORE INTO class_arms (id, school_id, class_id, name)
            VALUES ('arm_ss1_sci', 'sch_apex', 'cls_ss1', 'Science')
        """)

        # Subject
        cursor.execute("""
            INSERT OR IGNORE INTO subjects (id, school_id, name, code)
            VALUES ('sub_mth', 'sch_apex', 'Mathematics', 'MTH')
        """)

        # Demo Students
        demo_students = [
            ('std_01', 'sch_apex', 'APX/2026/001', 'Chinedu Okonkwo', 'Male', 'cls_ss1', 'arm_ss1_sci', 'Mr. Emeka Okonkwo', '+2348031112233'),
            ('std_02', 'sch_apex', 'APX/2026/002', 'Amina Bello', 'Female', 'cls_ss1', 'arm_ss1_sci', 'Alhaji Bello', '+2348032223344'),
            ('std_03', 'sch_apex', 'APX/2026/003', 'Oluwaseun Adeleke', 'Male', 'cls_ss1', 'arm_ss1_sci', 'Chief Adeleke', '+2348033334455'),
            ('std_04', 'sch_apex', 'APX/2026/004', 'Fatima Danjuma', 'Female', 'cls_ss1', 'arm_ss1_sci', 'Dr. Danjuma', '+2348034445566'),
            ('std_05', 'sch_apex', 'APX/2026/005', 'Emeka Nwosu', 'Male', 'cls_ss1', 'arm_ss1_sci', 'Mrs. Nwosu', '+2348035556677'),
        ]
        for s in demo_students:
            cursor.execute("""
                INSERT OR IGNORE INTO students (id, school_id, admission_number, full_name, gender, class_id, arm_id, parent_name, parent_phone, enrollment_status)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')
            """, s)

        # Starter scores
        scores = [
            ('sc_01', 'std_01', 9.0, 8.0, 9.0, 62.0, 88.0, 'A', 'Distinction'),
            ('sc_02', 'std_02', 10.0, 9.0, 8.0, 58.0, 85.0, 'A', 'Distinction'),
            ('sc_03', 'std_03', 8.0, 7.0, 8.0, 52.0, 75.0, 'B', 'Very Good'),
            ('sc_04', 'std_04', 7.0, 8.0, 7.0, 48.0, 70.0, 'B', 'Very Good'),
            ('sc_05', 'std_05', 6.0, 7.0, 6.0, 44.0, 63.0, 'C', 'Credit'),
        ]
        for sc in scores:
            cursor.execute("""
                INSERT OR IGNORE INTO student_scores (id, school_id, student_id, class_id, subject_id, term_id, session_id, ca1, ca2, ca3, exam, total, grade, remark, status, entered_by_user_id)
                VALUES (?, 'sch_apex', ?, 'cls_ss1', 'sub_mth', 'term_1', 'sess_2026', ?, ?, ?, ?, ?, ?, ?, 'approved', 'system_starter')
            """, sc)

    # Ensure Payment Verification Codes exist
    cursor.execute("SELECT id FROM payment_verification_codes WHERE code = 'ACAD-PAY-DEMO-2026'")
    if not cursor.fetchone():
        cursor.execute("""
            INSERT INTO payment_verification_codes (id, code, notes, status, created_by_user_id, created_by_name)
            VALUES ('code_demo_1', 'ACAD-PAY-DEMO-2026', 'Default Platform Verification Code for Initial Testing', 'active', 'usr_superadmin', 'Platform Super Admin (Ahmad Auwal)')
        """)

    conn.commit()
