/**
 * demo.ts — o app inteiro funcionando sem backend.
 *
 * Espelha o seed do backend (plataforma/seeds.py) e executa as jornadas em
 * memória, com a mesma semântica de passos. Serve para demonstrar o produto
 * em qualquer lugar e para os testes de interface. Quando o FastAPI responde,
 * nada disto é usado.
 *
 * Importante: as regras de crédito aqui são as mesmas FÓRMULAS do backend
 * (Tabela Price, LTV, comprometimento). Política de verdade vive lá — aqui é
 * reprodução para demo, e qualquer divergência aparece no teste de contrato.
 */

import type {
  AppEntrega, Conexao, EstadoJornada, Jornada, Modulo, Oferta, Passo,
  ProdutoCredito, Resumo, TiposAdmin,
} from "./types";

// ------------------------------------------------------------------ dados

export const MODULOS_DEMO: Modulo[] = [
  m("conta", "Conta BMoto", "Conta individual com Pix, onde caem os repasses dos apps.",
    "Wallet", 10, [["conta", ["conta.abrir", "conta.saldo", "conta.extrato", "pix.enviar"]],
                   ["kyc", ["kyc.validar"]]], ["baas"]),
  m("ganhos", "Ganhos dos apps", "Integração com iFood, Rappi, 99 e Uber: renda consolidada.",
    "TrendingUp", 20, [["renda", ["renda.consentir", "renda.ler"]]], ["integracao"]),
  m("margem", "Margem líquida real", "Custo por km e o líquido de verdade por corrida.",
    "Calculator", 30, [], ["fidelizacao"]),
  m("mei", "MEI e contabilidade", "Abertura da MEI, DAS mensal, DASN anual e nota fiscal.",
    "FileText", 40, [["contador", ["mei.abrir", "mei.das", "mei.dasn"]]], ["contabil"]),
  m("moto", "Financiamento de moto", "Moto nova com parcela debitada do repasse.",
    "Bike", 50, [["credito", ["credito.ccb", "credito.cessao"]], ["conta", ["pix.automatico"]]],
    ["credito"], "fase2"),
  m("cartao", "Cartão com garantia da moto", "Crédito com limite lastreado na moto.",
    "CreditCard", 60, [["cartao", ["cartao.emitir", "cartao.limite", "cartao.bloquear"]]],
    ["credito"], "fase2"),
  m("seguro", "Seguro de vida e acidentes", "Vida, acidentes pessoais e diária por incapacidade.",
    "Shield", 70, [["seguro", ["seguro.cotar", "seguro.emitir", "seguro.sinistro"]]], ["seguros"]),
  m("saude", "Seguro saúde", "Plano coletivo pela MEI (empresarial) ou por adesão.",
    "HeartPulse", 80, [["saude", ["saude.cotar", "saude.aderir"]]], ["seguros"], "fase2"),
  { ...m("consignado_clt", "Consignado CLT", "Crédito do Trabalhador (leilão Dataprev, portal RH).",
         "Landmark", 900, [["credito", ["credito.ccb"]]], ["credito", "legado"], "legado"),
    enabled: false, pronto: false },
  { ...m("consignado_app", "Consignado do entregador (Lei 15.179)",
         "Depende de convênio com as plataformas e da regulamentação.",
         "Landmark", 910, [["credito", ["credito.ccb"]], ["renda", ["renda.ler"]]], ["credito"],
         "fase3"),
    enabled: false, pronto: false },
];

function m(
  id: string, titulo: string, descricao: string, icone: string, ordem: number,
  reqs: Array<[string, string[]]>, tags: string[], fase: Modulo["fase"] = "mvp",
): Modulo {
  return {
    id, titulo, descricao, icone, ordem, fase, tags,
    rota: `/app/${id}`, enabled: true, pronto: true,
    requisitos: reqs.map(([port, capabilities]) => ({ port: port as any, capabilities })),
    providers: Object.fromEntries(reqs.map(([port]) => [port, "Mock (demo)"])),
    origem_flag: "codigo",
  };
}

export const PRODUTOS_CREDITO_DEMO: ProdutoCredito[] = [
  pc("moto_nova", "Financiamento de moto nova", "financiamento_moto", {
    taxa_mensal: 0.0219, prazo_min: 24, prazo_max: 48, ticket_min: 8000, ticket_max: 30000,
    garantia_tipo: "moto", ltv_max: 0.9, score_minimo: 550, renda_minima: 1800,
    comprometimento_max: 0.3, tac: 450, cobranca: "pix_automatico", modulo_id: "moto",
    jornada_id: "jornada_moto",
  }),
  pc("cartao_garantido_moto", "Cartão com garantia da moto", "cartao_garantido", {
    taxa_mensal: 0.0599, prazo_min: 1, prazo_max: 12, ticket_min: 500, ticket_max: 8000,
    garantia_tipo: "moto", ltv_max: 0.3, score_minimo: 500, renda_minima: 1200,
    comprometimento_max: 0.25, cobranca: "desconto_repasse", modulo_id: "cartao",
    jornada_id: "jornada_cartao",
  }),
  pc("credito_pessoal", "Crédito pessoal do entregador", "credito_pessoal", {
    taxa_mensal: 0.0389, prazo_min: 6, prazo_max: 18, ticket_min: 500, ticket_max: 5000,
    garantia_tipo: "nenhuma", score_minimo: 580, renda_minima: 1500,
    comprometimento_max: 0.2, cobranca: "desconto_repasse", modulo_id: "conta",
  }),
  pc("antecipacao", "Antecipação de repasse", "antecipacao_recebiveis", {
    taxa_mensal: 0.029, prazo_min: 1, prazo_max: 2, ticket_min: 100, ticket_max: 2000,
    garantia_tipo: "recebiveis", ltv_max: 0.7, score_minimo: 450, renda_minima: 800,
    comprometimento_max: 0.5, meses_renda_comprovada: 1, cobranca: "desconto_repasse",
    modulo_id: "ganhos",
  }),
  pc("consignado_clt", "Consignado CLT (legado)", "consignado_clt", {
    taxa_mensal: 0.0179, prazo_min: 6, prazo_max: 36, ticket_min: 500, ticket_max: 20000,
    score_minimo: 400, renda_minima: 1518, comprometimento_max: 0.35, cobranca: "boleto",
    modulo_id: "consignado_clt", ativo: false,
  }),
];

function pc(id: string, nome: string, tipo: string, over: Partial<ProdutoCredito>): ProdutoCredito {
  return {
    id, nome, tipo, taxa_mensal: 0.0199, prazo_min: 6, prazo_max: 48, ticket_min: 500,
    ticket_max: 30000, garantia_tipo: null, ltv_max: 0, score_minimo: 500, renda_minima: 1200,
    comprometimento_max: 0.3, idade_min: 18, idade_max: 70, exige_mei: false, exige_kyc: true,
    meses_renda_comprovada: 3, tac: 0, seguro_embutido: null, emissor_conexao_id: null,
    cobranca: "pix_automatico", jornada_id: null, modulo_id: null, ativo: true, ...over,
  };
}

export const APPS_DEMO: AppEntrega[] = [
  app("ifood", "iFood", "api", 10),
  app("rappi", "Rappi", "api", 20),
  app("99", "99Food", "api", 30, "99"),
  app("uber", "Uber Eats", "open_finance", 40),
  app("loggi", "Loggi", "manual", 50),
];

function app(id: string, nome: string, tipo: string, ordem: number, slug = id): AppEntrega {
  return {
    id, nome, slug, tipo_integracao: tipo, provider_tipo: "mock", config: {},
    repasse_direto: false, periodicidade_repasse: "semanal", taxa_plataforma: 0,
    mapeamento: {}, logo_url: "", ativo: true, ordem,
  };
}

export const CONEXOES_DEMO: Conexao[] = (
  ["conta", "cartao", "kyc", "credito", "seguro", "saude", "contador", "renda"] as const
).map((port, i) => ({
  id: `${port}_mock`, port, tipo: "mock", titulo: `${rotuloPort(port)} (mock)`,
  escopo: "global", config: {}, ativo: true, prioridade: 500, ambiente: "sandbox" as const,
  observacao: "", criado_em: new Date(Date.now() - i * 36e5).toISOString(),
  atualizado_em: new Date(Date.now() - i * 36e5).toISOString(),
}));

function rotuloPort(port: string) {
  return ({ conta: "Conta", cartao: "Cartão", kyc: "KYC", credito: "Emissor",
            seguro: "Seguradora", saude: "Operadora de saúde", contador: "Contabilidade",
            renda: "Renda" } as Record<string, string>)[port] ?? port;
}

const CAMPOS_REST = [
  { chave: "base_url", titulo: "URL base da API", tipo: "url" as const, obrigatorio: true,
    ajuda: "Ex.: https://sandbox.fornecedor.com — sem barra no fim.", opcoes: [], default: null },
  { chave: "auth", titulo: "Autenticação", tipo: "json" as const, obrigatorio: true,
    ajuda: 'Tipos: nenhum, api_key, basic, oauth2_client_credentials. Segredos entram pelo NOME da variável de ambiente.',
    opcoes: [], default: null },
  { chave: "operacoes", titulo: "Operações", tipo: "json" as const, obrigatorio: true,
    ajuda: "Mapa operação -> {metodo, path, body, resposta}.", opcoes: [], default: null },
  { chave: "headers", titulo: "Headers fixos", tipo: "json" as const, obrigatorio: false,
    ajuda: "", opcoes: [], default: null },
  { chave: "idempotencia", titulo: "Idempotência", tipo: "json" as const, obrigatorio: false,
    ajuda: 'Ex.: {"header":"x-idempotency-key"}', opcoes: [], default: null },
  { chave: "health", titulo: "Checagem de saúde", tipo: "json" as const, obrigatorio: false,
    ajuda: 'Ex.: {"metodo":"GET","path":"/v1/ping"}', opcoes: [], default: null },
  { chave: "timeout_s", titulo: "Timeout (s)", tipo: "numero" as const, obrigatorio: false,
    ajuda: "", opcoes: [], default: 20 },
];

const OPERACOES_POR_PORT: Record<string, string[]> = {
  conta: ["abrir_conta", "saldo", "extrato", "pix_enviar", "cobrar", "creditar", "pix_automatico", "boleto"],
  cartao: ["emitir_cartao", "ajustar_limite", "bloquear_cartao"],
  kyc: ["validar_kyc", "facematch"],
  credito: ["emitir_ccb", "ceder"],
  seguro: ["cotar_seguro", "emitir_seguro", "sinistro"],
  saude: ["cotar_saude", "aderir_saude"],
  contador: ["abrir_mei", "das", "dasn", "nfse"],
  renda: ["consentir_renda", "ler_renda"],
};

export const TIPOS_DEMO: TiposAdmin = {
  ports: Object.keys(OPERACOES_POR_PORT).map((port) => ({
    port: port as any, titulo: rotuloPort(port), env: `${port.toUpperCase()}_PROVIDER`,
    operacoes_rest: OPERACOES_POR_PORT[port],
    fornecedores: [
      { tipo: "mock", titulo: "Mock (demo, sem credencial)", ports: [port as any],
        descricao: "Roda o produto inteiro sem fornecedor.", sem_codigo: false, campos: [] },
      { tipo: "rest", titulo: "REST genérico (cadastro pela tela)", ports: [port as any],
        descricao: "Descreva a API do fornecedor em JSON e ele passa a atender o módulo.",
        sem_codigo: true, campos: CAMPOS_REST },
      ...(port === "conta"
        ? [{ tipo: "celcoin", titulo: "Celcoin (BaaS)", ports: ["conta" as any],
             descricao: "Adapter nativo: conta individual, Pix e cobrança.", sem_codigo: false,
             campos: [] }]
        : []),
    ],
  })),
  adapters: [],
  tipos_produto_credito: ["financiamento_moto", "cartao_garantido", "cartao_credito",
                          "credito_pessoal", "antecipacao_recebiveis", "consignado_clt",
                          "consignado_app", "financiamento_celular"],
  tipos_integracao_app: ["api", "open_finance", "webhook", "arquivo", "manual"],
  tipos_passo: ["formulario", "consentimento", "kyc", "conectar_app", "renda", "oferta",
                "escolha", "assinatura", "provisionar", "revisao_manual", "mensagem"],
};

const CONSENT_LGPD =
  "Autorizo a BMoto a consultar meus dados para abrir a conta e avaliar crédito, nos termos da LGPD.";

export const JORNADAS_DEMO: Jornada[] = [
  j("jornada_conta", "Abrir conta BMoto", "conta", null, [
    p("dados", "formulario", "Seus dados", { campos: [
      { chave: "nome", titulo: "Nome completo", tipo: "texto", obrigatorio: true },
      { chave: "nascimento", titulo: "Data de nascimento", tipo: "data", obrigatorio: true },
      { chave: "celular", titulo: "Celular", tipo: "telefone", obrigatorio: true },
      { chave: "email", titulo: "E-mail", tipo: "email" }] }),
    p("lgpd", "consentimento", "Autorização de dados", { texto: CONSENT_LGPD, versao: "v1" }),
    p("kyc", "kyc", "Confirmação de identidade", { mesa_se_reprovar: true }),
    p("abrir", "provisionar", "Abrindo sua conta", { acoes: ["abrir_conta"] }),
    p("pronto", "mensagem", "Conta aberta", {
      texto: "Sua conta está pronta. Aponte o repasse dos apps para a sua chave Pix." }),
  ]),
  j("jornada_ganhos", "Conectar apps de entrega", "ganhos", null, [
    p("escolher", "conectar_app", "Conecte seus apps", { apps: ["ifood", "rappi", "99"], minimo: 1 }),
    p("renda", "renda", "Lendo seus ganhos", { meses: 3 }),
    p("resumo", "mensagem", "Ganhos consolidados", {
      texto: "Pronto: seus ganhos dos últimos 3 meses já aparecem no app." }),
  ]),
  j("jornada_mei", "Abrir e cuidar da MEI", "mei", null, [
    p("dados", "formulario", "Dados para a MEI", { campos: [
      { chave: "nome", titulo: "Nome completo", tipo: "texto", obrigatorio: true },
      { chave: "nascimento", titulo: "Data de nascimento", tipo: "data", obrigatorio: true }] }),
    p("procuracao", "consentimento", "Procuração e-CAC", {
      texto: "Autorizo a BMoto a me representar no e-CAC para abrir e manter a MEI.", versao: "v1" }),
    p("abrir", "provisionar", "Abrindo sua MEI", { acoes: ["abrir_mei"], cnae: "5320-2/02" }),
    p("pronto", "mensagem", "MEI aberta", {
      texto: "CNPJ emitido. O DAS mensal entra no seu calendário." }),
  ]),
  j("jornada_moto", "Financiar uma moto", "moto", "moto_nova", [
    p("apps", "conectar_app", "Conecte seus apps", { apps: ["ifood", "rappi", "99"], minimo: 1 }),
    p("renda", "renda", "Analisando seus ganhos", { meses: 3, minimo: 1800 }),
    p("moto", "formulario", "A moto", { campos: [
      { chave: "valor_garantia", titulo: "Valor da moto", tipo: "moeda", obrigatorio: true },
      { chave: "modelo", titulo: "Modelo", tipo: "texto" }] }),
    p("prazo", "escolha", "Em quantas vezes?", { chave: "prazo", opcoes: [24, 36, 48] }),
    p("oferta", "oferta", "Sua oferta", { produto_credito_id: "moto_nova", mesa_se_recusar: true }),
    p("kyc", "kyc", "Confirmação de identidade", {}),
    p("ccb", "assinatura", "Assinatura do contrato", { documento: "ccb", exige_selfie: true }),
    p("seguro", "provisionar", "Seguro da moto", { acoes: ["emitir_seguro"], produto: "moto" },
      "oferta.aprovado == true"),
    p("pronto", "mensagem", "Financiamento aprovado", {
      texto: "Contrato assinado. A parcela sai do seu repasse." }),
  ]),
  j("jornada_cartao", "Cartão com garantia da moto", "cartao", "cartao_garantido_moto", [
    p("moto", "formulario", "Sua moto", { campos: [
      { chave: "placa", titulo: "Placa", tipo: "texto", obrigatorio: true },
      { chave: "valor_garantia", titulo: "Valor da moto", tipo: "moeda", obrigatorio: true }] }),
    p("renda", "renda", "Conferindo seus ganhos", { meses: 3 }),
    p("oferta", "oferta", "Seu limite", { produto_credito_id: "cartao_garantido_moto" }),
    p("aceite", "assinatura", "Contrato do cartão", { documento: "contrato_cartao" }),
    p("emitir", "provisionar", "Emitindo o cartão", {
      acoes: ["emitir_cartao"], modalidade: "garantido" }),
  ]),
  j("jornada_seguro", "Contratar seguro de vida e acidentes", "seguro", null, [
    p("dados", "formulario", "Seus dados", { campos: [
      { chave: "nome", titulo: "Nome completo", tipo: "texto", obrigatorio: true },
      { chave: "nascimento", titulo: "Data de nascimento", tipo: "data", obrigatorio: true }] }),
    p("aceite", "consentimento", "Condições gerais", {
      texto: "Li as condições gerais e o resumo de coberturas.", versao: "v1" }),
    p("emitir", "provisionar", "Emitindo a apólice", {
      acoes: ["emitir_seguro"], produto: "vida_ap" }),
  ]),
  j("jornada_saude", "Aderir ao plano de saúde", "saude", null, [
    p("dados", "formulario", "Seus dados", { campos: [
      { chave: "nome", titulo: "Nome completo", tipo: "texto", obrigatorio: true },
      { chave: "nascimento", titulo: "Data de nascimento", tipo: "data", obrigatorio: true }] }),
    p("aderir", "provisionar", "Finalizando a adesão", { acoes: ["aderir_saude"] }),
  ]),
];

function j(id: string, nome: string, modulo_id: string | null,
           produto_credito_id: string | null, passos: Passo[]): Jornada {
  return { id, nome, modulo_id, produto_credito_id, versao: 1, ativo: true, passos };
}

function p(id: string, tipo: Passo["tipo"], titulo: string, config: Passo["config"],
           condicao: string | null = null): Passo {
  return { id, tipo, titulo, descricao: "", obrigatorio: true, condicao, config };
}

export function resumoDemo(): Resumo {
  return {
    modulos: { total: MODULOS_DEMO.length,
               ligados: MODULOS_DEMO.filter((m) => m.enabled).length,
               prontos: MODULOS_DEMO.filter((m) => m.pronto).length },
    conexoes: { total: CONEXOES_DEMO.length, ativas: CONEXOES_DEMO.length },
    produtos_credito: { total: PRODUTOS_CREDITO_DEMO.length,
                        ativos: PRODUTOS_CREDITO_DEMO.filter((p) => p.ativo).length },
    apps_entrega: { total: APPS_DEMO.length, ativos: APPS_DEMO.filter((a) => a.ativo).length },
    jornadas: JORNADAS_DEMO.length,
    pendencias: [],
  };
}

// ------------------------------------------------------------ motor demo

const RENDA_POR_APP: Record<string, { bruto: number; corridas: number; km: number }> = {
  ifood: { bruto: 2480, corridas: 186, km: 1900 },
  rappi: { bruto: 640, corridas: 44, km: 420 },
  "99": { bruto: 910, corridas: 61, km: 700 },
  uber: { bruto: 0, corridas: 0, km: 0 },
  loggi: { bruto: 520, corridas: 30, km: 380 },
};

/**
 * Internamente a execução guarda o ID do passo atual; `estado()` troca pelo
 * objeto do passo antes de devolver, igual ao backend.
 */
interface ExecInterna extends Omit<EstadoJornada, "passo_atual"> {
  passo_atual: string | null;
}

const execucoes = new Map<string, ExecInterna>();
const idAleatorio = () => Math.random().toString(36).slice(2, 12);

function condicaoOk(condicao: string | null | undefined, ctx: Record<string, any>): boolean {
  if (!condicao?.trim()) return true;
  return condicao.split(/\s+(?:e|and|&&)\s+/i).every((parte) => {
    const op = ["==", "!=", ">=", "<=", ">", "<"].find((o) => parte.includes(o));
    if (!op) {
      const v = caminho(ctx, parte.trim());
      return Boolean(v);
    }
    const [esq, dir] = parte.split(op);
    const a = caminho(ctx, esq.trim());
    const b = converter(dir.trim());
    if (typeof b === "boolean") return op === "==" ? Boolean(a) === b : Boolean(a) !== b;
    if (typeof b === "number") {
      const n = Number(a);
      if (!Number.isFinite(n)) return false;
      return { "==": n === b, "!=": n !== b, ">=": n >= b, "<=": n <= b, ">": n > b, "<": n < b }[op]!;
    }
    return op === "==" ? a === b : a !== b;
  });
}

const caminho = (obj: any, p: string) =>
  p.split(".").reduce((a, k) => (a && typeof a === "object" ? a[k] : undefined), obj);

function converter(bruto: string): string | number | boolean | null {
  const b = bruto.replace(/^['"]|['"]$/g, "");
  if (/^(true|sim)$/i.test(b)) return true;
  if (/^(false|nao|não)$/i.test(b)) return false;
  if (/^(null|none)$/i.test(b) || b === "") return null;
  const n = Number(b);
  return Number.isFinite(n) ? n : b;
}

function parcelaPrice(principal: number, i: number, n: number): number {
  if (i <= 0) return round2(principal / n);
  return round2((principal * i) / (1 - Math.pow(1 + i, -n)));
}

const round2 = (v: number) => Math.round(v * 100) / 100;

function avaliar(prod: ProdutoCredito, ctx: Record<string, any>): Oferta {
  const recusas: string[] = [];
  const score = Number(ctx.score ?? 600);
  const renda = Number(ctx.renda_media ?? 0);
  const idade = idadeDe(ctx.nascimento);
  const garantia = Number(ctx.valor_garantia ?? 0);
  const n = Math.max(prod.prazo_min, Math.min(Number(ctx.prazo ?? prod.prazo_max), prod.prazo_max));

  if (!prod.ativo) recusas.push("produto_inativo");
  if (score < prod.score_minimo) recusas.push("score_abaixo_do_minimo");
  if (renda < prod.renda_minima) recusas.push("renda_abaixo_do_minimo");
  if (idade < prod.idade_min || idade > prod.idade_max) recusas.push("idade_fora_da_politica");
  if (prod.exige_mei && !ctx.cnpj_mei) recusas.push("exige_mei_ativa");
  if (prod.exige_kyc && ctx.kyc_ok === false) recusas.push("kyc_reprovado");
  if (Number(ctx.meses_renda ?? 12) < prod.meses_renda_comprovada)
    recusas.push("historico_de_renda_insuficiente");
  if (prod.garantia_tipo && prod.garantia_tipo !== "nenhuma" && garantia <= 0)
    recusas.push("garantia_obrigatoria");

  const cap = renda * prod.comprometimento_max;
  const porRenda = prod.taxa_mensal > 0
    ? (cap * (1 - Math.pow(1 + prod.taxa_mensal, -n))) / prod.taxa_mensal
    : cap * n;
  const limites = [Math.min(porRenda, prod.ticket_max), prod.ticket_max];
  if (prod.ltv_max > 0 && garantia > 0) limites.push(round2(garantia * prod.ltv_max));
  const limite = round2(Math.min(...limites));
  const principal = round2(Math.min(Number(ctx.solicitado ?? limite), limite));
  if (principal < prod.ticket_min) recusas.push("abaixo_do_ticket_minimo");

  const aprovado = recusas.length === 0;
  const parcela = aprovado && principal > 0 ? parcelaPrice(principal, prod.taxa_mensal, n) : 0;
  return {
    produto_id: prod.id, produto: prod.nome, tipo: prod.tipo, aprovado, recusas,
    limite, principal, parcelas: n, parcela, taxa_mensal: prod.taxa_mensal,
    cet_anual: aprovado ? round4(Math.pow(1 + prod.taxa_mensal, 12) - 1 + prod.tac / Math.max(principal, 1)) : 0,
    comprometimento: renda > 0 ? round4(parcela / renda) : 0,
    garantia: prod.garantia_tipo
      ? { tipo: prod.garantia_tipo, valor: garantia, ltv_max: prod.ltv_max }
      : null,
    cobranca: prod.cobranca,
  };
}

const round4 = (v: number) => Math.round(v * 10000) / 10000;

function idadeDe(nascimento: unknown): number {
  const d = new Date(String(nascimento ?? ""));
  if (Number.isNaN(d.getTime())) return 30;
  return Math.floor((Date.now() - d.getTime()) / (365.25 * 864e5));
}

function estado(jornada: Jornada, exec: ExecInterna): EstadoJornada {
  const feitos = new Set(exec.historico.filter((h) => h.ok).map((h) => h.passo));
  const elegiveis = jornada.passos.filter((p) => condicaoOk(p.condicao, exec.contexto));
  const atual = elegiveis.find((p) => p.id === exec.passo_atual) ?? null;
  return {
    ...exec,
    passo_atual: atual,
    automatico: !!atual && ["kyc", "renda", "oferta", "provisionar"].includes(atual.tipo),
    progresso: { total: elegiveis.length,
                 concluidos: elegiveis.filter((p) => feitos.has(p.id)).length },
    passos: elegiveis.map((p) => ({ ...p, concluido: feitos.has(p.id), atual: p.id === exec.passo_atual })),
  };
}

function proximo(jornada: Jornada, exec: ExecInterna): string | null {
  const feitos = new Set(exec.historico.filter((h) => h.ok).map((h) => h.passo));
  const prox = jornada.passos
    .filter((p) => condicaoOk(p.condicao, exec.contexto))
    .find((p) => !feitos.has(p.id));
  return prox?.id ?? null;
}

export function iniciarDemo(jornadaId: string, cpf: string, contexto: Record<string, any> = {}) {
  const jornada = JORNADAS_DEMO.find((x) => x.id === jornadaId);
  if (!jornada) throw new Error(`jornada '${jornadaId}' não existe`);
  const exec: ExecInterna = {
    execucao_id: idAleatorio(),
    jornada: { id: jornada.id, nome: jornada.nome, versao: jornada.versao },
    status: "EM_ANDAMENTO", cpf, passo_atual: jornada.passos[0]?.id ?? null,
    automatico: false, progresso: { total: jornada.passos.length, concluidos: 0 },
    passos: [], contexto: { cpf, ...contexto }, historico: [],
  };
  exec.passo_atual = proximo(jornada, exec);
  execucoes.set(exec.execucao_id, exec);
  return estado(jornada, exec);
}

export function estadoDemo(execucaoId: string): EstadoJornada {
  const exec = execucoes.get(execucaoId);
  if (!exec) throw new Error("execução não encontrada");
  const jornada = JORNADAS_DEMO.find((x) => x.id === exec.jornada.id)!;
  return estado(jornada, exec);
}

export function avancarDemo(execucaoId: string, resposta: Record<string, any> = {}): EstadoJornada {
  const exec = execucoes.get(execucaoId);
  if (!exec) throw new Error("execução não encontrada");
  const jornada = JORNADAS_DEMO.find((x) => x.id === exec.jornada.id)!;
  if (exec.status !== "EM_ANDAMENTO" && exec.status !== "PENDENTE_MESA") return estado(jornada, exec);
  const passo = jornada.passos.find((p) => p.id === exec.passo_atual);
  if (!passo) {
    exec.status = "CONCLUIDA";
    return estado(jornada, exec);
  }

  const ctx = exec.contexto;
  const cfg = passo.config;
  let r: { ok: boolean; recusar?: boolean; mesa?: boolean; [k: string]: any } = { ok: true };

  switch (passo.tipo) {
    case "formulario": {
      const faltam = (cfg.campos ?? [])
        .filter((c) => c.obrigatorio && [undefined, null, ""].includes(resposta[c.chave]))
        .map((c) => c.chave);
      if (faltam.length) r = { ok: false, erro: "campos_obrigatorios", campos: faltam };
      else Object.assign(ctx, resposta);
      break;
    }
    case "escolha": {
      const chave = cfg.chave ?? passo.id;
      const escolha = resposta[chave] ?? resposta.valor;
      const opcoes = cfg.opcoes ?? [];
      if (opcoes.length && !opcoes.map(String).includes(String(escolha)))
        r = { ok: false, erro: "opcao_invalida", opcoes };
      else ctx[chave] = escolha;
      break;
    }
    case "consentimento":
      if (!resposta.aceito && cfg.obrigatorio_aceitar !== false)
        r = { ok: false, erro: "consentimento_necessario" };
      else (ctx.consentimentos ??= []).push({ passo: passo.id, versao: cfg.versao ?? "v1",
                                              em: new Date().toISOString() });
      break;
    case "kyc": {
      const cpf = String(ctx.cpf ?? "").replace(/\D/g, "");
      const motivos: string[] = [];
      if (cpf.length !== 11) motivos.push("cpf_invalido");
      if (cpf.endsWith("00")) motivos.push("lista_restritiva");
      if (idadeDe(ctx.nascimento) < 18) motivos.push("menor_de_idade");
      const aprovado = motivos.length === 0;
      ctx.kyc = { cpf, aprovado, score: aprovado ? 0.95 : 0.2, motivos, provider: "Mock (demo)" };
      ctx.kyc_ok = aprovado;
      if (!aprovado) r = { ok: false, recusar: !cfg.mesa_se_reprovar, mesa: !!cfg.mesa_se_reprovar,
                           kyc: ctx.kyc };
      break;
    }
    case "conectar_app": {
      const slugs: string[] = resposta.apps ?? cfg.apps ?? [];
      const conectados = (ctx.apps_conectados ??= []);
      slugs.forEach((slug) => {
        const a = APPS_DEMO.find((x) => x.slug === slug && x.ativo);
        if (a && !conectados.some((c: any) => c.app === slug))
          conectados.push({ app: slug, nome: a.nome, consentimento_id: idAleatorio() });
      });
      if (conectados.length < (cfg.minimo ?? 1))
        r = { ok: false, erro: "conecte_ao_menos_um_app", minimo: cfg.minimo ?? 1,
              conectados: conectados.length };
      break;
    }
    case "renda": {
      const meses = cfg.meses ?? 3;
      let total = 0;
      const detalhe = (ctx.apps_conectados ?? []).map((c: any) => {
        const perfil = RENDA_POR_APP[c.app] ?? { bruto: 0, corridas: 0, km: 0 };
        const series = Array.from({ length: meses }, (_, i) => ({
          competencia: competenciaRelativa(i), fonte: c.app,
          bruto: round2(perfil.bruto * (1 - 0.04 * i)),
          corridas: Math.round(perfil.corridas * (1 - 0.04 * i)),
          km: round2(perfil.km * (1 - 0.04 * i)),
        }));
        const media = series.reduce((a, s) => a + s.bruto, 0) / Math.max(series.length, 1);
        total += media;
        return { app: c.app, media: round2(media), meses: series };
      });
      ctx.renda_media = round2(total);
      ctx.renda_detalhe = detalhe;
      ctx.meses_renda = meses;
      const minimo = Number(cfg.minimo ?? 0);
      if (minimo && ctx.renda_media < minimo)
        r = { ok: false, recusar: true, erro: "renda_insuficiente",
              renda_media: ctx.renda_media, minimo };
      break;
    }
    case "oferta": {
      const pid = (cfg.produto_credito_id as string) ?? ctx.produto_credito_id;
      const prod = PRODUTOS_CREDITO_DEMO.find((x) => x.id === pid);
      if (!prod) { r = { ok: false, erro: "produto_credito_nao_configurado" }; break; }
      const oferta = avaliar(prod, ctx);
      ctx.oferta = oferta;
      if (!oferta.aprovado)
        r = { ok: false, recusar: !cfg.mesa_se_recusar, mesa: !!cfg.mesa_se_recusar, oferta };
      else r = { ok: true, oferta };
      break;
    }
    case "assinatura": {
      if (!resposta.aceito) { r = { ok: false, erro: "aceite_necessario" }; break; }
      const oferta: Oferta | undefined = ctx.oferta;
      if ((cfg.documento ?? "ccb") === "ccb" && oferta?.aprovado) {
        ctx.contrato = {
          contrato_id: `ccb_${idAleatorio()}`, cpf: ctx.cpf, produto: oferta.tipo,
          principal: oferta.principal, taxa_mensal: oferta.taxa_mensal,
          parcelas: oferta.parcelas, parcela: oferta.parcela, cet_anual: oferta.cet_anual,
          ccb_url: "#", status: "EMITIDO",
        };
      } else {
        (ctx.assinaturas ??= []).push({ documento: cfg.documento ?? "contrato",
                                        em: new Date().toISOString() });
      }
      break;
    }
    case "provisionar": {
      const feitos: Record<string, string> = {};
      for (const acao of (cfg.acoes as string[]) ?? []) {
        if (acao === "abrir_conta") {
          ctx.conta = { conta_id: `cta_${idAleatorio()}`, titular_cpf: ctx.cpf,
                        provider: "Mock (demo)", agencia: "0001", numero: "000123-0",
                        chave_pix: String(ctx.cpf ?? "").replace(/\D/g, ""), status: "ATIVA" };
          feitos[acao] = ctx.conta.conta_id;
        } else if (acao === "emitir_cartao") {
          const limite = Number(ctx.oferta?.limite ?? cfg.limite ?? 0);
          ctx.cartao = { cartao_id: `card_${idAleatorio()}`, conta_id: ctx.conta?.conta_id ?? "",
                         provider: "Mock (demo)", modalidade: cfg.modalidade ?? "garantido",
                         limite, status: "ATIVO",
                         ultimos4: String(Math.floor(1000 + Math.random() * 8999)) };
          feitos[acao] = ctx.cartao.cartao_id;
        } else if (acao === "abrir_mei") {
          const base = String(ctx.cpf ?? "").replace(/\D/g, "").slice(0, 8);
          ctx.mei = { cnpj: `${base}000199`, cpf: ctx.cpf, razao_social: ctx.nome ?? "",
                      cnae: cfg.cnae ?? "5320-2/02",
                      aberto_em: new Date().toISOString().slice(0, 10), status: "ATIVO" };
          ctx.cnpj_mei = ctx.mei.cnpj;
          feitos[acao] = ctx.mei.cnpj;
        } else if (acao === "emitir_seguro") {
          const premio = cfg.produto === "moto" ? 89 : 19.9;
          ctx.apolice = { apolice_id: `apl_${idAleatorio()}`, cpf: ctx.cpf,
                          produto: cfg.produto ?? "vida_ap", premio_mensal: premio,
                          seguradora: "Seguradora Mock S.A.",
                          vigencia_inicio: new Date().toISOString().slice(0, 10), status: "ATIVA" };
          feitos[acao] = ctx.apolice.apolice_id;
        } else if (acao === "aderir_saude") {
          const empresarial = Boolean(ctx.cnpj_mei);
          ctx.plano_saude = { apolice_id: `apl_${idAleatorio()}`, cpf: ctx.cpf, produto: "saude",
                              premio_mensal: empresarial ? 189.9 : 249.9,
                              seguradora: "Operadora Mock", status: "ATIVA" };
          feitos[acao] = ctx.plano_saude.apolice_id;
        }
      }
      r = { ok: true, provisionado: feitos };
      break;
    }
    case "revisao_manual":
      r = { ok: false, mesa: true, erro: "aguardando_mesa", fila: cfg.fila ?? "credito" };
      break;
    case "mensagem":
      r = { ok: true, mensagem: cfg.texto ?? "" };
      break;
  }

  const { ok, ...resto } = r;
  exec.historico.push({ passo: passo.id, tipo: passo.tipo, em: new Date().toISOString(),
                        ok, resultado: resto });
  if (!ok) {
    if (r.recusar) exec.status = "RECUSADA";
    else if (r.mesa) exec.status = "PENDENTE_MESA";
  } else {
    exec.passo_atual = proximo(jornada, exec);
    if (!exec.passo_atual) exec.status = "CONCLUIDA";
  }
  execucoes.set(execucaoId, exec);
  return estado(jornada, exec);
}

function competenciaRelativa(mesesAtras: number): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - mesesAtras);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function jornadaDoModuloDemo(moduloId: string): Jornada | undefined {
  return JORNADAS_DEMO.find((x) => x.modulo_id === moduloId && x.ativo);
}

/** Só para testes. */
export function _limparExecucoesDemo() {
  execucoes.clear();
}
