# BMoto — Memo Estratégico H2/2026 (CEO)

Data: 25/08/2026

## Diagnóstico de mercado (pesquisa ago/2026)

- Setor em expansão: concessões de consignado CLT +183,6% em 2025
  (R$ 54,5 bi); programa movimentou R$ 117,1 bi no 1º ano (~10 mi de
  trabalhadores).
- Inadimplência do setor: ~8,6% (ago/2026). MAS ~65% dos episódios são
  falha operacional (RH↔IF ~30%, integração eSocial/Dataprev ~22%,
  desconto em folha ~13%); só ~33% é incapacidade de pagamento
  (Serasa/Salaryfits).
- Alavanca legal contra empregador que retém e não repassa: multa de 30%
  do valor retido + Termo de Débito Salarial (título executivo
  extrajudicial) — Lei 15.179/2025 art. 3º; Portaria MTE 435/2025.
- Benchmark internacional (Salary Finance UK/US; payroll lending Índia):
  desconto em folha derruba default para <0,5% vs. 2–4% do pessoal
  tradicional; canal empregador ≈ CAC próximo de zero; validação de
  vínculo com o empregador permite aprovar mais a taxas menores;
  ofertas por eventos de ciclo de vida (promoção etc.) multiplicam
  cross-sell.
- Regulador apertando: teto de CET e restrição de tarifas (abr/2026) —
  eficiência operacional vira a única margem defensável.

## Decisões

1. **Vencer no risco operacional de repasse.** Monitor de repasses por
   competência + régua de cobrança com destinatário correto (empregador
   vs. trabalhador vs. garantia FGTS), com base legal automatizada.
   Meta: inadimplência < 3% vs. 8,6% do setor → funding mais barato no
   FIDC. [ENTREGUE: `repasse_monitor.py` + agente Bia]

2. **Histórico de repasse no Score Empregador.** Pontualidade de repasse
   por CNPJ (`score_repasse_empregador`) passa a alimentar o scorecard;
   reincidente (<80%) → bloqueio de novas originações no CNPJ.
   [ENTREGUE o insumo; wiring no scorecard é o próximo PR]

3. **Canal de aquisição: RH/empregador (modelo Salary Finance).**
   Posicionamento "benefício de bem-estar financeiro" para empresas;
   CAC ≈ 0; a validação de vínculo já existe via Dataprev. Playbook do
   Gui (Growth) a desenvolver.

## KPIs do semestre

| Frente   | KPI                          | Meta       |
|----------|------------------------------|------------|
| Bia      | Inadimplência total          | < 3%       |
| Bia      | % atraso classificado <5 dias| > 95%      |
| Rita     | EL realizado / previsto      | 0,8–1,2×   |
| Pedro    | ROE por safra                | ≥ 20% a.a. (piso), alvo 35% |
| Gui      | Convênios RH ativos          | 10         |

## Pendências herdadas

- CNAME `api.bmoto.com.br`; rotação do token GitHub; confirmação de
  CAPITAL_RATIO e alíquota p/ spread de ROE (desenho do Gustavo).
