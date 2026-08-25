# Auditoria da Esteira de Originação — 25/08/2026

Status por etapa (REAL = código funcional | ESQUELETO = pronto p/
credenciais | fechado nesta data ✔):

| Etapa | Status | Observação |
|---|---|---|
| Máquina de estados + gate averbação→Pix | REAL | 13+ estados, guards HMAC/mTLS/IP |
| Scorecard 2D + decision engine + PD | REAL | + fator de pontualidade de repasse |
| Pricing CET 4.881 + risk-based | REAL | spread ROE pendente de capital_ratio |
| Contabilidade + cessão FIDC | REAL | razão in-memory (persistir) |
| Bureaus (Dataprev/Serasa/SCR/Empregador) | ESQUELETO | adapters reais aguardam credenciais |
| Leilão Dataprev | ESQUELETO | MockLeilaoClient ativo; auth mTLS TODO |
| KYC | ✔ FECHADO | provider plugável (mock + CAF skeleton), /kyc/executar |
| Formalização CCB | ✔ FECHADO | título emitido: numeração BMT-AAAA-NNNNNN, PDF, SHA-256, cartório |
| Assinatura eletrônica | ESQUELETO | evidência registrada; plataforma (Clicksign) a contratar |
| Desembolso Pix | ✔ FECHADO | PSP plugável (mock + Celcoin skeleton), idempotência por operação |
| Conciliação de repasse + cobrança | REAL | monitor + Bia + Portal RH |

Próximos (dependem de contratação/licença): homologação BaaS (destrava
bureaus+leilão+averbação+Pix), contrato Clicksign, contrato KYC,
persistência SQL de cartório CCB/ordens Pix/monitor.
