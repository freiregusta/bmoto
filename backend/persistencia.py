"""
persistencia.py — Store JSON portátil para os agregados auxiliares.

Mesmo padrão do repository_sql (Postgres em produção via DATABASE_URL,
SQLite em dev), para os dados que estavam in-memory e zeravam a cada
redeploy do Render:

    - cartório de CCBs           (ccb.py)
    - ordens de Pix              (psp.py)
    - resultados de KYC          (kyc.py)
    - parcelas do monitor        (repasse_monitor.py)

Cada tabela é um documento JSON por chave, com upsert idempotente.
"""

from __future__ import annotations

import json
import os
import threading
from typing import Any, Callable, Optional

_LOCK = threading.Lock()
_CONN = None
_PH = "?"


def _conectar():
    """Postgres se DATABASE_URL existir; senão SQLite local."""
    global _CONN, _PH
    if _CONN is not None:
        return _CONN, _PH
    dsn = os.environ.get("DATABASE_URL", "")
    if dsn:
        import psycopg2
        _CONN = psycopg2.connect(dsn)
        _PH = "%s"
    else:
        import sqlite3
        path = os.environ.get("PERSIST_DB", "originadora_aux.db")
        _CONN = sqlite3.connect(path, check_same_thread=False)
        _PH = "?"
    return _CONN, _PH


class JsonStore:
    """Tabela chave→documento JSON com upsert. Thread-safe (lock global)."""

    def __init__(self, tabela: str):
        assert tabela.isidentifier(), "nome de tabela inválido"
        self.tabela = tabela
        conn, ph = _conectar()
        self.ph = ph
        with _LOCK:
            cur = conn.cursor()
            cur.execute(
                f"CREATE TABLE IF NOT EXISTS {tabela} ("
                f"chave TEXT PRIMARY KEY, doc TEXT NOT NULL)")
            conn.commit()

    def put(self, chave: str, doc: dict) -> None:
        conn, _ = _conectar()
        with _LOCK:
            cur = conn.cursor()
            cur.execute(
                f"INSERT INTO {self.tabela} (chave, doc) VALUES ({self.ph}, {self.ph}) "
                f"ON CONFLICT (chave) DO UPDATE SET doc = EXCLUDED.doc",
                (chave, json.dumps(doc, ensure_ascii=False, default=str)))
            conn.commit()

    def get(self, chave: str) -> Optional[dict]:
        conn, _ = _conectar()
        with _LOCK:
            cur = conn.cursor()
            cur.execute(f"SELECT doc FROM {self.tabela} WHERE chave = {self.ph}", (chave,))
            row = cur.fetchone()
        return json.loads(row[0]) if row else None

    def all(self) -> dict[str, dict]:
        conn, _ = _conectar()
        with _LOCK:
            cur = conn.cursor()
            cur.execute(f"SELECT chave, doc FROM {self.tabela}")
            rows = cur.fetchall()
        return {k: json.loads(d) for k, d in rows}


def hidratar(store: JsonStore, construir: Callable[[dict], Any]) -> dict[str, Any]:
    """Carrega a tabela inteira reconstruindo os objetos de domínio."""
    out: dict[str, Any] = {}
    for k, doc in store.all().items():
        try:
            out[k] = construir(doc)
        except Exception:
            continue  # documento de versão antiga: ignora sem derrubar o app
    return out
