/**
 * Jornadas — montar o passo-a-passo que o app executa.
 *
 * É aqui que "organizar a jornada" acontece: acrescentar, reordenar e
 * condicionar passos. Cada tipo de passo tem o seu próprio editor de
 * configuração, porque pedir JSON cru para quem desenha jornada é maldade.
 */

import { useState } from "react";
import { Aviso, Campo, Card, Carregando, Chip, Icone, SecaoTitulo } from "@/components/ui";
import { api } from "@/lib/api";
import { usePlataforma } from "@/platform/PlatformProvider";
import type { CampoFormulario, Jornada, Passo, TipoPasso } from "@/platform/types";
import { salvar, useApps, useJornadas, useProdutosCredito, useTipos } from "./useAdmin";

const DESCRICAO_PASSO: Record<TipoPasso, string> = {
  formulario: "Campos que o entregador preenche",
  consentimento: "Texto + aceite registrado (LGPD, procuração, condições)",
  kyc: "Valida identidade no fornecedor de KYC ativo",
  conectar_app: "Consentimento e conexão dos apps de entrega",
  renda: "Consolida a renda dos apps conectados",
  oferta: "Roda a política do produto e devolve a oferta",
  escolha: "O entregador escolhe entre opções (prazo, plano, cobertura)",
  assinatura: "Emite o documento e colhe o aceite",
  provisionar: "Executa: abrir conta, emitir cartão, abrir MEI, seguro, saúde",
  revisao_manual: "Manda para a mesa de crédito",
  mensagem: "Tela informativa",
};

const ACOES_PROVISIONAR = [
  ["abrir_conta", "Abrir conta"],
  ["emitir_cartao", "Emitir cartão"],
  ["abrir_mei", "Abrir MEI"],
  ["emitir_seguro", "Emitir seguro"],
  ["aderir_saude", "Aderir ao plano de saúde"],
];

const AUTOMATICOS: TipoPasso[] = ["kyc", "renda", "oferta", "provisionar"];

export default function Jornadas() {
  const { dados, carregando, recarregar } = useJornadas();
  const [editando, setEditando] = useState<Partial<Jornada> | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  if (carregando || !dados) return <Carregando />;

  const remover = async (j: Jornada) => {
    if (!window.confirm(`Remover a jornada "${j.nome}"? O módulo fica sem fluxo até receber outra.`))
      return;
    const r = await salvar(() => api.del(`/admin/jornadas/${j.id}`));
    if (r.estado === "erro") return setErro(r.erro);
    await recarregar();
  };

  return (
    <div className="space-y-6">
      <SecaoTitulo
        titulo="Jornadas"
        subtitulo="A sequência de passos que o app executa em cada módulo"
        acao={<button className="btn-primary btn-sm"
                      onClick={() => setEditando({ nome: "", passos: [], ativo: true })}>
          <Icone nome="Plus" className="h-3.5 w-3.5" />Nova jornada
        </button>}
      />

      {erro && <Aviso tom="erro">{erro}</Aviso>}

      {editando && (
        <Editor inicial={editando} onCancelar={() => setEditando(null)}
                onSalvo={async () => { setEditando(null); await recarregar(); }} />
      )}

      <div className="space-y-3">
        {dados.jornadas.map((j) => (
          <Card key={j.id} className="space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-semibold">{j.nome}</p>
                <p className="mt-0.5 text-xs text-ink-faint">
                  v{j.versao} · {j.passos.length} passos
                  {j.modulo_id && <> · módulo {j.modulo_id}</>}
                  {j.produto_credito_id && <> · produto {j.produto_credito_id}</>}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Chip tom={j.ativo ? "on" : "off"}>{j.ativo ? "ativa" : "inativa"}</Chip>
                <button className="btn-ghost btn-sm" onClick={() => setEditando(j)}>
                  <Icone nome="Pencil" className="h-3.5 w-3.5" />Editar
                </button>
                <button className="btn-ghost btn-sm text-danger" onClick={() => void remover(j)}>
                  <Icone nome="Trash2" className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
            <ol className="flex flex-wrap items-center gap-1.5 text-xs">
              {j.passos.map((p, i) => (
                <li key={p.id} className="flex items-center gap-1.5">
                  <span className={`chip ${AUTOMATICOS.includes(p.tipo) ? "chip-on" : ""}`}>
                    {i + 1}. {p.titulo}
                    {p.condicao && <Icone nome="GitBranch" className="h-3 w-3" />}
                  </span>
                  {i < j.passos.length - 1 && (
                    <Icone nome="ChevronRight" className="h-3 w-3 text-ink-faint" />
                  )}
                </li>
              ))}
            </ol>
          </Card>
        ))}
      </div>
    </div>
  );
}

function Editor({ inicial, onCancelar, onSalvo }: {
  inicial: Partial<Jornada>; onCancelar: () => void; onSalvo: () => void | Promise<void>;
}) {
  const { modulos } = usePlataforma();
  const { dados: tipos } = useTipos();
  const { dados: produtos } = useProdutosCredito();
  const { dados: apps } = useApps();
  const [nome, setNome] = useState(inicial.nome ?? "");
  const [moduloId, setModuloId] = useState(inicial.modulo_id ?? "");
  const [produtoId, setProdutoId] = useState(inicial.produto_credito_id ?? "");
  const [ativo, setAtivo] = useState(inicial.ativo ?? true);
  const [passos, setPassos] = useState<Passo[]>(inicial.passos ?? []);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const editando = Boolean(inicial.id);

  const acrescentar = (tipo: TipoPasso) =>
    setPassos((ps) => [...ps, {
      id: `${tipo}_${ps.length + 1}`, tipo, titulo: rotuloPadrao(tipo), descricao: "",
      obrigatorio: true, condicao: null, config: configPadrao(tipo),
    }]);

  const mover = (i: number, delta: number) =>
    setPassos((ps) => {
      const j = i + delta;
      if (j < 0 || j >= ps.length) return ps;
      const copia = [...ps];
      [copia[i], copia[j]] = [copia[j], copia[i]];
      return copia;
    });

  const atualizar = (i: number, parcial: Partial<Passo>) =>
    setPassos((ps) => ps.map((p, idx) => (idx === i ? { ...p, ...parcial } : p)));

  const enviar = async () => {
    if (!nome.trim()) return setErro("Dê um nome à jornada.");
    if (passos.length === 0) return setErro("A jornada precisa de ao menos um passo.");
    setEnviando(true);
    setErro(null);
    const corpo = {
      nome, modulo_id: moduloId || null, produto_credito_id: produtoId || null, ativo,
      passos: passos.map((p) => ({ id: p.id, tipo: p.tipo, titulo: p.titulo,
                                   descricao: p.descricao ?? "", obrigatorio: p.obrigatorio ?? true,
                                   condicao: p.condicao || null, config: p.config })),
    };
    const r = editando
      ? await salvar(() => api.put(`/admin/jornadas/${inicial.id}`, corpo))
      : await salvar(() => api.post("/admin/jornadas", corpo));
    setEnviando(false);
    if (r.estado === "erro") return setErro(r.erro);
    await onSalvo();
  };

  return (
    <Card className="space-y-4 border-mint/30">
      <SecaoTitulo titulo={editando ? `Editar "${inicial.nome}"` : "Nova jornada"}
                   subtitulo="Salvar cria uma versão nova; execuções em andamento seguem na versão antiga"
                   acao={<button className="btn-ghost btn-sm" onClick={onCancelar}>Cancelar</button>} />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Campo rotulo="Nome" obrigatorio>
          <input className="input" value={nome} onChange={(e) => setNome(e.target.value)}
                 placeholder="Financiar uma moto" />
        </Campo>
        <Campo rotulo="Módulo do app"
               ajuda="O app busca a jornada ativa deste módulo.">
          <select className="input" value={moduloId} onChange={(e) => setModuloId(e.target.value)}>
            <option value="">— nenhum —</option>
            {modulos.map((m) => <option key={m.id} value={m.id}>{m.titulo}</option>)}
          </select>
        </Campo>
        <Campo rotulo="Produto de crédito">
          <select className="input" value={produtoId} onChange={(e) => setProdutoId(e.target.value)}>
            <option value="">— nenhum —</option>
            {(produtos?.produtos ?? []).map((p) => (
              <option key={p.id} value={p.id}>{p.nome}</option>
            ))}
          </select>
        </Campo>
        <Campo rotulo="Situação">
          <label className="flex h-[48px] cursor-pointer items-center gap-2 text-sm">
            <input type="checkbox" checked={ativo} className="h-4 w-4 accent-[#2DD4A8]"
                   onChange={(e) => setAtivo(e.target.checked)} />
            Jornada ativa
          </label>
        </Campo>
      </div>

      <div>
        <p className="label mb-2">Acrescentar passo</p>
        <div className="flex flex-wrap gap-1.5">
          {(tipos?.tipos_passo ?? []).map((t) => (
            <button key={t} type="button" className="btn-ghost btn-sm"
                    title={DESCRICAO_PASSO[t]} onClick={() => acrescentar(t)}>
              <Icone nome="Plus" className="h-3 w-3" />
              {rotuloTipo(t)}
            </button>
          ))}
        </div>
      </div>

      <ol className="space-y-3">
        {passos.map((p, i) => (
          <li key={`${p.id}-${i}`} className="rounded-xl border border-white/10 bg-white/[.03] p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="chip">{i + 1}</span>
              <Chip tom={AUTOMATICOS.includes(p.tipo) ? "on" : "neutro"}>{rotuloTipo(p.tipo)}</Chip>
              <span className="text-xs text-ink-faint">{DESCRICAO_PASSO[p.tipo]}</span>
              <span className="ml-auto flex gap-1">
                <button className="btn-ghost btn-sm" onClick={() => mover(i, -1)}
                        disabled={i === 0} aria-label="Subir">
                  <Icone nome="ChevronUp" className="h-3.5 w-3.5" />
                </button>
                <button className="btn-ghost btn-sm" onClick={() => mover(i, 1)}
                        disabled={i === passos.length - 1} aria-label="Descer">
                  <Icone nome="ChevronDown" className="h-3.5 w-3.5" />
                </button>
                <button className="btn-ghost btn-sm text-danger"
                        onClick={() => setPassos((ps) => ps.filter((_, idx) => idx !== i))}
                        aria-label="Remover passo">
                  <Icone nome="Trash2" className="h-3.5 w-3.5" />
                </button>
              </span>
            </div>

            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <Campo rotulo="Título visto pelo entregador">
                <input className="input" value={p.titulo}
                       onChange={(e) => atualizar(i, { titulo: e.target.value })} />
              </Campo>
              <Campo rotulo="Condição para exibir"
                     ajuda='Ex.: renda_media >= 1800 · oferta.aprovado == true · cnpj_mei'>
                <input className="input font-mono text-xs" value={p.condicao ?? ""}
                       placeholder="sempre exibir"
                       onChange={(e) => atualizar(i, { condicao: e.target.value })} />
              </Campo>
            </div>

            <ConfigPasso passo={p} produtos={(produtos?.produtos ?? []).map((x) => ({ id: x.id, nome: x.nome }))}
                         apps={(apps?.apps ?? []).map((a) => ({ slug: a.slug, nome: a.nome }))}
                         onChange={(config) => atualizar(i, { config })} />
          </li>
        ))}
      </ol>

      {passos.length === 0 && (
        <Aviso tom="info">
          Comece pelos passos de dados e consentimento, depois os automáticos (renda, oferta) e
          feche com assinatura e provisionamento.
        </Aviso>
      )}

      {erro && <Aviso tom="erro">{erro}</Aviso>}

      <div className="flex gap-2">
        <button className="btn-primary flex-1" disabled={enviando} onClick={() => void enviar()}>
          {enviando ? "Salvando…" : editando ? "Salvar nova versão" : "Criar jornada"}
        </button>
        <button className="btn-ghost" onClick={onCancelar}>Cancelar</button>
      </div>
    </Card>
  );
}

function ConfigPasso({ passo, produtos, apps, onChange }: {
  passo: Passo;
  produtos: Array<{ id: string; nome: string }>;
  apps: Array<{ slug: string; nome: string }>;
  onChange: (config: Passo["config"]) => void;
}) {
  const cfg = passo.config;
  const d = (chave: string, valor: unknown) => onChange({ ...cfg, [chave]: valor });

  if (passo.tipo === "formulario")
    return <EditorCampos campos={cfg.campos ?? []} onChange={(campos) => d("campos", campos)} />;

  if (passo.tipo === "consentimento")
    return (
      <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto]">
        <Campo rotulo="Texto do termo">
          <textarea className="input min-h-[90px] text-sm" value={cfg.texto ?? ""}
                    onChange={(e) => d("texto", e.target.value)} />
        </Campo>
        <Campo rotulo="Versão">
          <input className="input" value={cfg.versao ?? "v1"}
                 onChange={(e) => d("versao", e.target.value)} />
        </Campo>
      </div>
    );

  if (passo.tipo === "conectar_app")
    return (
      <div className="mt-3 space-y-2">
        <p className="label">Apps oferecidos</p>
        <div className="flex flex-wrap gap-1.5">
          {apps.map((a) => {
            const marcado = (cfg.apps ?? []).includes(a.slug);
            return (
              <button key={a.slug} type="button"
                      className={`chip ${marcado ? "chip-on" : "chip-off"}`}
                      onClick={() =>
                        d("apps", marcado ? (cfg.apps ?? []).filter((s) => s !== a.slug)
                                          : [...(cfg.apps ?? []), a.slug])}>
                {a.nome}
              </button>
            );
          })}
          {apps.length === 0 && <span className="text-xs text-ink-faint">
            Nenhuma plataforma cadastrada ainda.
          </span>}
        </div>
        <Campo rotulo="Mínimo de apps">
          <input className="input w-24" inputMode="numeric" value={String(cfg.minimo ?? 1)}
                 onChange={(e) => d("minimo", Number(e.target.value) || 1)} />
        </Campo>
      </div>
    );

  if (passo.tipo === "renda")
    return (
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Campo rotulo="Meses de histórico">
          <input className="input" inputMode="numeric" value={String(cfg.meses ?? 3)}
                 onChange={(e) => d("meses", Number(e.target.value) || 3)} />
        </Campo>
        <Campo rotulo="Renda mínima para seguir (R$)" ajuda="0 = não barra ninguém aqui">
          <input className="input" inputMode="decimal" value={String(cfg.minimo ?? 0)}
                 onChange={(e) => d("minimo", Number(e.target.value) || 0)} />
        </Campo>
      </div>
    );

  if (passo.tipo === "oferta")
    return (
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Campo rotulo="Produto de crédito" obrigatorio>
          <select className="input" value={cfg.produto_credito_id ?? ""}
                  onChange={(e) => d("produto_credito_id", e.target.value)}>
            <option value="">— escolha —</option>
            {produtos.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
          </select>
        </Campo>
        <Campo rotulo="Se recusar">
          <label className="flex h-[48px] cursor-pointer items-center gap-2 text-sm">
            <input type="checkbox" checked={!!cfg.mesa_se_recusar} className="h-4 w-4 accent-[#2DD4A8]"
                   onChange={(e) => d("mesa_se_recusar", e.target.checked)} />
            Mandar para a mesa em vez de recusar
          </label>
        </Campo>
      </div>
    );

  if (passo.tipo === "kyc")
    return (
      <label className="mt-3 flex cursor-pointer items-center gap-2 text-sm">
        <input type="checkbox" checked={!!cfg.mesa_se_reprovar} className="h-4 w-4 accent-[#2DD4A8]"
               onChange={(e) => d("mesa_se_reprovar", e.target.checked)} />
        Se reprovar, mandar para a mesa em vez de recusar
      </label>
    );

  if (passo.tipo === "escolha")
    return (
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Campo rotulo="Chave no contexto" ajuda="Ex.: prazo, plano, cobertura">
          <input className="input font-mono text-xs" value={cfg.chave ?? ""}
                 onChange={(e) => d("chave", e.target.value)} />
        </Campo>
        <Campo rotulo="Opções separadas por vírgula">
          <input className="input" value={(cfg.opcoes ?? []).join(", ")}
                 placeholder="24, 36, 48"
                 onChange={(e) =>
                   d("opcoes", e.target.value.split(",").map((s) => {
                     const t = s.trim();
                     const n = Number(t);
                     return t !== "" && Number.isFinite(n) ? n : t;
                   }).filter((v) => v !== ""))} />
        </Campo>
      </div>
    );

  if (passo.tipo === "assinatura")
    return (
      <Campo rotulo="Documento">
        <select className="input mt-3" value={cfg.documento ?? "ccb"}
                onChange={(e) => d("documento", e.target.value)}>
          <option value="ccb">CCB (Cédula de Crédito Bancário)</option>
          <option value="contrato_cartao">Contrato do cartão</option>
          <option value="termo_adesao">Termo de adesão</option>
        </select>
      </Campo>
    );

  if (passo.tipo === "provisionar")
    return (
      <div className="mt-3 space-y-2">
        <p className="label">O que criar neste passo</p>
        <div className="flex flex-wrap gap-1.5">
          {ACOES_PROVISIONAR.map(([valor, rotulo]) => {
            const marcado = (cfg.acoes ?? []).includes(valor);
            return (
              <button key={valor} type="button"
                      className={`chip ${marcado ? "chip-on" : "chip-off"}`}
                      onClick={() =>
                        d("acoes", marcado ? (cfg.acoes ?? []).filter((a) => a !== valor)
                                           : [...(cfg.acoes ?? []), valor])}>
                {rotulo}
              </button>
            );
          })}
        </div>
        {(cfg.acoes ?? []).includes("emitir_seguro") && (
          <Campo rotulo="Produto de seguro">
            <select className="input" value={String(cfg.produto ?? "vida_ap")}
                    onChange={(e) => d("produto", e.target.value)}>
              <option value="vida_ap">Vida e acidentes pessoais</option>
              <option value="moto">Seguro da moto</option>
            </select>
          </Campo>
        )}
        {(cfg.acoes ?? []).includes("abrir_mei") && (
          <Campo rotulo="CNAE">
            <input className="input" value={String(cfg.cnae ?? "5320-2/02")}
                   onChange={(e) => d("cnae", e.target.value)} />
          </Campo>
        )}
      </div>
    );

  if (passo.tipo === "mensagem")
    return (
      <Campo rotulo="Texto">
        <textarea className="input mt-3 min-h-[80px] text-sm" value={cfg.texto ?? ""}
                  onChange={(e) => d("texto", e.target.value)} />
      </Campo>
    );

  if (passo.tipo === "revisao_manual")
    return (
      <Campo rotulo="Fila da mesa">
        <input className="input mt-3" value={String(cfg.fila ?? "credito")}
               onChange={(e) => d("fila", e.target.value)} />
      </Campo>
    );

  return null;
}

function EditorCampos({ campos, onChange }: {
  campos: CampoFormulario[]; onChange: (c: CampoFormulario[]) => void;
}) {
  const atualizar = (i: number, parcial: Partial<CampoFormulario>) =>
    onChange(campos.map((c, idx) => (idx === i ? { ...c, ...parcial } : c)));

  return (
    <div className="mt-3 space-y-2">
      <div className="flex items-center justify-between">
        <p className="label">Campos do formulário</p>
        <button type="button" className="btn-ghost btn-sm"
                onClick={() => onChange([...campos, { chave: "", titulo: "", tipo: "texto",
                                                      obrigatorio: false }])}>
          <Icone nome="Plus" className="h-3 w-3" />Campo
        </button>
      </div>
      {campos.map((c, i) => (
        <div key={i} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto_auto_auto]">
          <input className="input py-2 text-sm font-mono" placeholder="chave" value={c.chave}
                 onChange={(e) => atualizar(i, { chave: e.target.value })} />
          <input className="input py-2 text-sm" placeholder="Rótulo" value={c.titulo}
                 onChange={(e) => atualizar(i, { titulo: e.target.value })} />
          <select className="input py-2 text-sm" value={c.tipo ?? "texto"}
                  onChange={(e) => atualizar(i, { tipo: e.target.value as CampoFormulario["tipo"] })}>
            {["texto", "email", "telefone", "data", "moeda", "numero", "cpf", "select"].map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          <label className="flex items-center gap-1.5 whitespace-nowrap text-xs">
            <input type="checkbox" checked={!!c.obrigatorio} className="h-4 w-4 accent-[#2DD4A8]"
                   onChange={(e) => atualizar(i, { obrigatorio: e.target.checked })} />
            obrigatório
          </label>
          <button type="button" className="btn-ghost btn-sm text-danger"
                  onClick={() => onChange(campos.filter((_, idx) => idx !== i))}
                  aria-label="Remover campo">
            <Icone nome="X" className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
      {campos.length === 0 && (
        <p className="text-xs text-ink-faint">
          Nenhum campo. O passo vai pedir só um "Continuar".
        </p>
      )}
    </div>
  );
}

const ROTULOS: Record<TipoPasso, string> = {
  formulario: "Formulário", consentimento: "Consentimento", kyc: "KYC",
  conectar_app: "Conectar apps", renda: "Ler renda", oferta: "Oferta",
  escolha: "Escolha", assinatura: "Assinatura", provisionar: "Provisionar",
  revisao_manual: "Mesa", mensagem: "Mensagem",
};

const rotuloTipo = (t: TipoPasso) => ROTULOS[t] ?? t;

function rotuloPadrao(tipo: TipoPasso): string {
  return ({ formulario: "Seus dados", consentimento: "Autorização", kyc: "Confirmação de identidade",
            conectar_app: "Conecte seus apps", renda: "Analisando seus ganhos",
            oferta: "Sua oferta", escolha: "Escolha uma opção", assinatura: "Assinatura",
            provisionar: "Finalizando", revisao_manual: "Em análise",
            mensagem: "Pronto" } as Record<TipoPasso, string>)[tipo];
}

function configPadrao(tipo: TipoPasso): Passo["config"] {
  switch (tipo) {
    case "formulario": return { campos: [] };
    case "consentimento": return { texto: "", versao: "v1" };
    case "conectar_app": return { apps: [], minimo: 1 };
    case "renda": return { meses: 3, minimo: 0 };
    case "oferta": return { produto_credito_id: "" };
    case "escolha": return { chave: "", opcoes: [] };
    case "assinatura": return { documento: "ccb" };
    case "provisionar": return { acoes: [] };
    case "mensagem": return { texto: "" };
    case "revisao_manual": return { fila: "credito" };
    default: return {};
  }
}
