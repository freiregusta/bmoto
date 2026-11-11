/**
 * Conexões — cadastrar qualquer fornecedor para qualquer módulo.
 *
 * O formulário é gerado a partir de `/admin/tipos`: o backend diz quais campos
 * cada tipo de fornecedor pede. Acrescentar um adapter novo no backend faz um
 * formulário novo aparecer aqui sem tocar nesta tela.
 *
 * Escopo é o que entrega a promessa "qualquer BaaS para qualquer módulo":
 * `global` vale para tudo, `produto:<id>` só naquele módulo.
 */

import { useMemo, useState } from "react";
import { Aviso, Campo, Card, Carregando, Chip, Icone, SecaoTitulo, Vazio } from "@/components/ui";
import { api } from "@/lib/api";
import { dataHora } from "@/lib/format";
import { usePlataforma } from "@/platform/PlatformProvider";
import type { CampoSpec, Conexao, FornecedorSpec, HealthConexao, PortId } from "@/platform/types";
import { salvar, useConexoes, useTipos } from "./useAdmin";

const EXEMPLO_AUTH = {
  tipo: "oauth2_client_credentials",
  token_url: "/oauth/token",
  env_client_id: "FORNECEDOR_CLIENT_ID",
  env_client_secret: "FORNECEDOR_CLIENT_SECRET",
};

const EXEMPLO_OPERACOES = {
  abrir_conta: {
    metodo: "POST",
    path: "/v1/accounts",
    body: { documentNumber: "{cpf}", fullName: "{nome}", birthDate: "{nascimento}" },
    resposta: { conta_id: "data.id", numero: "data.number", agencia: "data.branch" },
  },
  saldo: { metodo: "GET", path: "/v1/accounts/{conta_id}/balance",
           resposta: { valor: "data.available" } },
};

export default function Conexoes() {
  const { dados, carregando, recarregar } = useConexoes();
  const { dados: tipos } = useTipos();
  const { modulos, recarregar: recarregarPlataforma } = usePlataforma();
  const [editando, setEditando] = useState<Partial<Conexao> | null>(null);
  const [saude, setSaude] = useState<Record<string, HealthConexao>>({});
  const [erro, setErro] = useState<string | null>(null);

  const porPort = useMemo(() => {
    const mapa = new Map<string, Conexao[]>();
    (dados?.conexoes ?? []).forEach((c) => {
      mapa.set(c.port, [...(mapa.get(c.port) ?? []), c]);
    });
    return mapa;
  }, [dados]);

  const testar = async (id: string) => {
    const r = await salvar(() => api.post<HealthConexao>(`/admin/conexoes/${id}/testar`));
    if (r.ok) setSaude((s) => ({ ...s, [id]: r.dados }));
    else setErro(r.erro);
  };

  const alternar = async (c: Conexao) => {
    const r = c.ativo
      ? await salvar(() => api.post(`/admin/conexoes/${c.id}/desligar`))
      : await salvar(() => api.put(`/admin/conexoes/${c.id}`, { ...c, ativo: true }));
    if (!r.ok) return setErro(r.erro);
    await recarregar();
    await recarregarPlataforma();
  };

  const remover = async (c: Conexao) => {
    if (!window.confirm(`Remover a conexão "${c.titulo}"? Os módulos que a usam voltam ao fornecedor global.`))
      return;
    const r = await salvar(() => api.del(`/admin/conexoes/${c.id}`));
    if (!r.ok) return setErro(r.erro);
    await recarregar();
    await recarregarPlataforma();
  };

  if (carregando || !tipos) return <Carregando />;

  return (
    <div className="space-y-6">
      <SecaoTitulo
        titulo="Conexões"
        subtitulo="Quem atende cada capacidade da plataforma — e em qual módulo"
        acao={<button className="btn-primary btn-sm" onClick={() => setEditando({ escopo: "global" })}>
          <Icone nome="Plus" className="h-3.5 w-3.5" />Nova conexão
        </button>}
      />

      {erro && <Aviso tom="erro" titulo="Não deu">{erro}</Aviso>}

      {editando && (
        <FormularioConexao
          inicial={editando}
          tipos={tipos}
          modulos={modulos.map((m) => ({ id: m.id, titulo: m.titulo }))}
          onCancelar={() => setEditando(null)}
          onSalvo={async () => {
            setEditando(null);
            await recarregar();
            await recarregarPlataforma();
          }}
        />
      )}

      {tipos.ports.map((p) => {
        const lista = porPort.get(p.port) ?? [];
        return (
          <Card key={p.port}>
            <SecaoTitulo
              titulo={p.titulo}
              subtitulo={`Port "${p.port}" · variável de emergência: ${p.env}`}
              acao={<button className="btn-ghost btn-sm"
                            onClick={() => setEditando({ port: p.port, escopo: "global" })}>
                <Icone nome="Plus" className="h-3.5 w-3.5" />Adicionar
              </button>}
            />
            {lista.length === 0 ? (
              <p className="text-sm text-ink-faint">
                Nenhum fornecedor. Sem conexão ativa a plataforma usa o mock (ou a variável de
                ambiente, se houver).
              </p>
            ) : (
              <ul className="space-y-2">
                {lista.map((c) => (
                  <li key={c.id} className="rounded-xl border border-white/10 bg-white/[.03] p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{c.titulo}</span>
                      <Chip tom={c.ativo ? "on" : "off"}>{c.ativo ? "ativa" : "desligada"}</Chip>
                      <Chip>{c.tipo}</Chip>
                      <Chip tom={c.ambiente === "producao" ? "warn" : "neutro"}>{c.ambiente}</Chip>
                      <Chip tom={c.escopo === "global" ? "neutro" : "on"}>
                        {c.escopo === "global" ? "todos os módulos" : `só em ${c.escopo.split(":")[1]}`}
                      </Chip>
                      <span className="text-xs text-ink-faint">prioridade {c.prioridade}</span>
                    </div>
                    {saude[c.id] && <ResultadoTeste r={saude[c.id]} />}
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button className="btn-ghost btn-sm" onClick={() => void testar(c.id)}>
                        <Icone nome="Activity" className="h-3.5 w-3.5" />Testar
                      </button>
                      <button className="btn-ghost btn-sm" onClick={() => setEditando(c)}>
                        <Icone nome="Pencil" className="h-3.5 w-3.5" />Editar
                      </button>
                      <button className="btn-ghost btn-sm" onClick={() => void alternar(c)}>
                        <Icone nome={c.ativo ? "PowerOff" : "Power"} className="h-3.5 w-3.5" />
                        {c.ativo ? "Desligar" : "Ligar"}
                      </button>
                      <button className="btn-ghost btn-sm text-danger" onClick={() => void remover(c)}>
                        <Icone nome="Trash2" className="h-3.5 w-3.5" />Remover
                      </button>
                    </div>
                    <p className="mt-2 text-[11px] text-ink-faint">
                      atualizada em {dataHora(c.atualizado_em)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        );
      })}
    </div>
  );
}

function ResultadoTeste({ r }: { r: HealthConexao }) {
  return (
    <div className={`mt-3 rounded-xl border p-3 text-sm ${
      r.health.ok ? "border-mint/30 bg-mint/[.07]" : "border-danger/30 bg-danger/[.07]"}`}>
      <div className="flex items-center gap-2 font-semibold">
        <Icone nome={r.health.ok ? "CheckCircle2" : "AlertCircle"}
               className={`h-4 w-4 ${r.health.ok ? "text-mint" : "text-danger"}`} />
        {r.health.ok ? `Respondeu em ${r.health.latencia_ms} ms` : "Não respondeu"}
      </div>
      {r.health.detalhe && <p className="mt-1 text-ink-muted">{r.health.detalhe}</p>}
      {r.segredos_faltando.length > 0 && (
        <p className="mt-1 text-ink-muted">
          Falta definir no ambiente: <code className="text-warn">{r.segredos_faltando.join(", ")}</code>
        </p>
      )}
      {r.capabilities.length > 0 && (
        <p className="mt-2 flex flex-wrap gap-1">
          {r.capabilities.map((c) => <Chip key={c}>{c}</Chip>)}
        </p>
      )}
    </div>
  );
}

function FormularioConexao({ inicial, tipos, modulos, onCancelar, onSalvo }: {
  inicial: Partial<Conexao>;
  tipos: NonNullable<ReturnType<typeof useTipos>["dados"]>;
  modulos: Array<{ id: string; titulo: string }>;
  onCancelar: () => void;
  onSalvo: () => void | Promise<void>;
}) {
  const [port, setPort] = useState<PortId>((inicial.port as PortId) ?? "conta");
  const portInfo = tipos.ports.find((p) => p.port === port)!;
  const [tipo, setTipo] = useState(inicial.tipo ?? portInfo.fornecedores[0]?.tipo ?? "mock");
  const spec: FornecedorSpec | undefined = portInfo.fornecedores.find((f) => f.tipo === tipo);
  const [titulo, setTitulo] = useState(inicial.titulo ?? "");
  const [escopo, setEscopo] = useState(inicial.escopo ?? "global");
  const [ambiente, setAmbiente] = useState(inicial.ambiente ?? "sandbox");
  const [prioridade, setPrioridade] = useState(String(inicial.prioridade ?? 100));
  const [config, setConfig] = useState<Record<string, string>>(() =>
    Object.fromEntries(Object.entries(inicial.config ?? {}).map(([k, v]) => [
      k, typeof v === "string" || typeof v === "number" ? String(v) : JSON.stringify(v, null, 2),
    ])),
  );
  const [erros, setErros] = useState<Record<string, string>>({});
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const editando = Boolean(inicial.id);

  const definir = (chave: string, valor: string) => {
    setConfig((c) => ({ ...c, [chave]: valor }));
    setErros((e) => ({ ...e, [chave]: "" }));
  };

  const montarConfig = (): Record<string, unknown> | null => {
    const saida: Record<string, unknown> = {};
    const novosErros: Record<string, string> = {};
    for (const campo of spec?.campos ?? []) {
      const bruto = config[campo.chave]?.trim() ?? "";
      if (!bruto) {
        if (campo.obrigatorio) novosErros[campo.chave] = "Campo obrigatório";
        continue;
      }
      if (campo.tipo === "json") {
        try {
          saida[campo.chave] = JSON.parse(bruto);
        } catch {
          novosErros[campo.chave] = "JSON inválido";
        }
      } else if (campo.tipo === "numero") {
        saida[campo.chave] = Number(bruto);
      } else {
        saida[campo.chave] = bruto;
      }
    }
    setErros(novosErros);
    return Object.keys(novosErros).length ? null : saida;
  };

  const enviar = async () => {
    const cfg = montarConfig();
    if (!cfg) return;
    setEnviando(true);
    setErro(null);
    const corpo = { id: inicial.id, port, tipo, titulo: titulo || spec?.titulo, escopo,
                    ambiente, prioridade: Number(prioridade) || 100, config: cfg, ativo: true };
    const r = editando
      ? await salvar(() => api.put(`/admin/conexoes/${inicial.id}`, corpo))
      : await salvar(() => api.post("/admin/conexoes", corpo));
    setEnviando(false);
    if (!r.ok) return setErro(r.erro);
    await onSalvo();
  };

  return (
    <Card className="space-y-4 border-mint/30">
      <SecaoTitulo titulo={editando ? "Editar conexão" : "Nova conexão"}
                   subtitulo="Segredos entram pelo NOME da variável de ambiente, nunca pelo valor"
                   acao={<button className="btn-ghost btn-sm" onClick={onCancelar}>Cancelar</button>} />

      <div className="grid gap-3 sm:grid-cols-2">
        <Campo rotulo="Capacidade (port)" obrigatorio>
          <select className="input" value={port} disabled={editando}
                  onChange={(e) => {
                    const novo = e.target.value as PortId;
                    setPort(novo);
                    const prim = tipos.ports.find((p) => p.port === novo)?.fornecedores[0]?.tipo;
                    setTipo(prim ?? "mock");
                    setConfig({});
                  }}>
            {tipos.ports.map((p) => (
              <option key={p.port} value={p.port}>{p.titulo} ({p.port})</option>
            ))}
          </select>
        </Campo>
        <Campo rotulo="Fornecedor" obrigatorio ajuda={spec?.descricao}>
          <select className="input" value={tipo}
                  onChange={(e) => { setTipo(e.target.value); setConfig({}); }}>
            {portInfo.fornecedores.map((f) => (
              <option key={f.tipo} value={f.tipo}>
                {f.titulo}{f.sem_codigo ? " · sem código" : ""}
              </option>
            ))}
          </select>
        </Campo>
        <Campo rotulo="Nome que aparece no painel">
          <input className="input" value={titulo} placeholder={spec?.titulo}
                 onChange={(e) => setTitulo(e.target.value)} />
        </Campo>
        <Campo rotulo="Onde vale"
               ajuda="Global vale para todos os módulos; por módulo sobrepõe a global só ali.">
          <select className="input" value={escopo} onChange={(e) => setEscopo(e.target.value)}>
            <option value="global">Todos os módulos</option>
            {modulos.map((m) => (
              <option key={m.id} value={`produto:${m.id}`}>Só em {m.titulo}</option>
            ))}
          </select>
        </Campo>
        <Campo rotulo="Ambiente">
          <select className="input" value={ambiente}
                  onChange={(e) => setAmbiente(e.target.value as "sandbox" | "producao")}>
            <option value="sandbox">Sandbox</option>
            <option value="producao">Produção</option>
          </select>
        </Campo>
        <Campo rotulo="Prioridade" ajuda="Menor número vence quando há mais de uma no mesmo escopo.">
          <input className="input" inputMode="numeric" value={prioridade}
                 onChange={(e) => setPrioridade(e.target.value)} />
        </Campo>
      </div>

      {spec?.campos.length ? (
        <div className="space-y-3">
          <p className="label">Configuração do fornecedor</p>
          {spec.campos.map((campo) => (
            <CampoConfig key={campo.chave} campo={campo} port={port}
                         operacoes={portInfo.operacoes_rest}
                         valor={config[campo.chave] ?? ""}
                         erro={erros[campo.chave]}
                         onChange={(v) => definir(campo.chave, v)} />
          ))}
        </div>
      ) : (
        <Aviso tom="info">
          Este fornecedor não precisa de configuração: ou roda local (mock), ou lê as credenciais
          direto das variáveis de ambiente do serviço.
        </Aviso>
      )}

      {erro && <Aviso tom="erro">{erro}</Aviso>}

      <div className="flex gap-2">
        <button className="btn-primary flex-1" disabled={enviando} onClick={() => void enviar()}>
          {enviando ? "Salvando…" : editando ? "Salvar alterações" : "Criar conexão"}
        </button>
        <button className="btn-ghost" onClick={onCancelar}>Cancelar</button>
      </div>
    </Card>
  );
}

function CampoConfig({ campo, port, operacoes, valor, erro, onChange }: {
  campo: CampoSpec; port: PortId; operacoes: string[]; valor: string; erro?: string;
  onChange: (v: string) => void;
}) {
  const exemplo = campo.chave === "auth" ? EXEMPLO_AUTH
                : campo.chave === "operacoes" ? EXEMPLO_OPERACOES
                : campo.chave === "idempotencia" ? { header: "x-idempotency-key" }
                : campo.chave === "health" ? { metodo: "GET", path: "/v1/ping" }
                : null;

  if (campo.tipo === "json")
    return (
      <Campo rotulo={campo.titulo} ajuda={campo.ajuda} erro={erro} obrigatorio={campo.obrigatorio}>
        <textarea className="input min-h-[140px] font-mono text-xs" value={valor} spellCheck={false}
                  onChange={(e) => onChange(e.target.value)}
                  placeholder={exemplo ? JSON.stringify(exemplo, null, 2) : "{ }"} />
        <span className="mt-1 flex flex-wrap items-center gap-2">
          {exemplo && (
            <button type="button" className="btn-ghost btn-sm"
                    onClick={() => onChange(JSON.stringify(exemplo, null, 2))}>
              <Icone nome="Wand2" className="h-3 w-3" />Preencher exemplo
            </button>
          )}
          {campo.chave === "operacoes" && (
            <span className="text-[11px] text-ink-faint">
              válidas para {port}: {operacoes.join(", ")}
            </span>
          )}
        </span>
      </Campo>
    );

  return (
    <Campo rotulo={campo.titulo} ajuda={campo.ajuda} erro={erro} obrigatorio={campo.obrigatorio}>
      <input className="input" value={valor}
             inputMode={campo.tipo === "numero" ? "numeric" : undefined}
             placeholder={campo.default ? String(campo.default) : undefined}
             onChange={(e) => onChange(e.target.value)} />
    </Campo>
  );
}

export { Vazio };
