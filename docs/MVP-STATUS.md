# BMoto — Status do MVP (25/08/2026)

## Diretriz estratégica

A BMoto não é uma originadora de crédito: é **infraestrutura de confiança
entre empregador e crédito**. O ativo defensável é o dado proprietário de
comportamento de repasse por CNPJ. Toda decisão é medida por: aumenta ou
não essa base?

## MVP — pronto para operar no dia 1 da licença

| Frente | Status |
|---|---|
| Esteira 13 estados + gate averbação→Pix | ✅ |
| Motor de crédito (scorecard 2D, PD, hard cuts) | ✅ |
| Score Empregador com pontualidade de repasse | ✅ |
| Pricing CET 4.881 + risk-based | ✅ (calibrar capital_ratio) |
| CCB real (numeração, PDF, SHA-256, cartório) | ✅ |
| KYC plugável (mock + adapter real) | ✅ |
| Pix idempotente (mock + Celcoin) | ✅ |
| Contabilidade + cessão FIDC | ✅ |
| Monitor de repasses + alerta preventivo | ✅ |
| Régua de cobrança com destinatário correto | ✅ |
| Portal RH (arquivo, checklist, prazos, pendências) | ✅ |
| Mia bilíngue cliente/RH | ✅ |
| Admin: dashboard + risco de repasse + simulador | ✅ |
| Pipeline B2B (/empresas + endpoint) | ✅ |
| Agentes internos (Rita, Pedro, Bia) | ✅ |
| Persistência SQL de todos os agregados | ✅ |
| Seed de demonstração | ✅ |
| One-pager comercial | ✅ |

## Bloqueios externos (não-engenharia)

1. **Licença para operar** — caminho crítico.
2. **Homologação BaaS/Dataprev** — destrava bureaus, leilão, averbação e Pix reais.
3. **Contratos**: plataforma de assinatura eletrônica e provedor de KYC.
4. **Definição do Gustavo**: capital_ratio e alíquota para fechar o spread de ROE.

## O que NÃO faremos (decisão de CEO)

- Competir por taxa em leilão aberto sem convênio.
- Originar em empregador sem histórico ou com pontualidade < 80%.
- Construir mais frontend antes da licença — o produto já demonstra a tese.

## Prioridade do trimestre

Pipeline de convênios. Cada empresa cadastrada hoje é dado proprietário amanhã.
