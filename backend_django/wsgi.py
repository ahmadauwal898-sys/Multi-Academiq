import os
import sys
import types
import shutil
from pathlib import Path

_CURRENT_DIR = Path(__file__).resolve().parent
_PARENT_DIR = _CURRENT_DIR.parent

if (_PARENT_DIR / 'backend_django').is_dir():
    if str(_PARENT_DIR) not in sys.path:
        sys.path.insert(0, str(_PARENT_DIR))
else:
    if str(_CURRENT_DIR) not in sys.path:
        sys.path.insert(0, str(_CURRENT_DIR))
    if 'backend_django' not in sys.modules:
        _pkg = types.ModuleType('backend_django')
        _pkg.__path__ = [str(_CURRENT_DIR)]
        _pkg.__file__ = str(_CURRENT_DIR / '__init__.py')
        sys.modules['backend_django'] = _pkg

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'backend_django.settings')

# Ensure SQLite database & Cloud Firestore hydration are ready on Vercel cold start
try:
    if os.environ.get('VERCEL') or os.environ.get('AWS_LAMBDA_FUNCTION_NAME') or os.environ.get('LAMBDA_TASK_ROOT'):
        _tmp_data_dir = Path('/tmp/academiq_data')
        _tmp_data_dir.mkdir(parents=True, exist_ok=True)
        _dest_db = _tmp_data_dir / 'multischool.sqlite'
        _seed_candidates = [
            _PARENT_DIR / 'data' / 'multischool.sqlite',
            Path('/var/task/data/multischool.sqlite'),
            Path(os.getcwd()) / 'data' / 'multischool.sqlite',
        ]
        if not _dest_db.exists():
            for _src in _seed_candidates:
                if _src.exists():
                    try:
                        shutil.copy2(str(_src), str(_dest_db))
                        break
                    except Exception:
                        pass

        import sqlite3
        from backend_django.core.init_db import ensure_database_initialized
        from backend_django.core.views import sync_all_firestore_schools_to_db

        _conn = sqlite3.connect(str(_dest_db))
        _conn.row_factory = sqlite3.Row
        ensure_database_initialized(_conn)
        try:
            sync_all_firestore_schools_to_db(_conn)
        except Exception:
            pass
        _conn.close()
except Exception:
    pass

from django.core.wsgi import get_wsgi_application

application = get_wsgi_application()

# Aliases for Vercel Serverless / WSGI compatibility
app = application
handler = application
