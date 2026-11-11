/**
 * AdminShell — moldura do painel de administração.
 *
 * Em tela larga é um painel de operação; no celular continua usável, porque é
 * onde o time comercial vai cadastrar parceiro às pressas.
 */

import { Link, NavLink, Outlet } from "react-router-dom";
import { useState } from "react";
import { Icone, Logo } from "@/components/ui";
import { definirTokenAdmin, obterTokenAdmin } from "@/lib/api";
import { usePlataforma } from "@/platform/PlatformProvider";
import { rotaAdmin, rotaInicio } from "@/rotas";

const ITENS = [
  { to: rotaAdmin(), rotulo: "Visão geral", icone: "LayoutDashboard", fim: true },
  { to: rotaAdmin("conexoes"), rotulo: "Conexões (BaaS)", icone: "PlugZap" },
  { to: rotaAdmin("produtos"), rotulo: "Produtos de crédito", icone: "Banknote" },
  { to: rotaAdmin("apps"), rotulo: "Apps de entrega", icone: "Smartphone" },
  { to: rotaAdmin("modulos"), rotulo: "Módulos do app", icone: "LayoutGrid" },
  { to: rotaAdmin("jornadas"), rotulo: "Jornadas", icone: "Route" },
  { to: rotaAdmin("auditoria"), rotulo: "Auditoria", icone: "ScrollText" },
];

export function AdminShell() {
  const { modoDemo } = usePlataforma();
  const [token, setToken] = useState(obterTokenAdmin() ?? "");
  const [abrirToken, setAbrirToken] = useState(false);

  return (
    <div className="min-h-screen lg:flex">
      <aside className="border-b border-white/8 bg-navy-600/50 lg:w-64 lg:shrink-0 lg:border-b-0 lg:border-r">
        <div className="flex items-center justify-between gap-3 px-4 py-4">
          <Link to={rotaInicio()} className="text-ink" aria-label="Voltar ao app">
            <Logo className="h-6 text-xl" />
          </Link>
          <span className="chip">admin</span>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-2 pb-3 lg:flex-col lg:overflow-visible lg:px-3">
          {ITENS.map((i) => (
            <NavLink key={i.to} to={i.to} end={i.fim}
                     className={({ isActive }) =>
                       `flex shrink-0 items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-medium transition ${
                         isActive ? "bg-mint/12 text-mint" : "text-ink-muted hover:bg-white/[.05] hover:text-ink"
                       }`}>
              <Icone nome={i.icone} className="h-4 w-4" />
              <span className="whitespace-nowrap">{i.rotulo}</span>
            </NavLink>
          ))}
        </nav>
        <div className="hidden px-3 pb-4 lg:block">
          <button className="btn-ghost btn-sm w-full" onClick={() => setAbrirToken((v) => !v)}>
            <Icone nome="KeyRound" className="h-3.5 w-3.5" />
            {obterTokenAdmin() ? "Token configurado" : "Configurar token"}
          </button>
          {abrirToken && (
            <div className="mt-2 space-y-2">
              <input className="input text-xs" type="password" placeholder="ADMIN_TOKEN"
                     value={token} onChange={(e) => setToken(e.target.value)} />
              <button className="btn-primary btn-sm w-full"
                      onClick={() => {
                        definirTokenAdmin(token || null);
                        window.location.reload();
                      }}>
                Salvar e recarregar
              </button>
              <p className="text-[11px] leading-relaxed text-ink-faint">
                Fica só nesta sessão do navegador. Em produção o backend exige este token para
                qualquer alteração.
              </p>
            </div>
          )}
        </div>
      </aside>

      <main className="flex-1 px-4 py-6 lg:px-8">
        {modoDemo && (
          <div className="mb-5 rounded-xl border border-warn/35 bg-warn/10 p-3 text-sm">
            <strong className="font-semibold">Modo demonstração.</strong> O painel está exibindo o
            catálogo local porque não encontrou o backend. As alterações não serão salvas.
          </div>
        )}
        <Outlet />
      </main>
    </div>
  );
}
