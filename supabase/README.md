# Backend BMoto — Supabase

Projeto `bmoto`, região **sa-east-1 (São Paulo)**. A região não é detalhe: o
app guarda CPF e extrato bancário de pessoa física, e manter esse dado no país
é a postura certa diante da LGPD e a mais fácil de defender numa diligência de
parceiro regulado.

## O que está onde

```
supabase/
  functions/
    _compartilhado/     a conta, em um só lugar
      classificador.ts  o que, no extrato, é repasse de app de entrega
      financeiro.ts     renda, custo por km, margem líquida
      politica.ts       motor de crédito (parcela, CET, limite, decisão)
      teste.ts          imprime os cenários em TypeScript
      teste_paridade.py imprime os MESMOS cenários no backend Python
      conferir-paridade.sh  compara os dois e falha em qualquer centavo
    extrato/            lê o extrato e vira renda comprovada
    resumo/             renda, custos e margem
    simular/            o que cabe no bolso, sobre a renda real
    apagar-conta/       direito à eliminação (LGPD art. 18, VI)
```

### Por que `_compartilhado` é copiado, e não importado

Cada edge function é publicada com os arquivos que usa. Então, antes de
publicar, os módulos de `_compartilhado/` são copiados para dentro da pasta da
função. A cópia é mecânica; o que impede divergência é o
`conferir-paridade.sh`, que roda os dois lados nos mesmos cenários.

**Sempre que mexer em `classificador.ts`, `financeiro.ts` ou `politica.ts`:**

```bash
cd functions/_compartilhado && ./conferir-paridade.sh    # tem que dizer "paridade OK"
```

O backend Python é a referência — tem 79 testes e foi conferido contra extrato
real. A conta em TypeScript existe para rodar no servidor novo, não para ter
opinião própria sobre quanto alguém ganha.

## Banco

Tabelas do titular, com RLS por `user_id = auth.uid()` — o isolamento é do
banco, não da boa vontade do app:

- `perfis` — nome, CPF, celular, e o aceite da LGPD com data e versão do texto
- `ganhos` — um lançamento por (pessoa, app, mês); relançar corrige
- `custos` — os custos de rodar, da própria pessoa
- `interesses` — lista de espera de produto que ainda não existe

Catálogo, leitura liberada para quem está logado e escrita só para admin:

- `apps_entrega` · `produtos_credito` · `modulos` · `jornadas`

E `conexoes`, que é só do admin em qualquer operação. O `config` dela guarda
**nomes de variáveis de ambiente, nunca segredos**; a view `ports_ativos`
expõe apenas se um port tem fornecedor, sem dizer qual nem com que credencial.

### Os CNPJs dos apps estão vazios de propósito

`apps_entrega.cnpjs` vem vazio. Um CNPJ errado atribui a renda de alguém à
plataforma errada, e isso é pior do que não reconhecer o repasse: quem confere
preenche no admin, com o CNPJ que viu no extrato. O reconhecimento por nome,
que dá para verificar a olho, já vem cadastrado.

## O que ainda falta configurar no painel do Supabase

1. **Authentication → Email Templates → Magic Link**: incluir `{{ .Token }}` no
   corpo. Sem isso o e-mail manda um link, e a tela do app pede 6 dígitos.
2. **Authentication → URL Configuration**: `Site URL` e `Redirect URLs` com o
   endereço publicado do app.
3. **SMTP próprio** (Resend, SES ou outro). O SMTP embutido do Supabase manda
   poucos e-mails por hora e é só para desenvolvimento — com ele, entregador de
   verdade não consegue entrar.
