# BMoto — super app do entregador

Aplicativo modular do ecossistema financeiro do motoboy, com console de
administração. O app **não conhece produto nenhum em tempo de compilação**:
ele lê manifestos e jornadas do backend.

```bash
bun install          # ou npm install
bun run dev          # http://localhost:5173  (proxy /api -> localhost:8000)
bun run test         # 43 testes
bun run build        # tsc + vite build  (~97 KB gzip)
```

Sem backend no ar o app entra em **modo demo** (`src/platform/demo.ts`), com
os mesmos dados do seed e um motor de jornadas em memória. Serve para
demonstração e é o que os testes de interface exercitam.

## A ideia em três arquivos

| Arquivo | Papel |
| --- | --- |
| `src/platform/PlatformProvider.tsx` | carrega `/platform/modules` e governa navegação e flags |
| `src/platform/registry.ts` | mapeia `id do módulo -> tela dedicada` |
| `src/components/JornadaRunner.tsx` | tela genérica que executa a jornada de qualquer módulo |

A regra que dá a flexibilidade:

```
módulo com tela registrada  -> usa a tela dedicada
módulo sem tela registrada  -> usa o JornadaRunner (jornada montada no admin)
```

Cadastrar um produto novo no admin, com uma jornada, **já o faz funcionar no
app**. Depois, se valer a pena, escreve-se a tela dedicada e ela entra no
lugar — sem mexer em rota, navegação ou menu.

Hoje têm tela dedicada: `conta`, `ganhos`, `margem`, `mei`.
Rodam pela jornada: `moto`, `cartao`, `seguro`, `saude` — de propósito.

### Acrescentar uma tela dedicada

```tsx
// src/modules/cartao/index.tsx
export const moduloCartao: ModuleDefinition = {
  id: "cartao",                       // = id do manifesto no backend
  Component: CartaoTela,
  Resumo: CartaoResumo,               // opcional: card na tela inicial
};

// src/modules/index.ts
registrarModulos([..., moduloCartao]);
```

### Acrescentar um ícone

`src/components/icones.ts` importa só os ícones usados — importar o lucide
inteiro custa ~230 KB gzip a mais, e o app é usado na rua, em 3G. Ícone
ausente cai no `Circle`.

## Estrutura

```
src/
  platform/      manifestos, registro, jornadas, perfil, modo demo
  components/    moldura, renderizador de passos, peças de UI
  modules/       telas dedicadas (conta, ganhos, margem, mei)
  admin/         console: conexões, produtos, apps, módulos, jornadas, auditoria
  pages/         início, mais, perfil, resolvedor de módulo
```

## Console de administração (`/admin`)

- **Conexões** — cadastrar qualquer fornecedor (BaaS, seguradora, emissor,
  contabilidade, bureau) para qualquer capacidade, global ou só num módulo.
  O formulário é gerado a partir de `/admin/tipos`.
- **Produtos de crédito** — cartão, moto, pessoal, antecipação, consignado;
  todos paramétricos, com simulador que roda a política real do backend.
- **Apps de entrega** — plataformas, tipo de integração e forma de repasse.
- **Módulos** — ligar, desligar, renomear, reordenar, apontar a jornada.
- **Jornadas** — montar o passo-a-passo que o app executa.
- **Auditoria** — quem mudou o quê.

Em produção o backend exige `X-Admin-Token`; o painel guarda o token só na
sessão do navegador.

## Variáveis

| Variável | Para quê |
| --- | --- |
| `VITE_API_URL` | base da API (padrão `/api`) |
| `VITE_API_TARGET` | destino do proxy em dev (padrão `http://localhost:8000`) |
