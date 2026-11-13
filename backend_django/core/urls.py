from django.urls import path, re_path
from . import views

urlpatterns = [
    # Health and Platform Information
    path('health', views.health_check, name='health-check'),
    path('info', views.platform_info, name='platform-info'),

    # Authentication & User Sessions
    path('auth/login', views.auth_login, name='auth-login'),
    path('auth/demo-switch', views.auth_demo_switch, name='auth-demo-switch'),
    path('auth/firebase-login', views.auth_firebase_login, name='auth-firebase-login'),
    path('auth/me', views.auth_me, name='auth-me'),
    path('auth/register-school', views.register_school, name='auth-register-school'),

    # Schools Management
    path('schools', views.public_schools_list, name='public-schools'),
    path('admin/schools', views.admin_schools_list, name='admin-schools'),
    path('admin/overview', views.admin_overview, name='admin-overview'),
    path('admin/audit-logs', views.admin_audit_logs, name='admin-audit-logs'),
    path('admin/payment-codes', views.admin_payment_codes, name='admin-payment-codes'),
    path('admin/payment-codes/generate', views.admin_payment_codes, name='admin-payment-codes-generate'),
    path('admin/schools/<str:school_id>', views.admin_school_detail, name='admin-school-detail'),
    path('admin/schools/<str:school_id>/users', views.admin_school_users, name='admin-school-users'),
    path('admin/schools/<str:school_id>/impersonate', views.admin_impersonate_school, name='admin-school-impersonate'),
    path('admin/schools/<str:school_id>/approve', views.admin_approve_school, name='admin-school-approve'),
    path('admin/schools/<str:school_id>/status', views.admin_school_status, name='admin-school-status'),
    path('admin/schools/<str:school_id>/suspend', views.admin_suspend_school, name='admin-school-suspend'),
    path('admin/schools/<str:school_id>/reactivate', views.admin_reactivate_school, name='admin-school-reactivate'),
    path('admin/schools/<str:school_id>/reset-admin-password', views.admin_reset_admin_password, name='admin-school-reset-password'),

    # Academic & Student Portals & Backups
    path('school/profile', views.school_profile, name='school-profile'),
    path('school/sessions', views.school_sessions, name='school-sessions'),
    path('school/terms', views.school_terms, name='school-terms'),
    path('school/classes', views.school_classes, name='school-classes'),
    path('school/classes/<str:class_id>', views.school_classes, name='school-classes-detail'),
    path('school/arms', views.school_arms, name='school-arms'),
    path('school/subjects', views.school_subjects, name='school-subjects'),
    path('school/subjects/<str:subject_id>', views.school_subjects, name='school-subjects-detail'),
    path('school/teachers', views.school_teachers, name='school-teachers'),
    path('school/students', views.school_students_manage, name='school-students'),
    path('school/students/<str:student_id>', views.school_students_manage, name='school-students-detail'),
    path('school/grading', views.school_grading, name='school-grading'),
    path('school/result-template', views.school_result_template, name='school-result-template'),
    path('school/export-data', views.school_export_data, name='school-export-data'),
    path('school/download-backup', views.school_download_backup, name='school-download-backup'),
    path('school/import-cloud-data', views.school_import_cloud_data, name='school-import-cloud-data'),
    path('school/restore-backup', views.school_import_cloud_data, name='school-restore-backup'),

    # Teacher & Classroom Portals
    path('teacher/scores', views.teacher_scores_manage, name='teacher-scores'),
    path('school/scores/bulk-import', views.school_scores_bulk_import, name='school-scores-bulk-import'),
    path('school/results/publish', views.school_results_publish, name='school-results-publish'),
    path('school/reports/broadsheet', views.school_reports_broadsheet, name='school-reports-broadsheet'),
    path('school/reports/student/<str:student_id>', views.school_report_student_get, name='school-report-student-get'),
    path('school/reports/student/<str:student_id>/save', views.school_report_student_save, name='school-report-student-save'),
    path('teacher/assignments', views.teacher_assignments_manage, name='teacher-assignments'),
    path('teacher/activities', views.teacher_activities_manage, name='teacher-activities'),
    path('attendance', views.attendance_manage, name='attendance-manage'),

    # Finance & Payment Categories
    path('finance/payments', views.finance_payments, name='finance-payments'),
    path('finance/categories', views.finance_categories, name='finance-categories'),

    # System Status & Verification
    path('database/status', views.database_status_manage, name='database-status'),
    path('public/verify-result', views.public_verify_result_manage, name='public-verify-result'),

    # Admin School Backups & Restores
    path('admin/schools/<str:school_id>/backup-download', views.admin_school_backup_download, name='admin-school-backup-download'),
    path('admin/schools/<str:school_id>/restore', views.admin_school_restore, name='admin-school-restore'),
    path('notifications', views.notifications_list, name='notifications-list'),
    path('notifications/read-all', views.notifications_list, name='notifications-read-all'),

    # Resilient Catch-All Route: Any additional subpath returns 200 JSON instead of 500 error
    re_path(r'^(?P<subpath>.*)$', views.catch_all_api, name='catch-all-api'),
]
