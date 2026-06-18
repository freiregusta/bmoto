"""
credit/adapters/mock.py — Adapters de sandbox (sem chamadas reais).

Gera dados determinísticos a partir do CPF para testes reproduzíveis.
Simula latência, timeouts e indisponibilidade configuráveis.
"""
from __future__ import annotations
import asyncio
import datetime as dt
import hashlib
import random
from typing import Optional

from credit.adapters.base import BureauAdapter
from credit.models import (
    DadosDataprev, DadosSerasa, DadosSCR, DadosEmpregadorBureau,
    DadosEmpregador, EmprestimoVincendo, CategoriaWorker, SituacaoEmprego,
)


def _seed(cpf: str, salt: str = "") -> random.Random:
    """RNG determinístico por CPF+salt — mesma entrada, mesmo resultado."""
    h = hashlib.md5((cpf + salt).encode()).hexdigest()
    return random.Random(int(h[:8], 16))


class MockDataprevAdapter(BureauAdapter[DadosDataprev]):
    nome = "dataprev_mock"
    obrigatorio = True

    def __init__(self, latencia_s: float = 0.05, prob_timeout: float = 0.0):
        self.latencia = latencia_s
        self.prob_timeout = prob_timeout

    async def consultar(self, cpf: str, **_) -> DadosDataprev:
        await asyncio.sleep(self.latencia)
        r = _seed(cpf, "dataprev")

        if r.random() < self.prob_timeout:
            raise TimeoutError("Dataprev sandbox: timeout simulado")

        # Perfis variados baseados no CPF
        cenario = int(cpf[-1]) % 5   # 0..4

        categorias = [CategoriaWorker.CLT, CategoriaWorker.CLT,
                      CategoriaWorker.CLT, CategoriaWorker.DOMESTICO,
                      CategoriaWorker.RURAL]
        categoria = categorias[cenario]

        renda_bruta = r.uniform(2200, 12000)
        margem_base = renda_bruta * 0.35        # 35% da renda bruta
        consignado_ativo = r.uniform(0, margem_base * 0.6) if cenario < 3 else 0
        margem_disp = max(margem_base - consignado_ativo, 0)

        meses_empresa = r.randint(3, 120)
        admissao = dt.date.today() - dt.timedelta(days=meses_empresa * 30)

        situacao = SituacaoEmprego.ATIVO
        if cenario == 4:
            situacao = SituacaoEmprego.AVISO_PREVIO

        emprestimos = []
        if consignado_ativo > 0:
            emprestimos.append(EmprestimoVincendo(
                modalidade="CONSIGNADO",
                saldo_devedor=consignado_ativo * r.randint(6, 24),
                parcela_mensal=consignado_ativo,
                parcelas_restantes=r.randint(6, 24),
                credor="Banco Mock",
            ))

        return DadosDataprev(
            cpf=cpf,
            nome=f"Tomador Teste {cpf[-4:]}",
            data_nascimento=dt.date(1985 + cenario, 3 + cenario, 15),
            sexo="M" if cenario % 2 == 0 else "F",
            categoria=categoria,
            pep=(cenario == 3),  # cenário 3 = PEP
            elegivel=(cenario != 4),
            motivo_inelegibilidade="Aviso prévio em curso" if cenario == 4 else "",
            empregador=DadosEmpregador(
                cnpj=f"0000000000{cenario:04d}91",
                nome=f"Empresa Mock {cenario}",
                codigo_inscricao=f"EMP{cenario:04d}",
            ),
            matricula=f"MAT{cpf[:6]}",
            data_admissao=admissao,
            situacao=situacao,
            valor_total_vencimentos=renda_bruta,
            valor_base_margem=margem_base,
            valor_margem_disponivel=margem_disp,
            quantidade_emprestimos_ativos=len(emprestimos),
            emprestimos=emprestimos,
        )


class MockSerasaAdapter(BureauAdapter[DadosSerasa]):
    nome = "serasa_mock"
    obrigatorio = False

    def __init__(self, latencia_s: float = 0.08, prob_timeout: float = 0.0):
        self.latencia = latencia_s
        self.prob_timeout = prob_timeout

    async def consultar(self, cpf: str, **_) -> DadosSerasa:
        await asyncio.sleep(self.latencia)
        r = _seed(cpf, "serasa")

        if r.random() < self.prob_timeout:
            raise TimeoutError("Serasa sandbox: timeout simulado")

        cenario = int(cpf[-1]) % 5
        score_base = [820, 650, 450, 300, 750][cenario]
        score = max(0, min(1000, score_base + r.randint(-50, 50)))
        neg = [0, 0, 2, 4, 0][cenario]

        return DadosSerasa(
            cpf=cpf,
            score=score,
            negativacoes_ativas=neg,
            acoes_judiciais=1 if cenario == 3 else 0,
            cheques_sem_fundo=0,
            meses_sem_negativacao=0 if neg > 0 else r.randint(12, 60),
            disponivel=True,
        )


class MockSCRAdapter(BureauAdapter[DadosSCR]):
    nome = "scr_mock"
    obrigatorio = True

    def __init__(self, latencia_s: float = 0.06, prob_timeout: float = 0.0):
        self.latencia = latencia_s
        self.prob_timeout = prob_timeout

    async def consultar(self, cpf: str, **_) -> DadosSCR:
        await asyncio.sleep(self.latencia)
        r = _seed(cpf, "scr")

        if r.random() < self.prob_timeout:
            raise TimeoutError("SCR sandbox: timeout simulado")

        cenario = int(cpf[-1]) % 5
        atraso = [0, 0, 30, 90, 0][cenario]

        return DadosSCR(
            cpf=cpf,
            divida_total_ifs=r.uniform(0, 50000) if cenario > 1 else 0,
            operacoes_ativas=r.randint(0, 3),
            operacoes_vencidas=1 if atraso > 0 else 0,
            maior_atraso_dias=atraso,
            disponivel=True,
        )


class MockEmpregadorAdapter(BureauAdapter[DadosEmpregadorBureau]):
    nome = "empregador_mock"
    obrigatorio = False

    def __init__(self, latencia_s: float = 0.07, prob_timeout: float = 0.0):
        self.latencia = latencia_s
        self.prob_timeout = prob_timeout

    async def consultar(self, cpf: str, cnpj: str = "", **_) -> DadosEmpregadorBureau:
        await asyncio.sleep(self.latencia)
        r = _seed(cnpj or cpf, "pj")

        if r.random() < self.prob_timeout:
            raise TimeoutError("Empregador sandbox: timeout simulado")

        cenario = int((cnpj or cpf)[-1]) % 5
        score_pj = [800, 700, 550, 300, 750][cenario]
        situacao = "ATIVA" if cenario != 3 else "INAPTA"

        abertura = dt.date.today() - dt.timedelta(
            days=r.randint(365, 365 * 20))

        return DadosEmpregadorBureau(
            cnpj=cnpj or "00000000000191",
            razao_social=f"Empresa Mock {cenario} Ltda",
            situacao_receita=situacao,
            data_abertura=abertura,
            porte=["ME", "EPP", "DEMAIS", "ME", "EPP"][cenario],
            cnae_principal=["4711301", "4722901", "6202300", "8111700", "4921301"][cenario],
            score_serasa_pj=score_pj,
            protestos_pj=2 if cenario == 3 else 0,
            acoes_trabalhistas=r.randint(0, 3),
            disponivel=True,
        )
