import os
import sys
import shutil
from pathlib import Path

# Add project root and backend_django to sys.path
BASE_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BASE_DIR))
sys.path.insert(0, str(BASE_DIR / 'backend_django'))

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'backend_django.settings')

# Ensure SQLite database is initialized and ready on cold start
try:
    if os.environ.get('VERCEL') or os.environ.get('AWS_LAMBDA_FUNCTION_NAME') or os.environ.get('LAMBDA_TASK_ROOT'):
        tmp_data_dir = Path('/tmp/academiq_data')
        tmp_data_dir.mkdir(parents=True, exist_ok=True)
        dest_db = tmp_data_dir / 'multischool.sqlite'

        candidate_seeds = [
            BASE_DIR / 'data' / 'multischool.sqlite',
            Path('/var/task/data/multischool.sqlite'),
            Path(os.getcwd()) / 'data' / 'multischool.sqlite',
            Path(__file__).resolve().parent / 'multischool.sqlite',
        ]

        if not dest_db.exists():
            for src_candidate in candidate_seeds:
                if src_candidate.exists():
                    try:
                        shutil.copy2(str(src_candidate), str(dest_db))
                        print(f"[Vercel Django] Bootstrapped /tmp database from {src_candidate}")
                        break
                    except Exception as copy_err:
                        print(f"[Vercel Django] Database bootstrap candidate note: {copy_err}")

        # Self-initialize schema & seed data if needed
        import sqlite3
        from backend_django.core.init_db import ensure_database_initialized
        from backend_django.core.views import sync_all_firestore_schools_to_db
        conn = sqlite3.connect(str(dest_db))
        conn.row_factory = sqlite3.Row
        ensure_database_initialized(conn)
        try:
            sync_all_firestore_schools_to_db(conn)
            print("[Vercel Django] Cloud Firestore records successfully hydrated on container cold-start.")
        except Exception as sync_e:
            print(f"[Vercel Django] Cloud Firestore hydration note on boot: {sync_e}")
        conn.close()
        print("[Vercel Django] SQLite schema verified and ready.")
except Exception as init_err:
    print(f"[Vercel Django] Database init warning: {init_err}")

from django.core.wsgi import get_wsgi_application
app = get_wsgi_application()
handler = app


