# Plano — BMoto, originadora de crédito para o varejo

Vamos transformar o projeto atual (blog Vesper) numa landing page institucional da **BMoto** com inspiração em teddydigital.io e uy3, mais um **painel Admin** inicial para controle de fluxo, pricing e crédito. Nesta etapa entregamos **somente o layout/frontend** — a integração real via API/GitHub entra depois, com o prompt do Claude que você vai colar.

## Direção visual (escolhida por você)

- **Paleta Neon Mint**: fundo `#0d1b2a` (azul-noite), superfícies `#1b4332`, primário `#2dd4a8`, glow `#73ffb8`. Dark-first, com acentos vibrantes ao estilo fintech moderna.
- **Tipografia**: Sora (display/headings) + Manrope (texto).
- **Layout**: full-width sections empilhadas, com bastante respiro, números grandes e blocos de prova social.
- Animação sutil com Motion (fades, slide-up no scroll, contadores nos KPIs).

## Estrutura da Landing (rota `/`)

Seções full-width, na ordem:

1. **Nav** — logo BMoto + links (Produto, Para Você, Parceiros, Admin, Contato) + CTA "Simular crédito".
2. **Hero** — headline grande ("Crédito do varejo, na hora certa, no preço certo"), subcopy, dois CTAs (Simular / Para lojistas), badge de regulação, mockup/visual do produto à direita.
3. **Faixa de números** — volume originado, taxa média, parceiros, tempo de aprovação (contadores animados).
4. **Como funciona** — 3-4 passos para o consumidor (simular → aprovar → assinar → receber).
5. **Produtos de crédito** — cards full-width alternados (CDC, Crédito Pessoal, Cartão Private Label, BNPL).
6. **Para varejistas/parceiros** — bloco B2B curto direcionando para integração.
7. **Cases & logos** — grid de logos de parceiros + 2-3 cases com métricas.
8. **Confiança/Compliance** — selos (BACEN, LGPD, SCR), segurança, governança.
9. **FAQ** — accordion com dúvidas de crédito.
10. **CTA final + Footer** — newsletter, contato, redes, copyright.

## Painel Admin (rota `/admin`)

Shell com `SidebarProvider` do shadcn, dark theme, navegação lateral colapsável. Páginas (mock data por enquanto, prontas para plugar API depois):

- `/admin` — **Dashboard**: KPIs (originação do mês, taxa de aprovação, inadimplência, ticket médio), gráfico de originação (Recharts), funil e tabela de últimas propostas.
- `/admin/propostas` — tabela de propostas com filtros (status, valor, data), drawer de detalhe.
- `/admin/pricing` — tabela editável de políticas de pricing por produto/score/prazo.
- `/admin/credito` — políticas de crédito: limites, score mínimo, regras por faixa.
- `/admin/fluxo` — visualização do fluxo de aprovação (etapas + responsáveis).
- `/admin/parceiros` — lojistas integrados, status da integração, chaves de API (placeholder).
- `/admin/configuracoes` — perfil, equipe, webhooks, tokens (placeholders).

Sem autenticação real nesta etapa — botão "Entrar" no header leva direto ao `/admin` mockado. Quando você trouxer o prompt do Claude para integração, plugamos Lovable Cloud (auth + DB) e ligamos as telas em dados reais.

## Detalhes técnicos

- **Design tokens** em `src/index.css` e `tailwind.config.ts`: substituir paleta atual pelos HSL da Neon Mint, redefinir `--primary`, `--background`, `--foreground`, `--card`, `--accent`, sombras (`--shadow-glow`) e gradientes (`--gradient-hero`, `--gradient-mint`). Fontes Sora/Manrope via `<link>` no `index.html` e mapeadas em `fontFamily` do Tailwind.
- **Roteamento** (`src/App.tsx`): manter `/`, adicionar `/admin` com layout próprio (`AdminLayout` usando `SidebarProvider`) e rotas filhas. Remover `/article/:slug` (não faz sentido para o novo produto) — `Article.tsx` e `data/articles.ts` serão deletados.
- **Componentes novos** em `src/components/landing/`: `Nav`, `Hero`, `StatsBar`, `HowItWorks`, `Products`, `ForRetailers`, `Cases`, `Compliance`, `Faq`, `CtaFooter`.
- **Componentes admin** em `src/components/admin/`: `AppSidebar`, `KpiCard`, `OriginationChart`, `ProposalsTable`, `PricingTable`, etc. Reutilizando shadcn (`card`, `table`, `tabs`, `dialog`, `sheet`, `accordion`, `chart`).
- **Dados mockados** em `src/data/mock.ts` (propostas, pricing, parceiros, KPIs) — estrutura próxima ao que a API vai retornar para facilitar a troca.
- **Imagens**: gerar 1 visual do produto para o hero (dashboard/cartão mockup, estilo dark com glow mint) e 1 imagem secundária para a seção de varejistas.
- **SEO**: atualizar `index.html` (title "BMoto — Crédito inteligente para o varejo", meta description, OG tags), trocar favicon depois.

## Fora de escopo agora (entra na próxima etapa, com o prompt do Claude)

- Lovable Cloud (auth, DB, edge functions).
- Integração real via API / webhooks com GitHub.
- Persistência de propostas, pricing e regras de crédito.
- Roles e permissões no admin.

Quando você aprovar, eu entro em modo build e implemento tudo acima. Depois é só colar o prompt do Claude que ligamos a parte de código/API.
