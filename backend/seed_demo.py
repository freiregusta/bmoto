"""
seed_demo.py — Popula o ambiente com uma carteira de demonstração.

    python3 seed_demo.py            # popula
    python3 seed_demo.py --limpar   # apaga o banco auxiliar e repopula

Cria uma operação ponta a ponta por tomador (crédito → pricing → leilão →
aceite → KYC → CCB emitida e assinada → averbação → Pix → contabilização),
e um histórico de repasses por empregador com os três perfis que importam
para a demo:

  * ACME (bom pagador)      — 100% pontual  → bonifica o Score Empregador
  * Beta (falha operacional)— atrasos por não escrituração → cobrança ao EMPREGADOR
  * Gama (misto)            — inclui atraso do trabalhador → cobrança ao CPF

Serve para demonstrar admin, Portal RH, agentes (Rita/Pedro/Bia), CCB e
régua de cobrança sem depender da licença/homologação.
"""

from __future__ import annotations

import os
import sys
import datetime as dt

from models import WorkerData, CreditRequest, Vinculo
from dataprev_client import MockLeilaoClient
from orchestrator import Originadora
from repasse_monitor import MONITOR, ParcelaEsperada, CausaProvavel

CNPJ_ACME = "11222333000144"
CNPJ_BETA = "55666777000188"
CNPJ_GAMA = "99888777000166"

CODIGO_IF_DEMO = os.getenv("CODIGO_IF", "A_DEFINIR")


def tomadores() -> list[tuple[WorkerData, float, int, str]]:
    """(worker, valor solicitado, prazo, produto)"""
    return [
        (WorkerData(cpf="11111111111", nome="Ana Souza", idade=41,
                    vinculo=Vinculo.CLT, empregador_cnpj=CNPJ_ACME,
                    renda_liquida=4800, margem_disponivel=560,
                    meses_de_empresa=54, fgts_saldo=9000,
                    comprometimento_renda_total=0.18), 6000.0, 24, "consignado_privado"),
        (WorkerData(cpf="22222222222", nome="Bruno Lima", idade=33,
                    vinculo=Vinculo.CLT, empregador_cnpj=CNPJ_ACME,
                    renda_liquida=3600, margem_disponivel=420,
                    meses_de_empresa=28, fgts_saldo=5200,
                    comprometimento_renda_total=0.22), 4000.0, 18, "consignado_privado"),
        (WorkerData(cpf="44444444444", nome="Diego Alves", idade=29,
                    vinculo=Vinculo.CLT, empregador_cnpj=CNPJ_BETA,
                    renda_liquida=3100, margem_disponivel=360,
                    meses_de_empresa=15, fgts_saldo=3100,
                    comprometimento_renda_total=0.25), 3500.0, 18, "consignado_privado"),
        (WorkerData(cpf="55555555555", nome="Elisa Prado", idade=45,
                    vinculo=Vinculo.CLT, empregador_cnpj=CNPJ_GAMA,
                    renda_liquida=7200, margem_disponivel=900,
                    meses_de_empresa=96, fgts_saldo=21000,
                    comprometimento_renda_total=0.12), 12000.0, 36, "consignado_privado"),
        (WorkerData(cpf="66666666666", nome="Felipe Rocha", idade=38,
                    vinculo=Vinculo.CLT, empregador_cnpj=CNPJ_GAMA,
                    renda_liquida=5400, margem_disponivel=640,
                    meses_de_empresa=41, fgts_saldo=11000,
                    comprometimento_renda_total=0.20), 8000.0, 24, "financiamento_moto"),
    ]


def rodar_esteira() -> list:
    """Executa a esteira completa para cada tomador."""
    # Leilão favorável e determinístico: a demo precisa de operações vivas,
    # não de sorteio. Concorrentes mais caros, sem erro Dataprev, aceite alto.
    leilao = MockLeilaoClient(n_concorrentes=1, seed=7,
                              prob_erro_dataprev=0.0, prob_aceite_tomador=1.0)
    leilao._concorrente = lambda base: base.monthly_cet * 1.20
    orig = Originadora(client=leilao)
    resultados = []
    for idx, (w, valor, prazo, _produto) in enumerate(tomadores(), start=1):
        req = CreditRequest(proposal_id=f"DEMO-{idx:03d}", worker=w,
                            valor_solicitado=valor, prazo_meses=prazo)
        try:
            res = orig.processar(req)
            resultados.append(res)
            print(f"  {w.nome:14s} → {getattr(res, 'final_status', '?')}")
        except Exception as exc:  # noqa: BLE001
            print(f"  {w.nome:14s} → ERRO: {exc}")
    return resultados


def semear_repasses() -> None:
    """Histórico de repasses com os três perfis de empregador."""
    hoje = dt.date.today()

    def comp(delta: int) -> str:
        m = hoje.month - delta
        a = hoje.year
        while m <= 0:
            m += 12
            a -= 1
        return f"{a:04d}-{m:02d}"

    # ACME: 6 competências, todas pagas → pontualidade 100%
    for i, cpf in enumerate(["11111111111", "22222222222"]):
        for d in range(1, 4):
            pid = f"DEMO-ACME-{i}-{d}"
            MONITOR.registrar_esperada(ParcelaEsperada(
                pid, CNPJ_ACME, comp(d), d, 450.0 + i * 30,
                cpf=cpf, codigo_if=CODIGO_IF_DEMO))
            MONITOR.conciliar(pid, comp(d), 450.0 + i * 30)

    # Beta: não escriturou → atrasos de causa operacional (cobrança ao empregador)
    for d in range(1, 4):
        pid = f"DEMO-BETA-{d}"
        MONITOR.registrar_esperada(ParcelaEsperada(
            pid, CNPJ_BETA, comp(d), d, 320.0, cpf="44444444444",
            codigo_if=CODIGO_IF_DEMO))
    # Gama: 4 pagas, 1 atraso do trabalhador, 1 falha de integração
    for d in range(1, 5):
        pid = f"DEMO-GAMA-OK-{d}"
        MONITOR.registrar_esperada(ParcelaEsperada(
            pid, CNPJ_GAMA, comp(d), d, 700.0, cpf="55555555555",
            codigo_if=CODIGO_IF_DEMO))
        MONITOR.conciliar(pid, comp(d), 700.0)
    MONITOR.registrar_esperada(ParcelaEsperada(
        "DEMO-GAMA-TRAB", CNPJ_GAMA, comp(1), 5, 700.0,
        cpf="55555555555", codigo_if=CODIGO_IF_DEMO))
    MONITOR.registrar_esperada(ParcelaEsperada(
        "DEMO-GAMA-INTEG", CNPJ_GAMA, comp(2), 3, 410.0,
        cpf="66666666666", codigo_if=CODIGO_IF_DEMO))

    MONITOR.marcar_atrasos()
    MONITOR.classificar("DEMO-BETA-1", comp(1), CausaProvavel.SEM_ESCRITURACAO)
    MONITOR.classificar("DEMO-BETA-2", comp(2), CausaProvavel.SEM_ESCRITURACAO)
    MONITOR.classificar("DEMO-BETA-3", comp(3), CausaProvavel.ESCRITURADO_SEM_RECOLHIMENTO)
    MONITOR.classificar("DEMO-GAMA-TRAB", comp(1), CausaProvavel.TRABALHADOR)
    MONITOR.classificar("DEMO-GAMA-INTEG", comp(2), CausaProvavel.FALHA_INTEGRACAO)


def main() -> None:
    if "--limpar" in sys.argv:
        for f in ("originadora_aux.db", "originadora.db"):
            if os.path.exists(f):
                os.remove(f)
                print(f"removido: {f}")
        print("Reinicie o processo para repopular (módulos já hidratados).")
        return

    print("\n=== Seed de demonstração BMoto ===\n")
    print("Esteira de originação:")
    rodar_esteira()
    print("\nHistórico de repasses:")
    semear_repasses()
    ag = MONITOR.aging()
    print(f"  parcelas: {ag['parcelas_total']} | atrasadas: {ag['parcelas_atrasadas']} "
          f"| inadimplência: {ag['inadimplencia_pct']}%")
    print(f"  por causa: {ag['por_causa']}")
    for cnpj, nome in ((CNPJ_ACME, "ACME"), (CNPJ_BETA, "Beta"), (CNPJ_GAMA, "Gama")):
        s = MONITOR.score_repasse_empregador(cnpj)
        print(f"  {nome:5s} ({cnpj}): pontualidade {s.get('taxa_pontualidade')}")
    print("\nPronto. Explore em /docs, /operacoes, /portal-rh/{cnpj}/pendencias "
          "e /agents/ask.\n")


if __name__ == "__main__":
    main()
