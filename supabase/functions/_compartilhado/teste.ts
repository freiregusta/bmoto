/**
 * teste.ts — a conta portada tem que dar o MESMO número que o backend Python.
 *
 * Não é um teste de fachada: imprime JSON dos mesmos cenários que o
 * `teste_paridade.py` roda no código Python original, e o script
 * `conferir-paridade.sh` compara os dois arquivos. Qualquer divergência de
 * centavo aparece no diff.
 *
 *   npx tsx teste.ts > /tmp/ts.json
 */

import { classificar, lerCsv, paraLancamentos, raizCnpj, type RegraApp } from "./classificador.ts";
import { custoPorKm, fixoMensal, rendaParaCredito, resumo } from "./financeiro.ts";
import { avaliar, cetAnual, limitePorRenda, normalizarProduto, parcela } from "./politica.ts";

const REGRAS: RegraApp[] = [
  { slug: "ifood", nome: "iFood", cnpjs: ["14380200000121"], identificadores: ["IFOOD"] },
  { slug: "99", nome: "99Food", identificadores: ["99 TECNOLOGIA", "99FOOD"] },
  { slug: "rappi", nome: "Rappi", identificadores: ["RAPPI"] },
];

const t = (valor: number, nome = "", doc = "", data = "2026-11-05", descricao = "") =>
  ({ id: "x", data, valor, descricao, pagador_nome: nome, pagador_documento: doc });

const CSV_PTBR =
  "Data;Valor;Histórico;Pagador\n" +
  "05/11/2026;1.234,56;Pix recebido;IFOOD COM AGENCIA\n" +
  "06/11/2026;-80,00;Compra no posto;Posto Ipiranga\n" +
  "10/11/2026;320,00;Pix recebido;99 TECNOLOGIA LTDA\n";

const CSV_EXEMPLO =
  "Data;Valor;Histórico;Pagador\n" +
  "05/09/2026;900,00;Pix recebido;IFOOD COM AGENCIA DE RESTAURANTES\n" +
  "19/09/2026;850,00;Pix recebido;IFOOD COM AGENCIA DE RESTAURANTES\n" +
  "03/10/2026;1.100,00;Pix recebido;IFOOD COM AGENCIA DE RESTAURANTES\n" +
  "10/10/2026;400,00;Pix recebido;99 TECNOLOGIA LTDA\n" +
  "12/10/2026;-250,00;Combustível;Posto Shell\n" +
  "15/10/2026;500,00;Pix recebido;Jose da Silva\n";

const CSV_QUEBRADO =
  "Data;Valor;Pagador\n05/11/2026;300,00;IFOOD\nlixo;;;\n06/11/2026;;IFOOD\n" +
  "07/11/2026;200,00;IFOOD\n";

// Os custos de uma moto real: 1,5 L de gasolina a cada 100 km não existe, então
// são números de uso típico — o que importa aqui é as duas pontas concordarem.
const CUSTOS = {
  consumo_km_l: 32, preco_combustivel: 6.19,
  custo_oleo: 90, km_troca_oleo: 3000,
  custo_pneus: 520, km_pneus: 12000,
  custo_revisao: 280, km_revisao: 6000,
  valor_moto: 18_900, vida_util_km: 90_000,
  das_mei: 86.05, parcela_moto: 0, seguro: 110, outros_fixos: 40,
};

const LANCAMENTOS = [
  { app: "ifood", competencia: "2026-09", bruto: 2350.4, corridas: 212, km: 1480.5, horas: 168 },
  { app: "99", competencia: "2026-09", bruto: 610.0, corridas: 54, km: 390.2, horas: 42 },
  { app: "ifood", competencia: "2026-10", bruto: 2890.9, corridas: 248, km: 1712.8, horas: 186.5 },
  { app: "rappi", competencia: "2026-08", bruto: 1180.0, corridas: 97, km: 740.0, horas: 88 },
];

const PRODUTO = normalizarProduto({
  id: "credito_pessoal", nome: "Crédito pessoal", tipo: "pessoal",
  taxa_mensal: 0.0219, prazo_min: 6, prazo_max: 24,
  ticket_min: 500, ticket_max: 8000,
  garantia_tipo: null, ltv_max: 0,
  score_minimo: 500, renda_minima: 1200, comprometimento_max: 0.2,
  idade_min: 18, idade_max: 70,
  exige_mei: false, exige_kyc: true, meses_renda_comprovada: 3,
  tac: 60, iof_diario: 0.000082, iof_fixo: 0.0038,
  cobranca: "pix_automatico", jornada_id: null, ativo: true,
});

const PRODUTO_MOTO = normalizarProduto({
  id: "financiamento_moto", nome: "Financiamento de moto", tipo: "veiculo",
  taxa_mensal: 0.0189, prazo_min: 12, prazo_max: 48,
  ticket_min: 3000, ticket_max: 25_000,
  garantia_tipo: "moto", ltv_max: 0.8,
  score_minimo: 550, renda_minima: 1500, comprometimento_max: 0.25,
  idade_min: 21, idade_max: 65,
  exige_mei: false, exige_kyc: true, meses_renda_comprovada: 6,
  tac: 0, iof_diario: 0.000082, iof_fixo: 0.0038,
  cobranca: "pix_automatico", jornada_id: null, ativo: true,
});

const semScore = (p: typeof PRODUTO, renda: number, meses: number, extra = {}) => {
  // O mesmo que a edge function faz: score neutralizado, nunca zerado.
  const r: Record<string, any> = avaliar(p, {
    score: p.score_minimo, renda_media: renda, idade: 30,
    kyc_ok: true, meses_renda: meses, ...extra,
  });
  r.cabe_no_bolso = r.aprovado;
  r.aprovado = false;
  return r;
};

const renda3 = rendaParaCredito(LANCAMENTOS, CUSTOS, 3);

const saida = {
  classificacao: {
    filial_por_cnpj: classificar([t(480, "", "14.380.200/0456-30")], REGRAS).por_app.ifood.total,
    acento_e_caixa: classificar(
      [t(300, "iFood.com Agência de Restaurantes"),
       t(120, "", "", "2026-11-05", "PIX RECEBIDO 99 tecnologia ltda")], REGRAS,
    ),
    pix_de_terceiro: classificar([t(200, "Maria Souza"), t(450, "IFOOD")], REGRAS),
    debito_nao_vira_renda: classificar([t(-900, "IFOOD"), t(500, "IFOOD")], REGRAS),
    agrupamento: classificar([
      t(300, "IFOOD", "", "2026-09-10"), t(200, "IFOOD", "", "2026-09-24"),
      t(400, "IFOOD", "", "2026-10-08"), t(150, "RAPPI", "", "2026-10-09"),
    ], REGRAS),
    raiz_cnpj: [raizCnpj("14.380.200/0001-21"), raizCnpj("")],
  },
  csv: {
    ptbr_valores: lerCsv(CSV_PTBR).map((x) => x.valor),
    ptbr_primeira_data: lerCsv(CSV_PTBR)[0].data,
    ptbr_classificado: classificar(lerCsv(CSV_PTBR), REGRAS),
    enus: lerCsv("date,amount,description,counterparty\n2026-11-05,1234.56,Transfer,IFOOD\n")[0],
    quebrado_valores: lerCsv(CSV_QUEBRADO).map((x) => x.valor),
    exemplo_classificado: classificar(lerCsv(CSV_EXEMPLO), REGRAS),
    exemplo_lancamentos: paraLancamentos(classificar(lerCsv(CSV_EXEMPLO), REGRAS)),
  },
  margem: {
    custo_por_km: custoPorKm(CUSTOS),
    fixo_mensal: fixoMensal(CUSTOS),
    resumo_3_meses: resumo(LANCAMENTOS, CUSTOS, 3),
    resumo_sem_custos: resumo(LANCAMENTOS, null, 3),
    resumo_vazio: resumo([], null, 3),
    renda_para_credito_3: renda3,
    renda_para_credito_sem_custos: rendaParaCredito(LANCAMENTOS, null, 3),
  },
  credito: {
    parcela_5000_12: parcela(PRODUTO, 5000, 12),
    cet_5000_12: cetAnual(PRODUTO, 5000, 12),
    limite_por_renda: limitePorRenda(PRODUTO, renda3.renda_media, 12),
    simulacao_pessoal_12: semScore(PRODUTO, renda3.renda_media, renda3.meses_renda,
                                  { parcelas: 12 }),
    simulacao_moto_sem_garantia: semScore(PRODUTO_MOTO, renda3.renda_media, renda3.meses_renda,
                                          { parcelas: 48 }),
    simulacao_moto_com_garantia: semScore(PRODUTO_MOTO, renda3.renda_media, 6,
                                          { parcelas: 48, valor_garantia: 16_000 }),
    renda_baixa_recusa: semScore(PRODUTO, 900, 3, { parcelas: 12 }),
  },
};

console.log(JSON.stringify(saida, null, 2));
