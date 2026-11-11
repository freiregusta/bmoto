/**
 * Módulos do app — ligar, desligar, renomear e reordenar.
 *
 * A coluna "origem" é o que evita briga de operação: mostra se o estado atual
 * veio do código, deste painel ou de uma variável de ambiente (que vence tudo,
 * para dar um jeito de desligar algo às pressas sem depender do banco).
 */

import { useState } from "react";
import { Aviso, Card, Carregando, Chip, Icone, SecaoTitulo } from "@/components/ui";
import { api } from "@/lib/api";
import { usePlataforma } from "@/platform/PlatformProvider";
import type { Modulo } from "@/platform/types";
import { salvar, useJornadas } from "./useAdmin";

const ROTULO_ORIGEM: Record<Modulo["origem_flag"], string> = {
  codigo: "padrão do código",
  admin: "definido neste painel",
  env: "forçado por variável de ambiente",
};

export default function Modulos() {
  const { modulos, carregando, recarregar } = usePlataforma();
  const { dados: jornadas } = useJornadas();
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState<string | null>(null);

  if (carregando) return <Carregando />;

  const mudar = async (m: Modulo, parcial: Record<string, unknown>) => {
    setSalvando(m.id);
    setErro(null);
    const r = await salvar(() => api.put(`/admin/modulos/${m.id}`, { id: m.id, ...parcial }));
    setSalvando(null);
    if (!r.ok) return setErro(r.erro);
    await recarregar();
  };

  return (
    <div className="space-y-6">
      <SecaoTitulo titulo="Módulos do app"
                   subtitulo="O que o entregador vê, em que ordem, com qual jornada" />

      {erro && <Aviso tom="erro">{erro}</Aviso>}

      <div className="space-y-3">
        {modulos.map((m) => (
          <Card key={m.id} className="space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className="rounded-xl bg-mint/12 p-2.5">
                  <Icone nome={m.icone} className="h-5 w-5 text-mint" />
                </div>
                <div>
                  <p className="font-semibold">{m.titulo}</p>
                  <p className="mt-0.5 max-w-xl text-xs leading-relaxed text-ink-faint">
                    {m.descricao}
                  </p>
                  <p className="mt-1 text-[11px] text-ink-faint">
                    id <code className="text-mint">{m.id}</code> · rota {m.rota} · ordem {m.ordem} ·{" "}
                    {ROTULO_ORIGEM[m.origem_flag]}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Chip tom={m.enabled ? "on" : "off"}>{m.enabled ? "ligado" : "desligado"}</Chip>
                {m.enabled && !m.pronto && <Chip tom="warn">sem fornecedor</Chip>}
                <Chip tom={m.fase === "legado" ? "off" : "neutro"}>{m.fase}</Chip>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs">
              {Object.entries(m.providers).map(([port, provider]) => (
                <Chip key={port} tom={provider ? "neutro" : "danger"}>
                  {port}: {provider ?? "sem fornecedor"}
                </Chip>
              ))}
              {m.requisitos.length === 0 && <Chip>não depende de fornecedor</Chip>}
            </div>

            <div className="flex flex-wrap items-end gap-2">
              <button className="btn-ghost btn-sm" disabled={salvando === m.id || m.origem_flag === "env"}
                      title={m.origem_flag === "env"
                        ? "Uma variável de ambiente está forçando este estado"
                        : undefined}
                      onClick={() => void mudar(m, { enabled: !m.enabled })}>
                <Icone nome={m.enabled ? "PowerOff" : "Power"} className="h-3.5 w-3.5" />
                {m.enabled ? "Desligar" : "Ligar"}
              </button>
              <button className="btn-ghost btn-sm" disabled={salvando === m.id}
                      onClick={() => void mudar(m, { ordem: Math.max(m.ordem - 10, 0) })}>
                <Icone nome="ArrowUp" className="h-3.5 w-3.5" />Subir
              </button>
              <button className="btn-ghost btn-sm" disabled={salvando === m.id}
                      onClick={() => void mudar(m, { ordem: m.ordem + 10 })}>
                <Icone nome="ArrowDown" className="h-3.5 w-3.5" />Descer
              </button>
              <Renomear modulo={m} onSalvar={(titulo) => void mudar(m, { titulo })} />
              <EscolherJornada
                modulo={m}
                jornadas={(jornadas?.jornadas ?? []).map((j) => ({ id: j.id, nome: j.nome }))}
                onSalvar={(jornada_id) => void mudar(m, { jornada_id })}
              />
            </div>
          </Card>
        ))}
      </div>

      <Aviso tom="info" titulo="Como a decisão é tomada">
        Variável de ambiente vence este painel, que vence o padrão do código. Um módulo só aparece
        como pronto quando o fornecedor conectado entrega todas as capacidades que ele exige.
      </Aviso>
    </div>
  );
}

function Renomear({ modulo, onSalvar }: { modulo: Modulo; onSalvar: (titulo: string) => void }) {
  const [abrindo, setAbrindo] = useState(false);
  const [titulo, setTitulo] = useState(modulo.titulo);
  if (!abrindo)
    return (
      <button className="btn-ghost btn-sm" onClick={() => setAbrindo(true)}>
        <Icone nome="Pencil" className="h-3.5 w-3.5" />Renomear
      </button>
    );
  return (
    <span className="flex items-center gap-1">
      <input className="input py-2 text-sm" value={titulo} autoFocus
             onChange={(e) => setTitulo(e.target.value)} />
      <button className="btn-primary btn-sm"
              onClick={() => { onSalvar(titulo); setAbrindo(false); }}>Salvar</button>
      <button className="btn-ghost btn-sm" onClick={() => setAbrindo(false)}>
        <Icone nome="X" className="h-3.5 w-3.5" />
      </button>
    </span>
  );
}

function EscolherJornada({ modulo, jornadas, onSalvar }: {
  modulo: Modulo; jornadas: Array<{ id: string; nome: string }>; onSalvar: (id: string) => void;
}) {
  return (
    <select className="input w-auto py-2 text-sm" value={modulo.jornada_id ?? ""}
            onChange={(e) => onSalvar(e.target.value)}
            aria-label={`Jornada do módulo ${modulo.titulo}`}>
      <option value="">jornada automática (por módulo)</option>
      {jornadas.map((j) => <option key={j.id} value={j.id}>{j.nome}</option>)}
    </select>
  );
}
