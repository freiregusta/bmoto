# Modelo Financeiro BMoto — conclusões (25/08/2026)

## A descoberta

Modelando a economia unitária, a BMoto **não atinge o ROE mínimo** vivendo
só do ágio da cessão: consignado a 1,99% a.m. cedido a 1,50% rende ~9% a.a.
— pior que CDI.

Duas correções fecharam a conta:

1. **A originadora tem DUAS receitas.** O ágio da cessão e a **comissão de
   originação** paga pela liquidante. O mercado paga 1–6% do principal no
   consignado (contrato novo chega a 6–10%). Sem ela o negócio não existe.
2. **Custo de originação é único, não mensal.** O `opex_am`/`tax_am` da
   config são componentes da TAXA ao cliente; num modelo
   originate-to-distribute a carteira é vendida na originação, então não há
   custo mensal correndo por 24 meses.

## Estrutura recomendada

| Alavanca | Valor | Racional |
|---|---|---|
| Comissão de originação | **4%** | Meio da faixa de mercado; cláusula central do contrato com a Fibra |
| Subordinação retida | **7,5%** | Colchão total de 15% (mercado 10–20%); metade em mezanino |
| Taxa de aquisição FIDC | **1,45% a.m.** | Alavanca nº1: 0,10 p.p. ≈ 4 p.p. de ROE |
| Custo de originação | **≤ R$ 100** | Viável com a automação já construída |

**Resultado: ROE de 31,8% a.a.** (piso 20%, alvo 35%).

## Viabilidade

- Breakeven: **150 operações/mês** (~R$ 900 mil de volume) — mês 4 com crescimento de 10% a.m.
- Capital necessário em 24 meses: **~R$ 4,8 mi** (quase todo em subordinação, não em caixa)
- Resultado acumulado em 24 meses: **~R$ 3,5 mi**

## Implicações estratégicas

1. **A negociação da comissão com a Fibra é a conversa mais importante da empresa.**
   É a diferença entre 9% e 32% de ROE.
2. **Crédito pessoal (3,99%) é o motor de margem** — ROE > 100% na simulação.
   Consignado é produto de entrada e relacionamento; pessoal é onde a margem aparece.
3. **Cada 0,10 p.p. na taxa de cessão vale ~4 p.p. de ROE** — funding barato
   para o fundo é literalmente o negócio.

Planilha viva: `BMoto-modelo-financeiro.xlsx` (premissas, unit economics,
projeção 24m, sensibilidade). Implementado em `agents/pedro.py::roe_operacao`.
