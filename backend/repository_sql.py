"""
repository_sql.py — Repositório persistente (substitui o in-memory).

Mesma interface do Repository (get/save/all), com estado guardado num banco
SQL compartilhado — pré-requisito para escalar horizontalmente (vários workers/
réplicas atrás de um load balancer).

  * PostgresRepository(dsn)  -> produção (Render/Railway/Fly + Postgres)
  * SqliteRepository(path)   -> dev/teste local (stdlib, sem servidor)

O agregado Operation é serializado em JSON (ver serialization.py) e gravado numa
coluna única, com upsert idempotente por proposal_id.
"""
from __future__ import annotations
import json
from typing import List, Optional

from state_machine import Operation
from serialization import op_to_dict, op_from_dict


_DDL = """
CREATE TABLE IF NOT EXISTS operacoes (
    proposal_id TEXT PRIMARY KEY,
    estado      TEXT NOT NULL,
    payload     TEXT NOT NULL,
    updated_at  TEXT NOT NULL
)
"""


class SqlRepository:
    """Repositório SQL portátil. `placeholder` é '?' (SQLite) ou '%s' (psycopg)."""

    def __init__(self, conn, placeholder: str):
        self.conn = conn
        self.ph = placeholder
        self._ensure_table()

    def _ensure_table(self) -> None:
        cur = self.conn.cursor()
        cur.execute(_DDL)
        self.conn.commit()

    def get(self, proposal_id: str) -> Optional[Operation]:
        cur = self.conn.cursor()
        cur.execute(f"SELECT payload FROM operacoes WHERE proposal_id = {self.ph}",
                    (proposal_id,))
        row = cur.fetchone()
        if not row:
            return None
        return op_from_dict(json.loads(row[0]))

    def save(self, op: Operation) -> None:
        import datetime as dt
        op.updated_at = dt.datetime.utcnow()
        payload = json.dumps(op_to_dict(op))
        ph = self.ph
        sql = (
            f"INSERT INTO operacoes (proposal_id, estado, payload, updated_at) "
            f"VALUES ({ph}, {ph}, {ph}, {ph}) "
            f"ON CONFLICT (proposal_id) DO UPDATE SET "
            f"estado = EXCLUDED.estado, payload = EXCLUDED.payload, "
            f"updated_at = EXCLUDED.updated_at"
        )
        cur = self.conn.cursor()
        cur.execute(sql, (op.proposal_id, op.state.value, payload,
                          op.updated_at.isoformat()))
        self.conn.commit()

    def all(self) -> List[Operation]:
        cur = self.conn.cursor()
        cur.execute("SELECT payload FROM operacoes ORDER BY updated_at DESC")
        return [op_from_dict(json.loads(r[0])) for r in cur.fetchall()]


def PostgresRepository(dsn: str) -> SqlRepository:
    """Produção. Requer psycopg2-binary. dsn = DATABASE_URL."""
    import psycopg2  # lazy: só é necessário em produção
    conn = psycopg2.connect(dsn)
    return SqlRepository(conn, placeholder="%s")


def SqliteRepository(path: str = "originadora.db") -> SqlRepository:
    """Dev/teste local."""
    import sqlite3
    conn = sqlite3.connect(path, check_same_thread=False)
    return SqlRepository(conn, placeholder="?")
