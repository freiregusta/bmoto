/**
 * Tipos que espelham a plataforma do backend (plataforma/*.py).
 *
 * O app não conhece produto nenhum em tempo de compilação: ele recebe
 * manifestos e jornadas. Por isso estes tipos são a fronteira de verdade —
 * mudar um produto no admin muda o que chega aqui, não o código.
 */

export type PortId =
  | "conta" | "cartao" | "kyc" | "credito" | "seguro" | "saude" | "contador" | "renda";

export interface Requisito {
  port: PortId;
  capabilities: string[];
}

/** Manifesto efetivo de um módulo: código + override do admin + env. */
export interface Modulo {
  id: string;
  titulo: string;
  descricao: string;
  rota: string;
  icone: string;
  enabled: boolean;
  /** Ligado E com fornecedor capaz de atender os requisitos. */
  pronto: boolean;
  ordem: number;
  fase: "mvp" | "fase2" | "fase3" | "legado";
  tags: string[];
  requisitos: Requisito[];
  providers: Record<string, string | null>;
  origem_flag: "codigo" | "admin" | "env";
  jornada_id?: string | null;
}

export type TipoPasso =
  | "formulario" | "consentimento" | "kyc" | "conectar_app" | "renda" | "oferta"
  | "escolha" | "assinatura" | "provisionar" | "revisao_manual" | "mensagem";

export interface CampoFormulario {
  chave: string;
  titulo: string;
  tipo?: "texto" | "email" | "telefone" | "data" | "moeda" | "numero" | "cpf" | "select";
  obrigatorio?: boolean;
  ajuda?: string;
  opcoes?: Array<string | number>;
  placeholder?: string;
}

export interface Passo {
  id: string;
  tipo: TipoPasso;
  titulo: string;
  descricao?: string;
  obrigatorio?: boolean;
  condicao?: string | null;
  config: {
    campos?: CampoFormulario[];
    texto?: string;
    versao?: string;
    obrigatorio_aceitar?: boolean;
    apps?: string[];
    minimo?: number;
    meses?: number;
    chave?: string;
    opcoes?: Array<string | number>;
    rotulo?: string;
    produto_credito_id?: string;
    documento?: string;
    acoes?: string[];
    fila?: string;
    [k: string]: unknown;
  };
  concluido?: boolean;
  atual?: boolean;
}

export interface Jornada {
  id: string;
  nome: string;
  modulo_id?: string | null;
  produto_credito_id?: string | null;
  versao: number;
  ativo: boolean;
  passos: Passo[];
}

export interface Oferta {
  produto_id: string;
  produto: string;
  tipo: string;
  aprovado: boolean;
  recusas: string[];
  limite: number;
  principal: number;
  parcelas: number;
  parcela: number;
  taxa_mensal: number;
  cet_anual: number;
  comprometimento: number;
  garantia?: { tipo: string | null; valor: number; ltv_max: number } | null;
  cobranca: string;
}

export type StatusExecucao =
  | "EM_ANDAMENTO" | "CONCLUIDA" | "RECUSADA" | "PENDENTE_MESA" | "ABANDONADA";

export interface EstadoJornada {
  execucao_id: string;
  jornada: { id: string; nome: string; versao: number };
  status: StatusExecucao;
  cpf: string;
  passo_atual: Passo | null;
  automatico: boolean;
  progresso: { total: number; concluidos: number };
  passos: Passo[];
  contexto: Record<string, any>;
  historico: Array<{
    passo: string;
    tipo: TipoPasso;
    em: string;
    ok: boolean;
    resultado: Record<string, any>;
  }>;
}

// ------------------------------------------------------------------ admin

export interface Conexao {
  id: string;
  port: PortId;
  tipo: string;
  titulo: string;
  escopo: string;
  config: Record<string, any>;
  ativo: boolean;
  prioridade: number;
  ambiente: "sandbox" | "producao";
  observacao: string;
  criado_em: string;
  atualizado_em: string;
}

export interface CampoSpec {
  chave: string;
  titulo: string;
  tipo: "texto" | "url" | "json" | "numero" | "segredo_env" | "select";
  obrigatorio: boolean;
  ajuda: string;
  opcoes: string[];
  default: unknown;
}

export interface FornecedorSpec {
  tipo: string;
  titulo: string;
  ports: PortId[];
  descricao: string;
  sem_codigo: boolean;
  campos: CampoSpec[];
}

export interface TiposAdmin {
  ports: Array<{
    port: PortId;
    titulo: string;
    env: string;
    operacoes_rest: string[];
    fornecedores: FornecedorSpec[];
  }>;
  adapters: FornecedorSpec[];
  tipos_produto_credito: string[];
  tipos_integracao_app: string[];
  tipos_passo: TipoPasso[];
}

export interface ProdutoCredito {
  id: string;
  nome: string;
  tipo: string;
  taxa_mensal: number;
  prazo_min: number;
  prazo_max: number;
  ticket_min: number;
  ticket_max: number;
  garantia_tipo: string | null;
  ltv_max: number;
  score_minimo: number;
  renda_minima: number;
  comprometimento_max: number;
  idade_min: number;
  idade_max: number;
  exige_mei: boolean;
  exige_kyc: boolean;
  meses_renda_comprovada: number;
  tac: number;
  seguro_embutido: string | null;
  emissor_conexao_id: string | null;
  cobranca: string;
  jornada_id: string | null;
  modulo_id: string | null;
  ativo: boolean;
}

export interface AppEntrega {
  id: string;
  nome: string;
  slug: string;
  tipo_integracao: string;
  provider_tipo: "mock" | "rest";
  config: Record<string, any>;
  repasse_direto: boolean;
  periodicidade_repasse: string;
  taxa_plataforma: number;
  mapeamento: Record<string, any>;
  logo_url: string;
  ativo: boolean;
  ordem: number;
}

export interface HealthConexao {
  conexao: string;
  health: { provider: string; port: string; ok: boolean; latencia_ms: number; detalhe: string };
  capabilities: string[];
  segredos_faltando: string[];
}

export interface Pendencia {
  produto: string;
  port: PortId;
  provider?: string;
  faltam?: string[];
  erro?: string;
}

export interface Resumo {
  modulos: { total: number; ligados: number; prontos: number };
  conexoes: { total: number; ativas: number };
  produtos_credito: { total: number; ativos: number };
  apps_entrega: { total: number; ativos: number };
  jornadas: number;
  pendencias: Pendencia[];
}

export interface RegistroAuditoria {
  id: string;
  quem: string;
  acao: string;
  entidade: string;
  entidade_id: string;
  antes: Record<string, any> | null;
  depois: Record<string, any> | null;
  em: string;
}
