/**
 * Produtos de crédito — cartão, moto, pessoal, antecipação, consignado.
 *
 * Todos saem do mesmo molde paramétrico, então criar um produto novo é
 * preencher um formulário: taxa, prazo, ticket, garantia/LTV e política. O
 * simulador roda a política real do backend antes de publicar.
 */

import { useState } from "react";
import { Aviso, Campo, Card, Carregando, Chip, Icone, SecaoTitulo } from "@/components/ui";
import { api } from "@/lib/api";
import { brl, paraNumero, pct } from "@/lib/format";
import { usePlataforma } from "@/platform/PlatformProvider";
import type { Oferta, ProdutoCredito } from "@/platform/types";
import { salvar, useConexoes, useJornadas, useProdutosCredito, useTipos } from "./useAdmin";

const ROTULO_TIPO: Record<string, string> = {
  financiamento_moto: "Financiamento de moto",
  cartao_garantido: "Cartão com garantia",
  cartao_credito: "Cartão de crédito",
  credito_pessoal: "Crédito pessoal",
  antecipacao_recebiveis: "Antecipação de recebíveis",
  consignado_clt: "Consignado CLT",
  consignado_app: "Consignado do entregador",
  financiamento_celular: "Financiamento de celular",
};

const COBRANCAS = [
  ["pix_automatico", "Débito automático (Pix Automático)"],
  ["desconto_repasse", "Desconto no repasse dos apps"],
  ["boleto", "Boleto mensal"],
];

const VAZIO: Partial<ProdutoCredito> = {
  nome: "", tipo: "credito_pessoal", taxa_mensal: 0.0299, prazo_min: 6, prazo_max: 24,
  ticket_min: 500, ticket_max: 10_000, garantia_tipo: "nenhuma", ltv_max: 0,
  score_minimo: 550, renda_minima: 1_500, comprometimento_max: 0.25, idade_min: 18,
  idade_max: 70, exige_mei: false, exige_kyc: true, meses_renda_comprovada: 3, tac: 0,
  cobranca: "desconto_repasse", ativo: true,
};

export default function ProdutosCredito() {
  const { dados, carregando, recarregar } = useProdutosCredito();
  const { dados: tipos } = useTipos();
  const { dados: conexoes } = useConexoes();
  const { dados: jornadas } = useJornadas();
  const { modulos } = usePlataforma();
  const [editando, setEditando] = useState<Partial<ProdutoCredito> | null>(null);
  const [simulando, setSimulando] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  if (carregando || !dados || !tipos) return <Carregando />;

  const remover = async (p: ProdutoCredito) => {
    if (!window.confirm(`Remover "${p.nome}"? Jornadas que o usam deixam de ofertar.`)) return;
    const r = await salvar(() => api.del(`/admin/produtos-credito/${p.id}`));
    if (r.estado === "erro") return setErro(r.erro);
    await recarregar();
  };

  const alternar = async (p: ProdutoCredito) => {
    const r = await salvar(() =>
      api.put(`/admin/produtos-credito/${p.id}`, { nome: p.nome, tipo: p.tipo, ativo: !p.ativo }));
    if (r.estado === "erro") return setErro(r.erro);
    await recarregar();
  };

  return (
    <div className="space-y-6">
      <SecaoTitulo
        titulo="Produtos de crédito"
        subtitulo="Política, preço e garantia de cada produto — sem deploy"
        acao={<button className="btn-primary btn-sm" onClick={() => setEditando(VAZIO)}>
          <Icone nome="Plus" className="h-3.5 w-3.5" />Novo produto
        </button>}
      />

      {erro && <Aviso tom="erro">{erro}</Aviso>}

      {editando && (
        <Formulario
          inicial={editando}
          tiposDisponiveis={tipos.tipos_produto_credito}
          emissores={(conexoes?.conexoes ?? []).filter((c) => c.port === "credito")}
          jornadas={(jornadas?.jornadas ?? []).map((j) => ({ id: j.id, nome: j.nome }))}
          modulos={modulos.map((m) => ({ id: m.id, titulo: m.titulo }))}
          onCancelar={() => setEditando(null)}
          onSalvo={async () => { setEditando(null); await recarregar(); }}
        />
      )}

      <div className="grid gap-3 lg:grid-cols-2">
        {dados.produtos.map((p) => (
          <Card key={p.id} className="space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-semibold">{p.nome}</p>
                <p className="mt-0.5 text-xs text-ink-faint">
                  {ROTULO_TIPO[p.tipo] ?? p.tipo}
                  {p.modulo_id && <> · módulo {p.modulo_id}</>}
                </p>
              </div>
              <Chip tom={p.ativo ? "on" : "off"}>{p.ativo ? "ativo" : "inativo"}</Chip>
            </div>

            <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
              <Dado rotulo="Taxa" valor={`${pct(p.taxa_mensal)} a.m.`} />
              <Dado rotulo="Prazo" valor={`${p.prazo_min}–${p.prazo_max}x`} />
              <Dado rotulo="Ticket" valor={`${brl(p.ticket_min, 0)}–${brl(p.ticket_max, 0)}`} />
              <Dado rotulo="Score mín." valor={String(p.score_minimo)} />
              <Dado rotulo="Renda mín." valor={brl(p.renda_minima, 0)} />
              <Dado rotulo="Compr. máx." valor={pct(p.comprometimento_max, 0)} />
              <Dado rotulo="Garantia"
                    valor={p.garantia_tipo && p.garantia_tipo !== "nenhuma"
                      ? `${p.garantia_tipo} · LTV ${pct(p.ltv_max, 0)}` : "nenhuma"} />
              <Dado rotulo="Cobrança"
                    valor={(COBRANCAS.find(([v]) => v === p.cobranca)?.[1] ?? p.cobranca)
                      .replace(/\s*\(.*\)/, "")} />
            </dl>

            <div className="flex flex-wrap gap-2">
              <button className="btn-ghost btn-sm"
                      onClick={() => setSimulando(simulando === p.id ? null : p.id)}>
                <Icone nome="Calculator" className="h-3.5 w-3.5" />Simular
              </button>
              <button className="btn-ghost btn-sm" onClick={() => setEditando(p)}>
                <Icone nome="Pencil" className="h-3.5 w-3.5" />Editar
              </button>
              <button className="btn-ghost btn-sm" onClick={() => void alternar(p)}>
                <Icone nome={p.ativo ? "PowerOff" : "Power"} className="h-3.5 w-3.5" />
                {p.ativo ? "Desativar" : "Ativar"}
              </button>
              <button className="btn-ghost btn-sm text-danger" onClick={() => void remover(p)}>
                <Icone nome="Trash2" className="h-3.5 w-3.5" />Remover
              </button>
            </div>

            {simulando === p.id && <Simulador produto={p} />}
          </Card>
        ))}
      </div>
    </div>
  );
}

function Dado({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div>
      <dt className="label">{rotulo}</dt>
      <dd className="mt-0.5 font-medium">{valor}</dd>
    </div>
  );
}

function Simulador({ produto }: { produto: ProdutoCredito }) {
  const [p, setP] = useState({ score: 600, renda_media: 3000, idade: 32, meses_renda: 6,
                               valor_garantia: produto.ltv_max > 0 ? 20000 : 0,
                               solicitado: "", parcelas: String(produto.prazo_max) });
  const [res, setRes] = useState<Oferta | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [rodando, setRodando] = useState(false);

  const rodar = async () => {
    setRodando(true);
    setErro(null);
    const r = await salvar(() =>
      api.post<Oferta>(`/admin/produtos-credito/${produto.id}/simular`, {
        score: Number(p.score), renda_media: Number(p.renda_media), idade: Number(p.idade),
        meses_renda: Number(p.meses_renda), valor_garantia: Number(p.valor_garantia),
        solicitado: p.solicitado ? paraNumero(p.solicitado) : null,
        parcelas: Number(p.parcelas) || null, tem_mei: false, kyc_ok: true,
      }));
    setRodando(false);
    if (r.estado === "ok") setRes(r.dados);
    else setErro(r.erro);
  };

  return (
    <div className="space-y-3 rounded-xl border border-white/10 bg-navy-500/40 p-4">
      <p className="label">Simular a política</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {([["score", "Score"], ["renda_media", "Renda média"], ["idade", "Idade"],
           ["meses_renda", "Meses de renda"], ["valor_garantia", "Valor da garantia"],
           ["parcelas", "Parcelas"], ["solicitado", "Valor pedido"]] as const).map(([chave, rotulo]) => (
          <Campo key={chave} rotulo={rotulo}>
            <input className="input py-2 text-sm" inputMode="decimal"
                   value={String((p as any)[chave])}
                   onChange={(e) => setP({ ...p, [chave]: e.target.value })} />
          </Campo>
        ))}
      </div>
      <button className="btn-primary btn-sm w-full" disabled={rodando} onClick={() => void rodar()}>
        {rodando ? "Calculando…" : "Rodar simulação"}
      </button>
      {erro && <Aviso tom="erro">{erro}</Aviso>}
      {res && (
        <div className={`rounded-xl border p-3 text-sm ${
          res.aprovado ? "border-mint/30 bg-mint/[.07]" : "border-danger/30 bg-danger/[.07]"}`}>
          {res.aprovado ? (
            <>
              <p className="font-display text-2xl font-bold text-mint">
                {res.parcelas}x de {brl(res.parcela)}
              </p>
              <p className="mt-1 text-ink-muted">
                {brl(res.principal)} liberados · limite {brl(res.limite)} · CET{" "}
                {pct(res.cet_anual, 1)} a.a. · {pct(res.comprometimento, 1)} da renda
              </p>
            </>
          ) : (
            <>
              <p className="font-semibold">Recusado pela política</p>
              <p className="mt-1 text-ink-muted">{res.recusas.join(", ")}</p>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Formulario({ inicial, tiposDisponiveis, emissores, jornadas, modulos, onCancelar, onSalvo }: {
  inicial: Partial<ProdutoCredito>;
  tiposDisponiveis: string[];
  emissores: Array<{ id: string; titulo: string }>;
  jornadas: Array<{ id: string; nome: string }>;
  modulos: Array<{ id: string; titulo: string }>;
  onCancelar: () => void;
  onSalvo: () => void | Promise<void>;
}) {
  const [f, setF] = useState<Partial<ProdutoCredito>>({ ...VAZIO, ...inicial });
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const editando = Boolean(inicial.id);
  const d = (chave: keyof ProdutoCredito, valor: unknown) => setF((a) => ({ ...a, [chave]: valor }));

  const enviar = async () => {
    if (!f.nome?.trim()) return setErro("Dê um nome ao produto.");
    setEnviando(true);
    setErro(null);
    const corpo = {
      ...f,
      taxa_mensal: Number(f.taxa_mensal), prazo_min: Number(f.prazo_min),
      prazo_max: Number(f.prazo_max), ticket_min: Number(f.ticket_min),
      ticket_max: Number(f.ticket_max), ltv_max: Number(f.ltv_max ?? 0),
      score_minimo: Number(f.score_minimo), renda_minima: Number(f.renda_minima),
      comprometimento_max: Number(f.comprometimento_max), idade_min: Number(f.idade_min),
      idade_max: Number(f.idade_max), meses_renda_comprovada: Number(f.meses_renda_comprovada),
      tac: Number(f.tac ?? 0),
    };
    const r = editando
      ? await salvar(() => api.put(`/admin/produtos-credito/${inicial.id}`, corpo))
      : await salvar(() => api.post("/admin/produtos-credito", corpo));
    setEnviando(false);
    if (r.estado === "erro") return setErro(r.erro);
    await onSalvo();
  };

  const comGarantia = f.garantia_tipo && f.garantia_tipo !== "nenhuma";

  return (
    <Card className="space-y-4 border-mint/30">
      <SecaoTitulo titulo={editando ? "Editar produto" : "Novo produto de crédito"}
                   subtitulo="Preço e política; a jornada define como ele é vendido"
                   acao={<button className="btn-ghost btn-sm" onClick={onCancelar}>Cancelar</button>} />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Campo rotulo="Nome" obrigatorio>
          <input className="input" value={f.nome ?? ""} onChange={(e) => d("nome", e.target.value)}
                 placeholder="Financiamento de moto nova" />
        </Campo>
        <Campo rotulo="Tipo" obrigatorio>
          <select className="input" value={f.tipo} disabled={editando}
                  onChange={(e) => d("tipo", e.target.value)}>
            {tiposDisponiveis.map((t) => (
              <option key={t} value={t}>{ROTULO_TIPO[t] ?? t}</option>
            ))}
          </select>
        </Campo>
        <Campo rotulo="Módulo onde aparece">
          <select className="input" value={f.modulo_id ?? ""}
                  onChange={(e) => d("modulo_id", e.target.value || null)}>
            <option value="">— nenhum —</option>
            {modulos.map((m) => <option key={m.id} value={m.id}>{m.titulo}</option>)}
          </select>
        </Campo>

        <Num rotulo="Taxa mensal (decimal)" ajuda="0.0219 = 2,19% a.m."
             valor={f.taxa_mensal} onChange={(v) => d("taxa_mensal", v)} />
        <Num rotulo="Prazo mínimo (meses)" valor={f.prazo_min} onChange={(v) => d("prazo_min", v)} />
        <Num rotulo="Prazo máximo (meses)" valor={f.prazo_max} onChange={(v) => d("prazo_max", v)} />
        <Num rotulo="Ticket mínimo (R$)" valor={f.ticket_min} onChange={(v) => d("ticket_min", v)} />
        <Num rotulo="Ticket máximo (R$)" valor={f.ticket_max} onChange={(v) => d("ticket_max", v)} />
        <Num rotulo="TAC (R$)" valor={f.tac} onChange={(v) => d("tac", v)} />

        <Campo rotulo="Garantia">
          <select className="input" value={f.garantia_tipo ?? "nenhuma"}
                  onChange={(e) => d("garantia_tipo", e.target.value)}>
            <option value="nenhuma">Nenhuma</option>
            <option value="moto">Moto (alienação fiduciária)</option>
            <option value="recebiveis">Recebíveis dos apps</option>
          </select>
        </Campo>
        {comGarantia && (
          <Num rotulo="LTV máximo (decimal)" ajuda="0.90 = até 90% do valor da garantia"
               valor={f.ltv_max} onChange={(v) => d("ltv_max", v)} />
        )}
        <Campo rotulo="Cobrança">
          <select className="input" value={f.cobranca}
                  onChange={(e) => d("cobranca", e.target.value)}>
            {COBRANCAS.map(([v, r]) => <option key={v} value={v}>{r}</option>)}
          </select>
        </Campo>

        <Num rotulo="Score mínimo" valor={f.score_minimo} onChange={(v) => d("score_minimo", v)} />
        <Num rotulo="Renda mínima (R$)" valor={f.renda_minima}
             onChange={(v) => d("renda_minima", v)} />
        <Num rotulo="Comprometimento máx. (decimal)" ajuda="0.30 = parcela até 30% da renda"
             valor={f.comprometimento_max} onChange={(v) => d("comprometimento_max", v)} />
        <Num rotulo="Idade mínima" valor={f.idade_min} onChange={(v) => d("idade_min", v)} />
        <Num rotulo="Idade máxima" valor={f.idade_max} onChange={(v) => d("idade_max", v)} />
        <Num rotulo="Meses de renda comprovada" valor={f.meses_renda_comprovada}
             onChange={(v) => d("meses_renda_comprovada", v)} />

        <Campo rotulo="Emissor (conexão de crédito)"
               ajuda={emissores.length ? "" : "Cadastre uma conexão no port 'credito' primeiro."}>
          <select className="input" value={f.emissor_conexao_id ?? ""}
                  onChange={(e) => d("emissor_conexao_id", e.target.value || null)}>
            <option value="">— usar o fornecedor global —</option>
            {emissores.map((c) => <option key={c.id} value={c.id}>{c.titulo}</option>)}
          </select>
        </Campo>
        <Campo rotulo="Jornada de venda">
          <select className="input" value={f.jornada_id ?? ""}
                  onChange={(e) => d("jornada_id", e.target.value || null)}>
            <option value="">— nenhuma —</option>
            {jornadas.map((j) => <option key={j.id} value={j.id}>{j.nome}</option>)}
          </select>
        </Campo>
      </div>

      <div className="flex flex-wrap gap-4">
        <Checkbox rotulo="Exige MEI ativa" valor={!!f.exige_mei}
                  onChange={(v) => d("exige_mei", v)} />
        <Checkbox rotulo="Exige KYC aprovado" valor={!!f.exige_kyc}
                  onChange={(v) => d("exige_kyc", v)} />
        <Checkbox rotulo="Produto ativo" valor={!!f.ativo} onChange={(v) => d("ativo", v)} />
      </div>

      {erro && <Aviso tom="erro">{erro}</Aviso>}

      <div className="flex gap-2">
        <button className="btn-primary flex-1" disabled={enviando} onClick={() => void enviar()}>
          {enviando ? "Salvando…" : editando ? "Salvar alterações" : "Criar produto"}
        </button>
        <button className="btn-ghost" onClick={onCancelar}>Cancelar</button>
      </div>
    </Card>
  );
}

function Num({ rotulo, valor, ajuda, onChange }: {
  rotulo: string; valor: unknown; ajuda?: string; onChange: (v: number) => void;
}) {
  return (
    <Campo rotulo={rotulo} ajuda={ajuda}>
      <input className="input" inputMode="decimal" value={String(valor ?? "")}
             onChange={(e) => onChange(paraNumero(e.target.value))} />
    </Campo>
  );
}

function Checkbox({ rotulo, valor, onChange }: {
  rotulo: string; valor: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm">
      <input type="checkbox" checked={valor} onChange={(e) => onChange(e.target.checked)}
             className="h-4 w-4 accent-[#2DD4A8]" />
      {rotulo}
    </label>
  );
}
