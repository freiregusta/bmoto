/**
 * Módulo Conta — tela dedicada.
 *
 * Sem conta aberta, roda a jornada de abertura (que o admin configurou).
 * Com conta, mostra saldo, extrato e Pix, falando com o backend pelos
 * endpoints da plataforma — que por sua vez falam com o BaaS cadastrado.
 */

import { useCallback, useEffect, useState } from "react";
import { Aviso, Campo, Card, Carregando, Chip, Icone, SecaoTitulo } from "@/components/ui";
import { JornadaRunner } from "@/components/JornadaRunner";
import { api, comDemo } from "@/lib/api";
import { brl, dataHora } from "@/lib/format";
import { usePerfil } from "@/platform/PerfilProvider";
import type { ModuleDefinition, ModuleProps } from "@/platform/registry";
import { rotaModulo } from "@/rotas";

interface Lancamento {
  lancamento_id: string;
  valor: number;
  descricao: string;
  categoria: string;
  ocorrido_em: string;
  origem?: string | null;
}

/** Extrato de demonstração quando não há backend. */
const EXTRATO_DEMO: Lancamento[] = [
  { lancamento_id: "1", valor: 486.2, descricao: "Repasse iFood", categoria: "repasse_app",
    ocorrido_em: new Date(Date.now() - 2 * 864e5).toISOString(), origem: "ifood" },
  { lancamento_id: "2", valor: -86.05, descricao: "DAS MEI 11/2026", categoria: "tarifa",
    ocorrido_em: new Date(Date.now() - 3 * 864e5).toISOString() },
  { lancamento_id: "3", valor: 212.4, descricao: "Repasse 99Food", categoria: "repasse_app",
    ocorrido_em: new Date(Date.now() - 5 * 864e5).toISOString(), origem: "99" },
  { lancamento_id: "4", valor: -120, descricao: "Pix para posto", categoria: "pix",
    ocorrido_em: new Date(Date.now() - 6 * 864e5).toISOString() },
];

function ContaTela({ modulo }: ModuleProps) {
  const { carteira } = usePerfil();
  const contaId = carteira.conta?.conta_id;

  if (!contaId)
    return (
      <div className="space-y-4">
        <Aviso tom="info" titulo="Você ainda não tem conta BMoto">
          A conta é onde cai o repasse dos apps e de onde saem as parcelas. Leva dois minutos.
        </Aviso>
        <JornadaRunner modulo={modulo} />
      </div>
    );

  return <ContaAberta contaId={contaId} />;
}

function ContaAberta({ contaId }: { contaId: string }) {
  const { carteira } = usePerfil();
  const [saldo, setSaldo] = useState<number | null>(null);
  const [extrato, setExtrato] = useState<Lancamento[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [mostrarPix, setMostrarPix] = useState(false);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const [s, e] = await Promise.all([
        comDemo(() => api.get<{ saldo: number }>(`/platform/conta/${contaId}/saldo`),
                () => ({ saldo: EXTRATO_DEMO.reduce((a, l) => a + l.valor, 0) })),
        comDemo(() => api.get<{ lancamentos: Lancamento[] }>(`/platform/conta/${contaId}/extrato`),
                () => ({ lancamentos: EXTRATO_DEMO })),
      ]);
      setSaldo(s.saldo);
      setExtrato(e.lancamentos);
    } catch (err) {
      setErro(err instanceof Error ? err.message : "não deu para carregar a conta");
    } finally {
      setCarregando(false);
    }
  }, [contaId]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  return (
    <div className="space-y-4">
      <Card>
        <p className="label">Saldo disponível</p>
        {carregando ? (
          <div className="mt-2"><Carregando texto="Consultando…" /></div>
        ) : (
          <p className="mt-1 font-display text-4xl font-extrabold text-mint">{brl(saldo ?? 0)}</p>
        )}
        <p className="mt-2 text-xs text-ink-faint">
          Ag. {carteira.conta?.agencia} · Conta {carteira.conta?.numero}
          {carteira.conta?.chave_pix && <> · chave Pix {carteira.conta.chave_pix}</>}
        </p>
        <div className="mt-4 grid grid-cols-3 gap-2">
          <button className="btn-ghost flex-col py-3 text-[11px]" onClick={() => setMostrarPix(true)}>
            <Icone nome="Send" className="h-4 w-4" />
            Enviar Pix
          </button>
          <button className="btn-ghost flex-col py-3 text-[11px]" onClick={() => void carregar()}>
            <Icone nome="RefreshCw" className="h-4 w-4" />
            Atualizar
          </button>
          <a className="btn-ghost flex-col py-3 text-[11px]" href={rotaModulo("ganhos")}>
            <Icone nome="TrendingUp" className="h-4 w-4" />
            Ganhos
          </a>
        </div>
      </Card>

      {erro && <Aviso tom="erro">{erro}</Aviso>}

      {mostrarPix && (
        <EnviarPix contaId={contaId} onFechar={() => setMostrarPix(false)}
                   onEnviado={() => { setMostrarPix(false); void carregar(); }} />
      )}

      <Card>
        <SecaoTitulo titulo="Extrato" subtitulo="Últimos lançamentos" />
        {extrato.length === 0 ? (
          <p className="text-sm text-ink-faint">Nada por aqui ainda.</p>
        ) : (
          <ul className="divide-y divide-white/8">
            {extrato.map((l) => (
              <li key={l.lancamento_id} className="flex items-center gap-3 py-3">
                <div className={`rounded-full p-2 ${l.valor >= 0 ? "bg-mint/15" : "bg-white/[.06]"}`}>
                  <Icone nome={l.valor >= 0 ? "ArrowDownLeft" : "ArrowUpRight"}
                         className={`h-4 w-4 ${l.valor >= 0 ? "text-mint" : "text-ink-muted"}`} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{l.descricao}</p>
                  <p className="text-xs text-ink-faint">{dataHora(l.ocorrido_em)}</p>
                </div>
                <span className={`text-sm font-semibold ${l.valor >= 0 ? "text-mint" : "text-ink"}`}>
                  {l.valor >= 0 ? "+" : "−"}
                  {brl(Math.abs(l.valor))}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function EnviarPix({ contaId, onFechar, onEnviado }: {
  contaId: string; onFechar: () => void; onEnviado: () => void;
}) {
  const [chave, setChave] = useState("");
  const [valor, setValor] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState<{ ok: boolean; texto: string } | null>(null);

  const enviar = async () => {
    setEnviando(true);
    setResultado(null);
    try {
      const r = await api.post<{ status: string; erro?: string }>(
        `/platform/conta/${contaId}/pix`,
        { valor: Number(valor.replace(",", ".")), chave,
          idempotency_key: `${contaId}-${Date.now()}` },
      );
      const ok = r.status === "CONFIRMADO" || r.status === "ENVIADO";
      setResultado({ ok, texto: ok ? "Pix enviado." : r.erro ?? "não deu" });
      if (ok) setTimeout(onEnviado, 900);
    } catch (e) {
      setResultado({ ok: false, texto: e instanceof Error ? e.message : "falhou" });
    } finally {
      setEnviando(false);
    }
  };

  return (
    <Card className="space-y-3">
      <SecaoTitulo titulo="Enviar Pix"
                   acao={<button className="btn-ghost btn-sm" onClick={onFechar}>Fechar</button>} />
      <Campo rotulo="Chave de destino" obrigatorio>
        <input className="input" value={chave} onChange={(e) => setChave(e.target.value)}
               placeholder="CPF, celular, e-mail ou aleatória" />
      </Campo>
      <Campo rotulo="Valor" obrigatorio>
        <input className="input" inputMode="decimal" value={valor}
               onChange={(e) => setValor(e.target.value)} placeholder="0,00" />
      </Campo>
      {resultado && <Aviso tom={resultado.ok ? "ok" : "erro"}>{resultado.texto}</Aviso>}
      <button className="btn-primary w-full" disabled={!chave || !valor || enviando}
              onClick={() => void enviar()}>
        {enviando ? "Enviando…" : "Enviar"}
      </button>
    </Card>
  );
}

function ContaResumo({ modulo }: ModuleProps) {
  const { carteira } = usePerfil();
  if (!carteira.conta)
    return (
      <Card className="flex items-center gap-4">
        <div className="rounded-full bg-mint/15 p-3">
          <Icone nome="Wallet" className="h-5 w-5 text-mint" />
        </div>
        <div className="flex-1">
          <p className="font-semibold">Abra sua conta BMoto</p>
          <p className="text-xs text-ink-faint">Para receber o repasse dos apps em um lugar só</p>
        </div>
        <a href={rotaModulo(modulo.id)} className="btn-primary btn-sm">Abrir</a>
      </Card>
    );
  return (
    <Card>
      <div className="flex items-start justify-between">
        <div>
          <p className="label">Conta BMoto</p>
          <p className="mt-1 font-display text-2xl font-bold">
            Ag. {carteira.conta.agencia} · {carteira.conta.numero}
          </p>
        </div>
        <Chip tom="on">ativa</Chip>
      </div>
      <a href={rotaModulo(modulo.id)} className="btn-ghost btn-sm mt-3 w-full">Ver saldo e extrato</a>
    </Card>
  );
}

export const moduloConta: ModuleDefinition = {
  id: "conta",
  Component: ContaTela,
  Resumo: ContaResumo,
};
