"""
esteira_demo.py — Demonstra a máquina de estados.

    python3 esteira_demo.py
"""
from __future__ import annotations

from models import WorkerData, CreditRequest, Vinculo
from dataprev_client import MockLeilaoClient
from state_machine import (Esteira, Repository, Operation, Event, EV, S, apply,
                           IllegalTransition)


def w_bom() -> WorkerData:
    return WorkerData(cpf="11111111111", nome="Ana Souza", idade=41,
                      vinculo=Vinculo.CLT, empregador_cnpj="00000000000191",
                      renda_liquida=4800, margem_disponivel=560,
                      meses_de_empresa=54, fgts_saldo=9000,
                      comprometimento_renda_total=0.18)


def w_scr() -> WorkerData:
    return WorkerData(cpf="33333333333", nome="Carla Dias", idade=37,
                      vinculo=Vinculo.CLT, empregador_cnpj="00000000000191",
                      renda_liquida=5200, margem_disponivel=500,
                      meses_de_empresa=30, fgts_saldo=12000,
                      possui_consignado_ativo=True,
                      comprometimento_renda_total=0.22)


def trilha(op: Operation) -> str:
    passos = [op.historico[0].de.value] + [t.para.value for t in op.historico]
    return " → ".join(passos)


def linha(c="-", n=72):
    print(c * n)


def main():
    print("\n=== MÁQUINA DE ESTADOS — ESTEIRA CRÉDITO DO TRABALHADOR ===")

    # 1) Caminho feliz completo até a cessão ao FIDC -----------------------
    print("\n[1] Caminho feliz (até CEDIDA_FIDC)")
    linha()
    esteira = Esteira(MockLeilaoClient(n_concorrentes=3, seed=6))
    req = CreditRequest(proposal_id="PROP-OK", worker=w_bom(),
                        valor_solicitado=8000, prazo_meses=24)
    op = esteira.processar(req)
    print("  estado final:", op.state.value)
    print("  trilha:", trilha(op))

    # 2) Bloqueio de crédito (SCR / consignado ativo) ---------------------
    print("\n[2] Reprovado no crédito (consignado ativo no SCR)")
    linha()
    esteira2 = Esteira(MockLeilaoClient(seed=1))
    op2 = esteira2.processar(
        CreditRequest(proposal_id="PROP-SCR", worker=w_scr(),
                      valor_solicitado=6000, prazo_meses=24))
    print("  estado final:", op2.state.value)
    print("  trilha:", trilha(op2))
    print("  motivos:", op2.decision.reasons)

    # 3) Gate averbação→Pix: tentar desembolsar antes da averbação --------
    print("\n[3] Gate de segurança: Pix antes da averbação é ILEGAL")
    linha()
    # monta uma operação parada em CCB_ASSINADA (sem averbar)
    op3 = Operation(proposal_id="PROP-GATE", state=S.CCB_ASSINADA, request=req)
    op3.historico.append(  # só p/ a trilha imprimir algo
        type(op.historico[0])(S.EM_FORMALIZACAO, EV.CCB_ASSINADA, S.CCB_ASSINADA,
                              op.historico[0].at))
    try:
        apply(op3, Event(EV.PIX_ENVIADO, "tentativa-pix-fora-de-ordem"))
        print("  ERRO: o gate deixou passar (não deveria!)")
    except IllegalTransition as e:
        print("  bloqueado corretamente:", e)
    print("  -> Pix só é alcançável a partir de AVERBADA, por construção.")

    # 4) Idempotência: webhook da devolutiva reentregue -------------------
    print("\n[4] Idempotência: webhook do leilão reentregue (duplicado)")
    linha()
    esteira4 = Esteira(MockLeilaoClient(seed=6))
    op4 = Operation(proposal_id="PROP-IDEM", state=S.OFERTA_ENVIADA, request=req)
    esteira4.repo.save(op4)
    evt = Event(EV.LEILAO_APPROVED, "webhook-abc-123")
    esteira4.handle_event("PROP-IDEM", evt)
    estado_1 = op4.state.value
    esteira4.handle_event("PROP-IDEM", evt)   # mesma chave -> no-op
    estado_2 = op4.state.value
    print(f"  após 1ª entrega: {estado_1}")
    print(f"  após reentrega : {estado_2}  (sem transição duplicada)")
    print(f"  nº de transições no histórico: {len(op4.historico)} (esperado: 1)")

    linha("=")
    print("Estados de espera externa:", ", ".join(
        s.value for s in [S.OFERTA_ENVIADA, S.OFERTA_VENCEDORA, S.AVERBANDO]))
    print("Backend de leilão: MOCK. Troque por DataprevHttpClient na homologação.")


if __name__ == "__main__":
    main()
