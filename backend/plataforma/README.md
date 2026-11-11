# plataforma — a camada plugável do BMoto

Tudo que o ecossistema vende passa por aqui. O objetivo é um só: **trocar
fornecedor, criar produto e mudar jornada sem deploy**.

```bash
cd backend
python -m pytest plataforma -q --asyncio-mode=auto     # 51 testes
python -m plataforma.seeds                             # carga inicial do catálogo
uvicorn api:app --port 8000
```

## As cinco peças

| Arquivo | Papel |
| --- | --- |
| `ports.py` | contratos (Protocols) que a aplicação enxerga: conta, cartão, kyc, crédito, seguro, saúde, contador, renda |
| `adapters/` | implementações: `mock` (demo), `rest` (configurável pela tela), `celcoin` (nativo) |
| `catalogo.py` | o que o admin cadastra: conexões, produtos de crédito, apps de entrega, módulos |
| `jornadas.py` | definição e execução das jornadas (passos, condições, estado) |
| `registry.py` | resolve quem atende cada port e qual módulo está ligado |

O resto do backend fala **só com os ports**. Nenhum arquivo de produto importa
`httpx` nem conhece o nome de um fornecedor.

## Como um fornecedor novo entra

**Sem código** (preferido): `POST /admin/conexoes` com `tipo: "rest"` e um JSON
descrevendo a API do fornecedor — URL base, autenticação e as operações. As
operações declaradas viram as *capabilities* dele, e `GET /platform/verificar`
já acusa se algum módulo ligado pede algo que ele não faz.

```jsonc
{
  "port": "conta", "tipo": "rest", "titulo": "Novo BaaS",
  "escopo": "produto:cartao",            // global, ou só neste módulo
  "config": {
    "base_url": "https://sandbox.fornecedor.com",
    "auth": { "tipo": "oauth2_client_credentials", "token_url": "/oauth/token",
              "env_client_id": "FORN_ID", "env_client_secret": "FORN_SECRET" },
    "operacoes": {
      "abrir_conta": { "metodo": "POST", "path": "/v1/accounts",
                       "body": { "documentNumber": "{cpf}", "fullName": "{nome}" },
                       "resposta": { "conta_id": "data.id", "numero": "data.number" } },
      "saldo": { "metodo": "GET", "path": "/v1/accounts/{conta_id}/balance",
                 "resposta": { "valor": "data.available" } }
    }
  }
}
```

**Com código**, quando a API é peculiar demais: escreva a classe implementando
o Protocol (veja `adapters/celcoin.py`), registre em `adapters/__init__.py` e
ela aparece no formulário do admin.

> Segredo nunca entra no banco: a config guarda o **nome** da variável de
> ambiente, e o valor é lido do ambiente na hora da chamada.

## Resolução de fornecedor

```
conexão do módulo (escopo produto:<id>)  >  conexão global  >  variável de ambiente  >  mock
```

Entre conexões do mesmo escopo vence a de menor `prioridade`. A variável de
ambiente existe para emergência (desligar algo às pressas sem depender do
banco) e o painel mostra a origem de cada decisão.

## Produtos de crédito

Um molde paramétrico cobre cartão, financiamento de moto, crédito pessoal,
antecipação e consignado: taxa, prazo, ticket, garantia/LTV, política (score,
renda, comprometimento, idade, MEI, KYC, meses de histórico), TAC, emissor e
forma de cobrança. `ProdutoCredito.avaliar()` é a política — o motor de
jornada chama ela no passo de oferta, e
`POST /admin/produtos-credito/{id}/simular` é a mesma função, para testar
antes de publicar.

## Jornadas

Lista ordenada de passos. Tipos: `formulario`, `consentimento`, `kyc`,
`conectar_app`, `renda`, `oferta`, `escolha`, `assinatura`, `provisionar`,
`revisao_manual`, `mensagem`. Os quatro automáticos (`kyc`, `renda`, `oferta`,
`provisionar`) o backend resolve sozinho.

Cada passo pode ter uma `condicao` avaliada **sem `eval`**:

```
renda_media >= 1800        oferta.aprovado == true        cnpj_mei
renda_media >= 1800 e tem_mei == true
```

Salvar uma jornada cria uma versão nova; execuções em andamento continuam na
versão antiga.

## Endpoints

| Rota | Para quê |
| --- | --- |
| `GET /platform/modules` | manifestos que o app consome |
| `GET /platform/providers`, `/health`, `/verificar` | estado dos fornecedores |
| `POST /platform/conta/*`, `/kyc`, `/seguro/*`, `/mei/*`, `/renda/*` | operações dos produtos |
| `GET /jornadas/modulo/{id}`, `POST /jornadas/{id}/iniciar`, `/execucao/{id}/avancar` | execução de jornada |
| `/admin/*` | o console inteiro (protegido por `X-Admin-Token`) |

## Variáveis

| Variável | Para quê |
| --- | --- |
| `ADMIN_TOKEN` | protege `/admin`. Em `AMBIENTE=producao` o painel fica indisponível sem ele |
| `BAAS_CONTA_PROVIDER`, `KYC_PROVIDER`, … | override de emergência por port |
| `PRODUTO_<ID>` (`on`/`off`) | liga ou desliga um módulo acima do painel |
| `BAAS_BASE_URL`, `BAAS_CLIENT_ID`, `BAAS_CLIENT_SECRET` | credenciais do adapter Celcoin |

## O consignado CLT

Continua inteiro no código (esteira, leilão Dataprev, portal RH) e no
catálogo, **desligado**. Volta com `PRODUTO_CONSIGNADO_CLT=on` ou pelo painel,
em Módulos.
