"""
demo.py — Roda a esteira ponta-a-ponta com tomadores de exemplo.

    python3 demo.py
"""
from __future__ import annotations

from models import WorkerData, CreditRequest, Vinculo
from credit_engine import CreditEngine
from pricing_engine import PricingEngine
from dataprev_client import MockLeilaoClient
from orchestrator import Originadora


def brl(x: float) -> str:
    return f"R$ {x:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")


def pct(x: float, casas: int = 3) -> str:
    return f"{x*100:.{casas}f}%"


def linha(c="-", n=70):
    print(c * n)


def mostra(res):
    d = res.decision
    print(f"\nProposta {res.proposal_id}  |  status final: {res.final_status}")
    linha()
    print(f"  Decisão: {d.status.value}  | PD={pct(d.pd,1)}  score={d.score:.0f}")
    if d.reasons:
        print(f"  Motivos: {', '.join(d.reasons)}")
    if res.pricing:
        p = res.pricing
        print(f"  Liberado:      {brl(p.liberado)}")
        print(f"  Principal fin.:{brl(p.principal_financiado)}  "
              f"(IOF {brl(p.iof)} + seguro {brl(p.seguro)})")
        print(f"  Parcela:       {brl(p.parcela)} x {p.prazo_meses}")
        print(f"  Taxa:          {pct(p.taxa_am)} a.m.  ({pct(p.taxa_aa,2)} a.a.)")
        print(f"  CET:           {pct(p.cet_am)} a.m.  ({pct(p.cet_aa,2)} a.a.)")
        comp = p.componentes
        print("  Composição do preço (a.m.): "
              + "  ".join(f"{k}={pct(v)}" for k, v in comp.items()
                          if k != "taxa_am_final"))
        if p.notes:
            print(f"  ⚠ {' | '.join(p.notes)}")
    if res.auction:
        print(f"  Leilão:        {res.auction.status.value}"
              + (f"  ({res.auction.error_message})" if res.auction.error_message else ""))
    if res.aceito is not None:
        print(f"  Aceite tomador:{'sim' if res.aceito else 'não'}")
    if res.emissao:
        print(f"  Emissão:       {' → '.join(res.emissao)}")


def main():
    # Massa de exemplo (substitua pelos dados reais que a Dataprev devolve)
    tomadores = [
        ("Bom pagador CLT", WorkerData(
            cpf="11111111111", nome="Ana Souza", idade=41, vinculo=Vinculo.CLT,
            empregador_cnpj="00000000000191", renda_liquida=4800,
            margem_disponivel=560, meses_de_empresa=54, fgts_saldo=9000,
            comprometimento_renda_total=0.18), 8000, 24),
        ("Curto de margem", WorkerData(
            cpf="22222222222", nome="Bruno Lima", idade=29, vinculo=Vinculo.CLT,
            empregador_cnpj="00000000000191", renda_liquida=2600,
            margem_disponivel=120, meses_de_empresa=14, fgts_saldo=1500,
            comprometimento_renda_total=0.33), None, 36),
        ("Consignado ativo (SCR)", WorkerData(
            cpf="33333333333", nome="Carla Dias", idade=37, vinculo=Vinculo.CLT,
            empregador_cnpj="00000000000191", renda_liquida=5200,
            margem_disponivel=500, meses_de_empresa=30, fgts_saldo=12000,
            possui_consignado_ativo=True, comprometimento_renda_total=0.22), 6000, 24),
        ("Pouco tempo de casa", WorkerData(
            cpf="44444444444", nome="Diego Reis", idade=24, vinculo=Vinculo.CLT,
            empregador_cnpj="00000000000191", renda_liquida=2200,
            margem_disponivel=300, meses_de_empresa=3, fgts_saldo=800,
            comprometimento_renda_total=0.15), 3000, 18),
    ]

    originadora = Originadora(MockLeilaoClient(n_concorrentes=3, seed=6))

    print("\n=== ESTEIRA CRÉDITO DO TRABALHADOR — ORIGINADORA (sandbox) ===")
    for rotulo, w, valor, prazo in tomadores:
        print(f"\n### {rotulo}")
        req = CreditRequest(proposal_id=f"PROP-{w.cpf[:4]}", worker=w,
                            valor_solicitado=valor, prazo_meses=prazo)
        res = originadora.processar(req)
        mostra(res)

    linha("=")
    print("Backend de leilão: MOCK. Troque por DataprevHttpClient na homologação.")


if __name__ == "__main__":
    main()
