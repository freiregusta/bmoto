"""
credit/tests/test_pipeline.py — Testa o pipeline completo com mocks.

    python3 -m pytest backend/credit/tests/ -v
    # ou direto:
    python3 backend/credit/tests/test_pipeline.py
"""
import asyncio
import sys
import os
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../.."))

from credit.orchestrator import consultar_bureaus
from credit.scorecard import calcular_scores
from credit.decision_engine import decidir
from credit.config import POLITICA_CREDITO as POL


# CPFs de teste: último dígito 0..4 → cenários determinísticos
CENARIOS = {
    "11111111110": "Bom pagador CLT (estável, 61 meses)",
    "22222222221": "Pouco tempo empresa (5 meses → reprovado EST)",
    "33333333332": "Negativado / risco médio",
    "44444444443": "PEP → bloqueio imediato",
    "55555555554": "Aviso prévio → bloqueio imediato",
}


async def rodar_cenario(cpf: str, label: str):
    t0 = time.perf_counter()
    pkg = await consultar_bureaus(cpf, cnpj="00000000000191")
    resultado = calcular_scores(pkg, valor_solicitado=8000.0)
    decisao = decidir(pkg, resultado, valor_solicitado=8000.0, prazo_solicitado=24)
    elapsed = time.perf_counter() - t0

    print(f"\n{'─'*65}")
    print(f"Cenário: {label} | CPF: {cpf}")
    print(f"Tempo bureaus (paralelo): {elapsed*1000:.0f}ms")
    print(f"  Score Tomador:    {resultado.score_tomador:.1f}")
    print(f"  Score Empregador: {resultado.score_empregador:.1f}")
    print(f"  Score Final:      {resultado.score_final:.1f}")
    print(f"  PD:               {resultado.pd:.1%}")
    print(f"  Fator FGTS:       {resultado.fator_fgts:.3f}")
    print(f"  Decisão:          {decisao.status.value}")
    if decisao.motivos:
        print(f"  Motivos:          {[m.codigo for m in decisao.motivos]}")
        for m in decisao.motivos:
            print(f"    [{m.bureau}] {m.descricao}")
    if decisao.aprovado:
        print(f"  Parcela máxima:   R$ {decisao.parcela_maxima:.2f}")
        print(f"  Prazo máximo:     {decisao.prazo_maximo}x")
    if pkg.bureaus_indisponiveis:
        print(f"  Bureaus absent:   {pkg.bureaus_indisponiveis}")

    # Componentes detalhados
    print(f"\n  Componentes do Tomador:")
    for c in resultado.componentes_tomador.values():
        print(f"    {c.nome:18s} {c.valor_bruto:6.1f} × {c.peso:.2f} "
              f"= {c.contribuicao:6.1f}  {c.notas[0] if c.notas else ''}")
    print(f"\n  Componentes do Empregador:")
    for c in resultado.componentes_empregador.values():
        print(f"    {c.nome:18s} {c.valor_bruto:6.1f} × {c.peso:.2f} "
              f"= {c.contribuicao:6.1f}  {c.notas[0] if c.notas else ''}")

    return decisao


async def main():
    print("=" * 65)
    print("PIPELINE DE CRÉDITO — TESTE COM MOCK BUREAUS")
    print("=" * 65)

    aprovados = 0
    reprovados = 0
    for cpf, label in CENARIOS.items():
        decisao = await rodar_cenario(cpf, label)
        if decisao.aprovado:
            aprovados += 1
        else:
            reprovados += 1

    print(f"\n{'='*65}")
    print(f"Resultado: {aprovados} aprovados, {reprovados} reprovados")
    print("Bureaus rodaram em paralelo — tempo total ≈ bureau mais lento")
    print("Para usar adapters reais: CREDIT_USE_MOCK=false")


if __name__ == "__main__":
    asyncio.run(main())
