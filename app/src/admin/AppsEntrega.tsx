/**
 * Apps de entrega — iFood, Rappi, 99, Uber e qualquer plataforma regional.
 *
 * O que importa aqui: como a BMoto lê a renda daquele app (API própria, Open
 * Finance, webhook, arquivo ou lançamento manual) e como o repasse chega. Uma
 * plataforma com API própria entra pelo REST genérico, sem código.
 */

import { useState } from "react";
import { Aviso, Campo, Card, Carregando, Chip, Icone, SecaoTitulo } from "@/components/ui";
import { api } from "@/lib/api";
import { pct } from "@/lib/format";
import type { AppEntrega, HealthConexao } from "@/platform/types";
import { salvar, useApps, useTipos } from "./useAdmin";

const ROTULO_INTEGRACAO: Record<string, string> = {
  api: "API própria da plataforma",
  open_finance: "Open Finance (conta onde cai o repasse)",
  webhook: "Webhook enviado pela plataforma",
  arquivo: "Arquivo/extrato enviado pelo entregador",
  manual: "Lançamento manual no app",
};

const EXEMPLO_REST = {
  base_url: "https://api.plataforma.com",
  auth: { tipo: "oauth2_client_credentials", token_url: "/oauth/token",
          env_client_id: "PLATAFORMA_ID", env_client_secret: "PLATAFORMA_SECRET" },
  operacoes: {
    consentir_renda: { metodo: "POST", path: "/v1/consents",
                       body: { document: "{cpf}" }, resposta: { consentimento_id: "data.id" } },
    ler_renda: { metodo: "GET", path: "/v1/earnings", query: { consent: "{consentimento_id}" },
                 lista: "data.months",
                 item: { competencia: "month", bruto: "gross", corridas: "deliveries", km: "distance" } },
  },
};

const VAZIO: Partial<AppEntrega> = {
  nome: "", tipo_integracao: "api", provider_tipo: "mock", config: {}, repasse_direto: false,
  periodicidade_repasse: "semanal", taxa_plataforma: 0, ativo: true, ordem: 100,
};

export default function AppsEntrega() {
  const { dados, carregando, recarregar } = useApps();
  const { dados: tipos } = useTipos();
  const [editando, setEditando] = useState<Partial<AppEntrega> | null>(null);
  const [saude, setSaude] = useState<Record<string, HealthConexao>>({});
  const [erro, setErro] = useState<string | null>(null);

  if (carregando || !dados || !tipos) return <Carregando />;

  const testar = async (id: string) => {
    const r = await salvar(() => api.post<HealthConexao>(`/admin/apps-entrega/${id}/testar`));
    if (r.estado === "ok") setSaude((s) => ({ ...s, [id]: r.dados }));
    else setErro(r.erro);
  };

  const remover = async (a: AppEntrega) => {
    if (!window.confirm(`Remover "${a.nome}"? Entregadores já conectados deixam de ser lidos.`))
      return;
    const r = await salvar(() => api.del(`/admin/apps-entrega/${a.id}`));
    if (r.estado === "erro") return setErro(r.erro);
    await recarregar();
  };

  return (
    <div className="space-y-6">
      <SecaoTitulo
        titulo="Apps de entrega"
        subtitulo="De onde vem a renda do entregador e como o repasse chega"
        acao={<button className="btn-primary btn-sm" onClick={() => setEditando(VAZIO)}>
          <Icone nome="Plus" className="h-3.5 w-3.5" />Nova plataforma
        </button>}
      />

      {erro && <Aviso tom="erro">{erro}</Aviso>}

      {editando && (
        <Formulario inicial={editando} tiposIntegracao={tipos.tipos_integracao_app}
                    onCancelar={() => setEditando(null)}
                    onSalvo={async () => { setEditando(null); await recarregar(); }} />
      )}

      <div className="grid gap-3 lg:grid-cols-2">
        {dados.apps.map((a) => (
          <Card key={a.id} className="space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-semibold">{a.nome}</p>
                <p className="mt-0.5 text-xs text-ink-faint">
                  {ROTULO_INTEGRACAO[a.tipo_integracao] ?? a.tipo_integracao}
                </p>
              </div>
              <Chip tom={a.ativo ? "on" : "off"}>{a.ativo ? "ativo" : "inativo"}</Chip>
            </div>

            <div className="flex flex-wrap gap-2 text-xs">
              <Chip>slug: {a.slug}</Chip>
              <Chip>{a.provider_tipo === "rest" ? "integração própria" : "mock"}</Chip>
              <Chip>repasse {a.periodicidade_repasse}</Chip>
              {a.repasse_direto && <Chip tom="on">cai na conta BMoto</Chip>}
              {a.taxa_plataforma > 0 && <Chip>retém {pct(a.taxa_plataforma, 1)}</Chip>}
            </div>

            {saude[a.id] && (
              <div className={`rounded-xl border p-3 text-sm ${
                saude[a.id].health.ok ? "border-mint/30 bg-mint/[.07]"
                                      : "border-danger/30 bg-danger/[.07]"}`}>
                {saude[a.id].health.ok
                  ? `Respondeu em ${saude[a.id].health.latencia_ms} ms`
                  : saude[a.id].health.detalhe || "Não respondeu"}
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              <button className="btn-ghost btn-sm" onClick={() => void testar(a.id)}>
                <Icone nome="Activity" className="h-3.5 w-3.5" />Testar
              </button>
              <button className="btn-ghost btn-sm" onClick={() => setEditando(a)}>
                <Icone nome="Pencil" className="h-3.5 w-3.5" />Editar
              </button>
              <button className="btn-ghost btn-sm text-danger" onClick={() => void remover(a)}>
                <Icone nome="Trash2" className="h-3.5 w-3.5" />Remover
              </button>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

function Formulario({ inicial, tiposIntegracao, onCancelar, onSalvo }: {
  inicial: Partial<AppEntrega>;
  tiposIntegracao: string[];
  onCancelar: () => void;
  onSalvo: () => void | Promise<void>;
}) {
  const [f, setF] = useState<Partial<AppEntrega>>({ ...VAZIO, ...inicial });
  const [configTexto, setConfigTexto] = useState(
    Object.keys(inicial.config ?? {}).length ? JSON.stringify(inicial.config, null, 2) : "");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const editando = Boolean(inicial.id);
  const d = (chave: keyof AppEntrega, valor: unknown) => setF((a) => ({ ...a, [chave]: valor }));

  const enviar = async () => {
    if (!f.nome?.trim()) return setErro("Dê um nome à plataforma.");
    let config: Record<string, unknown> = {};
    if (f.provider_tipo === "rest") {
      try {
        config = JSON.parse(configTexto || "{}");
      } catch {
        return setErro("A configuração REST não é um JSON válido.");
      }
    }
    setEnviando(true);
    setErro(null);
    const corpo = { ...f, config, taxa_plataforma: Number(f.taxa_plataforma ?? 0),
                    ordem: Number(f.ordem ?? 100) };
    const r = editando
      ? await salvar(() => api.put(`/admin/apps-entrega/${inicial.id}`, corpo))
      : await salvar(() => api.post("/admin/apps-entrega", corpo));
    setEnviando(false);
    if (r.estado === "erro") return setErro(r.erro);
    await onSalvo();
  };

  return (
    <Card className="space-y-4 border-mint/30">
      <SecaoTitulo titulo={editando ? "Editar plataforma" : "Nova plataforma de entrega"}
                   acao={<button className="btn-ghost btn-sm" onClick={onCancelar}>Cancelar</button>} />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Campo rotulo="Nome" obrigatorio>
          <input className="input" value={f.nome ?? ""} placeholder="iFood"
                 onChange={(e) => d("nome", e.target.value)} />
        </Campo>
        <Campo rotulo="Identificador (slug)"
               ajuda="Gerado do nome se ficar vazio. É o que as jornadas usam.">
          <input className="input" value={f.slug ?? ""} placeholder="ifood"
                 onChange={(e) => d("slug", e.target.value)} />
        </Campo>
        <Campo rotulo="Como lemos a renda" obrigatorio>
          <select className="input" value={f.tipo_integracao}
                  onChange={(e) => d("tipo_integracao", e.target.value)}>
            {tiposIntegracao.map((t) => (
              <option key={t} value={t}>{ROTULO_INTEGRACAO[t] ?? t}</option>
            ))}
          </select>
        </Campo>
        <Campo rotulo="Integração"
               ajuda="REST genérico = descrever a API aqui, sem deploy.">
          <select className="input" value={f.provider_tipo}
                  onChange={(e) => d("provider_tipo", e.target.value as "mock" | "rest")}>
            <option value="mock">Mock (demonstração)</option>
            <option value="rest">REST genérico</option>
          </select>
        </Campo>
        <Campo rotulo="Periodicidade do repasse">
          <select className="input" value={f.periodicidade_repasse}
                  onChange={(e) => d("periodicidade_repasse", e.target.value)}>
            <option value="diario">Diário</option>
            <option value="semanal">Semanal</option>
            <option value="quinzenal">Quinzenal</option>
          </select>
        </Campo>
        <Campo rotulo="Taxa que a plataforma retém (decimal)" ajuda="0.12 = 12%">
          <input className="input" inputMode="decimal" value={String(f.taxa_plataforma ?? 0)}
                 onChange={(e) => d("taxa_plataforma", e.target.value)} />
        </Campo>
        <Campo rotulo="Ordem na lista">
          <input className="input" inputMode="numeric" value={String(f.ordem ?? 100)}
                 onChange={(e) => d("ordem", e.target.value)} />
        </Campo>
      </div>

      <div className="flex flex-wrap gap-4">
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input type="checkbox" checked={!!f.repasse_direto} className="h-4 w-4 accent-[#2DD4A8]"
                 onChange={(e) => d("repasse_direto", e.target.checked)} />
          O repasse cai direto na chave Pix da conta BMoto
        </label>
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input type="checkbox" checked={!!f.ativo} className="h-4 w-4 accent-[#2DD4A8]"
                 onChange={(e) => d("ativo", e.target.checked)} />
          Plataforma ativa
        </label>
      </div>

      {f.provider_tipo === "rest" && (
        <Campo rotulo="Configuração da API"
               ajuda="Precisa declarar ao menos a operação 'ler_renda'. Segredos pelo nome da variável de ambiente.">
          <textarea className="input min-h-[200px] font-mono text-xs" spellCheck={false}
                    value={configTexto} onChange={(e) => setConfigTexto(e.target.value)}
                    placeholder={JSON.stringify(EXEMPLO_REST, null, 2)} />
          <button type="button" className="btn-ghost btn-sm mt-1"
                  onClick={() => setConfigTexto(JSON.stringify(EXEMPLO_REST, null, 2))}>
            <Icone nome="Wand2" className="h-3 w-3" />Preencher exemplo
          </button>
        </Campo>
      )}

      {f.tipo_integracao === "open_finance" && (
        <Aviso tom="info">
          Open Finance não lê o app: lê a conta onde o repasse cai. Precisa de um participante
          habilitado e do consentimento do entregador na jornada.
        </Aviso>
      )}

      {erro && <Aviso tom="erro">{erro}</Aviso>}

      <div className="flex gap-2">
        <button className="btn-primary flex-1" disabled={enviando} onClick={() => void enviar()}>
          {enviando ? "Salvando…" : editando ? "Salvar alterações" : "Criar plataforma"}
        </button>
        <button className="btn-ghost" onClick={onCancelar}>Cancelar</button>
      </div>
    </Card>
  );
}
