"""Isola o banco de testes: cada sessão de pytest usa um SQLite temporário."""

import os
import pathlib
import sys
import tempfile

_TMP = pathlib.Path(tempfile.mkdtemp(prefix="bmoto_test_"))
os.environ["PERSIST_DB"] = str(_TMP / "plataforma_test.db")
os.environ.pop("DATABASE_URL", None)
os.environ.setdefault("AMBIENTE", "dev")

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))
