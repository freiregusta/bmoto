/**
 * classificador.ts — identificar, no extrato, o que é repasse de app de entrega.
 *
 * Porte fiel do backend Python (plataforma/openfinance.py), com os mesmos
 * casos cobertos: acento, caixa trocada, filial com CNPJ diferente, débito e
 * transferência de pessoa física.
 *
 * As plataformas não abrem API de ganhos para terceiros, mas o dinheiro cai na
 * conta do entregador, e ali a transação traz o pagador. Esta é a peça que
 * transforma isso em renda comprovável — e serve igual para extrato subido à
 * mão, agregador ou Open Finance.
 */

export interface Transacao {
  id: string;
  data: string; // ISO
  valor: number; // positivo = entrou
  descricao?: string;
  pagador_nome?: string;
  pagador_documento?: string;
}

export interface RegraApp {
  slug: string;
  nome: string;
  cnpjs?: string[];
  identificadores?: string[];
}

export interface RepassePorApp {
  slug: string;
  nome: string;
  total: number;
  lancamentos: number;
  competencias: Record<string, number>;
}

export interface Classificacao {
  por_app: Record<string, RepassePorApp>;
  por_competencia: Record<string, number>;
  nao_identificados: Transacao[];
  total_identificado: number;
  total_creditos: number;
  cobertura: number;
}

const r2 = (v: number) => Math.round(v * 100) / 100;

/** Sem acento, sem pontuação, maiúsculas: 'iFood.com Ag.' -> 'IFOOD COM AG'. */
export function normalizar(texto: unknown): string {
  return String(texto ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, " ")
    .trim();
}

export const soDigitos = (v: unknown) => String(v ?? "").replace(/\D/g, "");

/** Os 8 primeiros dígitos: filial muda o meio, a raiz identifica a empresa. */
export const raizCnpj = (cnpj: unknown) => soDigitos(cnpj).slice(0, 8);

export const competenciaDe = (data: string) => String(data).slice(0, 7);

export function casa(regra: RegraApp, t: Transacao): boolean {
  const doc = raizCnpj(t.pagador_documento);
  if (doc && (regra.cnpjs ?? []).some((c) => c && raizCnpj(c) === doc)) return true;
  const texto = normalizar(`${t.pagador_nome ?? ""} ${t.descricao ?? ""}`);
  return (regra.identificadores ?? []).some((i) => i && texto.includes(normalizar(i)));
}

export function classificar(
  transacoes: Transacao[],
  regras: RegraApp[],
  valorMinimo = 0.01,
): Classificacao {
  const por_app: Record<string, RepassePorApp> = {};
  const por_competencia: Record<string, number> = {};
  const nao_identificados: Transacao[] = [];
  let total_creditos = 0;

  for (const t of transacoes) {
    if (t.valor < valorMinimo) continue; // débito ou poeira: não é repasse
    total_creditos += t.valor;
    const regra = regras.find((r) => casa(r, t));
    if (!regra) {
      nao_identificados.push(t);
      continue;
    }
    const acc = (por_app[regra.slug] ??= {
      slug: regra.slug, nome: regra.nome, total: 0, lancamentos: 0, competencias: {},
    });
    const comp = competenciaDe(t.data);
    acc.total = r2(acc.total + t.valor);
    acc.lancamentos += 1;
    acc.competencias[comp] = r2((acc.competencias[comp] ?? 0) + t.valor);
    por_competencia[comp] = r2((por_competencia[comp] ?? 0) + t.valor);
  }

  const total_identificado = r2(
    Object.values(por_app).reduce((a, x) => a + x.total, 0),
  );
  return {
    por_app, por_competencia, nao_identificados, total_identificado,
    total_creditos: r2(total_creditos),
    // Cobertura baixa é sinal de regra faltando, não de renda pequena.
    cobertura: total_creditos ? Math.round((total_identificado / total_creditos) * 10000) / 10000 : 0,
  };
}

// ------------------------------------------------------------ leitura CSV

const SEPARADORES = [";", ",", "\t"];
const COLUNAS: Record<string, string[]> = {
  data: ["data", "date", "data lancamento", "data movimento", "dt"],
  valor: ["valor", "amount", "value", "credito", "montante"],
  descricao: ["descricao", "description", "historico", "lancamento", "detalhe"],
  pagador_nome: ["pagador", "favorecido", "contraparte", "nome", "remetente", "origem",
                 "payer", "counterparty"],
  pagador_documento: ["documento", "cnpj", "cpf", "cpf cnpj", "doc", "taxid"],
};

/**
 * Extrato de banco não tem formato padronizado: detecta o separador, casa os
 * cabeçalhos por aproximação e ignora linha sem data e valor. O que não der
 * para ler fica de fora — melhor perder uma linha do que inventar um valor.
 */
export function lerCsv(texto: string): Transacao[] {
  const linhas = String(texto ?? "").split(/\r?\n/).filter((l) => l.trim());
  if (!linhas.length) return [];

  const sep = SEPARADORES.reduce((a, b) =>
    (linhas[0].split(b).length > linhas[0].split(a).length ? b : a));
  const cabecalho = linhas[0].split(sep).map((c) => normalizar(c).toLowerCase());

  const indice: Record<string, number> = {};
  for (const [campo, nomes] of Object.entries(COLUNAS)) {
    const i = cabecalho.findIndex((titulo) => nomes.some((n) => n === titulo || titulo.includes(n)));
    if (i >= 0) indice[campo] = i;
  }
  if (indice.data === undefined || indice.valor === undefined)
    throw new Error("não encontrei as colunas de data e valor neste arquivo");

  const maior = Math.max(...Object.values(indice));
  const out: Transacao[] = [];
  linhas.slice(1).forEach((linha, n) => {
    const partes = linha.split(sep);
    if (partes.length <= maior) return;
    const data = dataIso(partes[indice.data]);
    const valor = numero(partes[indice.valor]);
    if (!data || valor === null) return;
    out.push({
      id: `csv-${n + 2}`, data, valor,
      descricao: campo(partes, indice, "descricao"),
      pagador_nome: campo(partes, indice, "pagador_nome"),
      pagador_documento: campo(partes, indice, "pagador_documento"),
    });
  });
  return out;
}

const campo = (partes: string[], indice: Record<string, number>, nome: string) => {
  const i = indice[nome];
  return i !== undefined && i < partes.length ? partes[i].trim().replace(/^"|"$/g, "") : "";
};

export function dataIso(bruto: string): string | null {
  const texto = String(bruto ?? "").trim().replace(/^"|"$/g, "").slice(0, 10);
  let m = texto.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = texto.match(/^(\d{2})[\/-](\d{2})[\/-](\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`; // dd/mm/aaaa
  return null;
}

export function numero(bruto: string): number | null {
  let texto = String(bruto ?? "").trim().replace(/^"|"$/g, "").replace("R$", "").replace(/\s/g, "");
  if (!texto) return null;
  const negativo = texto.startsWith("-") || texto.endsWith("-") || texto.startsWith("(");
  texto = texto.replace(/[^\d,.]/g, "");
  if (!texto) return null;
  // pt-BR: vírgula decimal e ponto de milhar. en-US: o contrário.
  if (texto.includes(",") && texto.includes(".")) {
    texto = texto.lastIndexOf(",") > texto.lastIndexOf(".")
      ? texto.replace(/\./g, "").replace(",", ".")
      : texto.replace(/,/g, "");
  } else if (texto.includes(",")) {
    texto = texto.replace(",", ".");
  }
  const v = Number.parseFloat(texto);
  if (!Number.isFinite(v)) return null;
  return negativo ? -v : v;
}

/** Converte a classificação em lançamentos de ganho, um por app e mês. */
export function paraLancamentos(c: Classificacao, origem = "extrato") {
  const saida: Array<{ app: string; competencia: string; bruto: number; origem: string }> = [];
  for (const app of Object.values(c.por_app))
    for (const [competencia, bruto] of Object.entries(app.competencias))
      saida.push({ app: app.slug, competencia, bruto: r2(bruto), origem });
  // Mês mais recente primeiro; app em ordem alfabética para empate, para a
  // ordem não depender de qual plataforma apareceu antes no extrato.
  return saida.sort((a, b) =>
    b.competencia.localeCompare(a.competencia) || a.app.localeCompare(b.app));
}
