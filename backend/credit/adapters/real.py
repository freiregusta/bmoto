"""
credit/adapters/real.py — Adapters HTTP reais (produção).

Cada adapter implementa a mesma interface do mock.
Plugue as credenciais via variáveis de ambiente e troque o mock pelo real
em credit/config.py.

Dependências: httpx (já no requirements.txt)
"""
from __future__ import annotations
import asyncio
import datetime as dt
import os
from typing import Optional

import httpx

from credit.adapters.base import BureauAdapter
from credit.models import (
    DadosDataprev, DadosSerasa, DadosSCR, DadosEmpregadorBureau,
    DadosEmpregador, EmprestimoVincendo, CategoriaWorker, SituacaoEmprego,
)

TIMEOUT = httpx.Timeout(5.0)   # 5s padrão para todos os bureaus


# ─────────────────────────────────────────────────────────────────────────────
# 1. Dataprev via BaaS (Celcoin)
#    Documentação: developers.celcoin.com.br/docs/crédito-consignado-trabalhador
# ─────────────────────────────────────────────────────────────────────────────

class DataprevBaaSAdapter(BureauAdapter[DadosDataprev]):
    """
    Consulta de margem via BaaS (Celcoin ou equivalente).

    Variáveis de ambiente:
        BAAS_BASE_URL      ex: https://api.celcoin.com.br
        BAAS_CLIENT_ID
        BAAS_CLIENT_SECRET
        BAAS_PRODUCT_ID    UUID do produto configurado no BaaS

    Fluxo:
        POST /auth/token                → access_token
        POST /workers-credit/margin     → DadosDataprev
    """
    nome = "dataprev_baas"
    obrigatorio = True

    def __init__(self):
        self.base = os.environ.get("BAAS_BASE_URL", "").rstrip("/")
        self.client_id = os.environ.get("BAAS_CLIENT_ID", "")
        self.client_secret = os.environ.get("BAAS_CLIENT_SECRET", "")
        self.product_id = os.environ.get("BAAS_PRODUCT_ID", "")
        self._token: Optional[str] = None
        self._token_exp: float = 0.0

    async def _auth(self) -> str:
        import time
        if self._token and time.time() < self._token_exp - 30:
            return self._token
        async with httpx.AsyncClient(timeout=TIMEOUT) as c:
            r = await c.post(f"{self.base}/auth/token", data={
                "grant_type": "client_credentials",
                "client_id": self.client_id,
                "client_secret": self.client_secret,
            })
            r.raise_for_status()
            d = r.json()
            self._token = d["access_token"]
            self._token_exp = time.time() + d.get("expires_in", 3600)
        return self._token

    async def consultar(self, cpf: str, **_) -> DadosDataprev:
        token = await self._auth()
        async with httpx.AsyncClient(timeout=TIMEOUT) as c:
            r = await c.post(
                f"{self.base}/banking/workers-credit/margin",
                headers={"Authorization": f"Bearer {token}"},
                json={"taxpayer_id": cpf, "product_id": self.product_id},
            )
            r.raise_for_status()
            d = r.json()

        # Mapeamento dos campos da API Celcoin → DadosDataprev
        # Ref: developers.celcoin.com.br/docs/solicitação-de-crédito-e-coleta-de-autorização
        cat_map = {
            "CLT": CategoriaWorker.CLT,
            "DOMESTICO": CategoriaWorker.DOMESTICO,
            "RURAL": CategoriaWorker.RURAL,
            "MEI": CategoriaWorker.MEI,
        }
        sit_map = {
            "ATIVO": SituacaoEmprego.ATIVO,
            "AFASTADO": SituacaoEmprego.AFASTADO,
            "AVISO_PREVIO": SituacaoEmprego.AVISO_PREVIO,
            "DESLIGADO": SituacaoEmprego.DESLIGADO,
        }

        emp = d.get("employer") or {}
        empregador = DadosEmpregador(
            cnpj=emp.get("registration_number", ""),
            nome=emp.get("name", ""),
            codigo_inscricao=emp.get("registration_code", ""),
        ) if emp else None

        emprestimos = []
        for loan in d.get("active_loans", []):
            emprestimos.append(EmprestimoVincendo(
                modalidade="CONSIGNADO" if loan.get("type") == "PAYROLL" else "PESSOAL",
                saldo_devedor=float(loan.get("outstanding_balance", 0)),
                parcela_mensal=float(loan.get("monthly_installment", 0)),
                parcelas_restantes=int(loan.get("remaining_installments", 0)),
                credor=loan.get("creditor", ""),
            ))

        def parse_date(s: Optional[str]) -> Optional[dt.date]:
            if not s:
                return None
            try:
                return dt.date.fromisoformat(s[:10])
            except Exception:
                return None

        return DadosDataprev(
            cpf=d.get("taxpayer_id", cpf),
            nome=d.get("name", ""),
            data_nascimento=parse_date(d.get("birth_date")) or dt.date(1980, 1, 1),
            sexo=d.get("gender", ""),
            categoria=cat_map.get(d.get("worker_category", ""), CategoriaWorker.DESCONHECIDO),
            pep=bool(d.get("politically_exposed_person", False)),
            elegivel=bool(d.get("eligible", False)),
            motivo_inelegibilidade=d.get("ineligibility_reason", ""),
            empregador=empregador,
            matricula=d.get("registration", ""),
            data_admissao=parse_date(d.get("admission_date")),
            data_desligamento=parse_date(d.get("dismissal_date")),
            situacao=sit_map.get(d.get("employment_status", ""), SituacaoEmprego.DESCONHECIDO),
            valor_total_vencimentos=float(d.get("gross_salary", 0)),
            valor_base_margem=float(d.get("margin_base", 0)),
            valor_margem_disponivel=float(d.get("available_margin", 0)),
            quantidade_emprestimos_ativos=int(d.get("active_loans_count", 0)),
            emprestimos=emprestimos,
        )


# ─────────────────────────────────────────────────────────────────────────────
# 2. Serasa Experian (PF)
#    Variáveis: SERASA_BASE_URL, SERASA_API_KEY
# ─────────────────────────────────────────────────────────────────────────────

class SerasaAdapter(BureauAdapter[DadosSerasa]):
    nome = "serasa"
    obrigatorio = False

    def __init__(self):
        self.base = os.environ.get("SERASA_BASE_URL", "").rstrip("/")
        self.api_key = os.environ.get("SERASA_API_KEY", "")

    async def consultar(self, cpf: str, **_) -> DadosSerasa:
        async with httpx.AsyncClient(timeout=TIMEOUT) as c:
            r = await c.get(
                f"{self.base}/consumers/{cpf}/credit-report",
                headers={"Authorization": f"Bearer {self.api_key}"},
            )
            r.raise_for_status()
            d = r.json()

        # Mapeamento genérico — ajuste conforme o contrato real do Serasa
        score = int(d.get("score", {}).get("value", 0))
        restricoes = d.get("restrictions", {})
        neg = int(restricoes.get("negative_count", 0))
        acoes = int(d.get("legal_actions", {}).get("count", 0))
        cheques = int(d.get("bounced_checks", {}).get("count", 0))
        meses_limpo = int(d.get("months_without_restriction", 0)) if neg == 0 else 0

        return DadosSerasa(
            cpf=cpf, score=score,
            negativacoes_ativas=neg, acoes_judiciais=acoes,
            cheques_sem_fundo=cheques, meses_sem_negativacao=meses_limpo,
        )


# ─────────────────────────────────────────────────────────────────────────────
# 3. SCR — Sistema de Informações de Crédito (Banco Central)
#    Acesso via API do BCB (certificado A1 + OAuth BCB)
#    Variáveis: SCR_BASE_URL, SCR_CERT_PATH, SCR_KEY_PATH
# ─────────────────────────────────────────────────────────────────────────────

class SCRAdapter(BureauAdapter[DadosSCR]):
    nome = "scr"
    obrigatorio = True

    def __init__(self):
        self.base = os.environ.get("SCR_BASE_URL", "").rstrip("/")
        self.cert = (
            os.environ.get("SCR_CERT_PATH", ""),
            os.environ.get("SCR_KEY_PATH", ""),
        )

    async def consultar(self, cpf: str, **_) -> DadosSCR:
        # O SCR exige mTLS (certificado A1) — asyncio + httpx suporta
        async with httpx.AsyncClient(timeout=TIMEOUT, cert=self.cert) as c:
            r = await c.get(
                f"{self.base}/credit-information/{cpf}",
            )
            r.raise_for_status()
            d = r.json()

        return DadosSCR(
            cpf=cpf,
            divida_total_ifs=float(d.get("total_debt", 0)),
            operacoes_ativas=int(d.get("active_operations", 0)),
            operacoes_vencidas=int(d.get("overdue_operations", 0)),
            maior_atraso_dias=int(d.get("max_overdue_days", 0)),
        )


# ─────────────────────────────────────────────────────────────────────────────
# 4. Receita Federal + Serasa PJ (empregador)
#    Variáveis: RECEITA_BASE_URL, RECEITA_API_KEY, SERASA_API_KEY (reutiliza)
# ─────────────────────────────────────────────────────────────────────────────

class EmpregadorAdapter(BureauAdapter[DadosEmpregadorBureau]):
    nome = "empregador"
    obrigatorio = False

    def __init__(self):
        self.receita_base = os.environ.get("RECEITA_BASE_URL", "").rstrip("/")
        self.receita_key = os.environ.get("RECEITA_API_KEY", "")
        self.serasa_base = os.environ.get("SERASA_BASE_URL", "").rstrip("/")
        self.serasa_key = os.environ.get("SERASA_API_KEY", "")

    async def consultar(self, cpf: str, cnpj: str = "", **_) -> DadosEmpregadorBureau:
        if not cnpj:
            raise ValueError("CNPJ do empregador é obrigatório")

        # Consultas em paralelo
        receita_task = self._consulta_receita(cnpj)
        serasa_task = self._consulta_serasa_pj(cnpj)
        receita, serasa = await asyncio.gather(receita_task, serasa_task,
                                               return_exceptions=True)

        def parse_date(s):
            try:
                return dt.date.fromisoformat(str(s)[:10])
            except Exception:
                return None

        # Receita Federal
        rf = receita if not isinstance(receita, Exception) else {}
        situacao = rf.get("situacao", {}).get("descricao", "DESCONHECIDA")
        abertura = parse_date(rf.get("abertura"))
        porte = rf.get("porte", {}).get("descricao", "DESCONHECIDO")
        cnae = rf.get("atividade_principal", [{}])[0].get("code", "")

        # Serasa PJ
        sp = serasa if not isinstance(serasa, Exception) else {}
        score_pj = int(sp.get("score", {}).get("value", 500))
        protestos = int(sp.get("protests", {}).get("count", 0))
        acoes_trab = int(sp.get("labor_lawsuits", {}).get("count", 0))

        return DadosEmpregadorBureau(
            cnpj=cnpj, razao_social=rf.get("nome", ""),
            situacao_receita=situacao, data_abertura=abertura,
            porte=porte, cnae_principal=cnae,
            score_serasa_pj=score_pj, protestos_pj=protestos,
            acoes_trabalhistas=acoes_trab,
            disponivel=not isinstance(receita, Exception),
        )

    async def _consulta_receita(self, cnpj: str) -> dict:
        async with httpx.AsyncClient(timeout=TIMEOUT) as c:
            r = await c.get(
                f"{self.receita_base}/cnpj/{cnpj}",
                headers={"Authorization": f"Bearer {self.receita_key}"},
            )
            r.raise_for_status()
            return r.json()

    async def _consulta_serasa_pj(self, cnpj: str) -> dict:
        async with httpx.AsyncClient(timeout=TIMEOUT) as c:
            r = await c.get(
                f"{self.serasa_base}/companies/{cnpj}/credit-report",
                headers={"Authorization": f"Bearer {self.serasa_key}"},
            )
            r.raise_for_status()
            return r.json()
