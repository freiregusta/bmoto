# Portal RH BMoto — Spec do Frontend (Lovable)

Objetivo: ser a IF mais fácil de repassar do mercado. O RH resolve a
competência em < 5 minutos.

## Rota
`/portal-rh` no site (bmoto.com.br), design system Midnight Navy + Neon
Mint (glassmorphism, Sora/Manrope). Acesso por CNPJ (fase 1: campo CNPJ
sem auth; fase 2: login do RH).

## Seções da tela

1. **Header de status** — busca por CNPJ → `GET /portal-rh/{cnpj}/pendencias`
   - Card grande: total em atraso (vermelho se > 0, mint se zerado)
   - Badge de pontualidade (taxa_pontualidade em %)

2. **Arquivo da competência** — seletor de competência (YYYY-MM) +
   botão "Baixar CSV da folha" → `GET /portal-rh/{cnpj}/competencias/{comp}/arquivo`
   - Explicar: "arquivo com rubrica 9253, CPFs formatados e código da IF"

3. **Checklist mensal** — `GET /portal-rh/{cnpj}/checklist`
   - 5 passos com checkbox local + seção "erros comuns" em accordion

4. **Calendário de prazos** — `GET /portal-rh/calendario`
   - Janela de averbação 21→20 e alerta legal (multa 30% + TDS) em tom
     informativo, não ameaçador

5. **Ajuda** — botão flutuante abre a Mia com contexto `perfil: "rh"`
   (backend: incluir no payload do chat; prompt da Mia ganha ramo RH)

## Métricas (admin)
- Downloads de arquivo por competência
- % de CNPJs com pendência zerada até o dia 20
- Tempo entre notificação e escrituração (quando integrado)

## Fora de escopo (fase 2)
- Login/auth do RH, multiempresa, webhook de confirmação de escrituração,
  integração direta com ERPs de folha (Senior, TOTVS, LG, Sólides).
