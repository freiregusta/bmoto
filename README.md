# BMoto — Crédito do Trabalhador

Plataforma de originação de consignado privado (Crédito do Trabalhador).

```
bmoto/
├── backend/     Python (FastAPI) — motores de crédito, pricing, esteira
└── frontend/    React + Tailwind — jornada do tomador e dashboard
```

## Arquitetura

```
bmoto.com.br          (Lovable / Vercel)   — frontend React
api.bmoto.com.br      (Render)             — backend Python + webhooks
                      (Render Postgres)     — estado das operações
```

O frontend faz `fetch` na API. O Python nunca vai ao Lovable.
Os webhooks do leilão, Dataprev e Pix batem direto no backend.

## Deploy rápido

### Backend (Render)

1. Acesse [render.com](https://render.com) → New → Blueprint
2. Aponte para este repositório — o `backend/render.yaml` cria tudo automaticamente
3. Configure as variáveis de ambiente:
   - `CORS_ORIGINS=https://bmoto.com.br`
   - `ENTRY_URL=https://bmoto.com.br/formalizacao`
   - `WEBHOOK_HMAC_SECRET` (gerado automaticamente pelo Blueprint)
4. Após o deploy, adicione o domínio customizado `api.bmoto.com.br`
5. No DNS: CNAME `api` → `sua-app.onrender.com`
6. Teste: `https://api.bmoto.com.br/health`

### Frontend (Lovable)

1. Acesse [lovable.dev](https://lovable.dev) → New Project
2. Conecte este repositório GitHub em Settings → GitHub
3. Aponte a pasta `frontend/` como raiz do projeto
4. Adicione as variáveis de ambiente:
   - `VITE_API_URL=https://api.bmoto.com.br`
   - `VITE_DASHBOARD_PASSWORD=sua-senha`
5. Em Settings → Custom Domain: adicione `bmoto.com.br`
6. No DNS: siga as instruções do Lovable (CNAME ou A record)

### Desenvolvimento local

```bash
# Backend
cd backend
pip install -r requirements.txt
uvicorn api:app --reload
# API em http://localhost:8000

# Frontend (outro terminal)
cd frontend
npm install
echo "VITE_API_URL=http://localhost:8000" > .env.local
npm run dev
# Front em http://localhost:5173
```

## Telas

| Rota | Descrição |
|---|---|
| `/formalizacao?proposal_id=X` | Jornada do tomador: oferta → KYC → CCB → conclusão |
| `/dashboard` | Dashboard do originador: KPIs + tabela + linha do tempo |

## Endpoints da API

| Método | Rota | Origem |
|---|---|---|
| POST | `/webhooks/leilao/solicitacao` | Plataforma → inicia operação |
| POST | `/webhooks/leilao/devolutiva/{id}` | Plataforma → resultado do leilão |
| POST | `/operacoes/{id}/aceite` | Frontend (tomador aceita) |
| POST | `/operacoes/{id}/kyc` | Frontend (KYC concluído) |
| POST | `/operacoes/{id}/ccb` | Frontend (CCB assinada) |
| POST | `/webhooks/dataprev/averbacao/{id}` | Dataprev → averbação |
| POST | `/webhooks/pix/{id}` | BaaS → liquidação |
| GET | `/operacoes/{id}` · `/operacoes` | Frontend (consulta) |

Docs interativas: `https://api.bmoto.com.br/docs`

## Próximos passos

- [ ] Trocar `MockLeilaoClient` por `DataprevHttpClient` (mTLS + certificado A1)
- [ ] Plugar provedor de KYC real (Unico / Serpro / Idwall)
- [ ] Integrar BaaS para cash-out Pix real
- [ ] Adicionar camada de contabilização/booking e cessão ao FIDC
