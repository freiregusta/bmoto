/**
 * Shell — moldura do super app.
 *
 * A navegação inferior e o menu saem dos manifestos: nada aqui enumera
 * produtos. Ligar/desligar módulo no admin reordena e some com o item.
 */

import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { Icone, Logo } from "./ui";
import { usePlataforma } from "@/platform/PlatformProvider";

/** Itens fixos da barra inferior; o resto entra pelo "Mais". */
const FIXOS = ["inicio", "conta", "ganhos", "margem"];

export function Shell() {
  const { disponiveis, modoDemo } = usePlataforma();
  const { pathname } = useLocation();

  const naBarra = [
    { id: "inicio", titulo: "Início", rota: "/app", icone: "Home" },
    ...disponiveis
      .filter((m) => FIXOS.includes(m.id))
      .map((m) => ({ id: m.id, titulo: curto(m.titulo), rota: m.rota, icone: m.icone })),
  ].slice(0, 4);

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-lg flex-col">
      <header className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-white/8 bg-navy/85 px-4 py-3 backdrop-blur">
        <Link to="/app" className="text-ink" aria-label="BMoto, início">
          <Logo />
        </Link>
        <div className="flex items-center gap-2">
          {modoDemo && (
            <span className="chip chip-warn" title="Backend não encontrado: dados de demonstração">
              demo
            </span>
          )}
          <Link to="/app/perfil" className="btn-ghost btn-sm" aria-label="Seu perfil">
            <Icone nome="User" className="h-4 w-4" />
          </Link>
          <Link to="/admin" className="btn-ghost btn-sm" aria-label="Administração">
            <Icone nome="SlidersHorizontal" className="h-4 w-4" />
          </Link>
        </div>
      </header>

      <main className="flex-1 px-4 py-5 pb-28">
        <Outlet />
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-20 mx-auto max-w-lg border-t border-white/8 bg-navy/95 px-2 pb-[env(safe-area-inset-bottom)] backdrop-blur"
           aria-label="Navegação principal">
        <ul className="grid grid-cols-5">
          {naBarra.map((item) => (
            <li key={item.id}>
              <NavLink to={item.rota} end={item.rota === "/app"}
                       className={({ isActive }) =>
                         `flex flex-col items-center gap-1 py-2.5 text-[11px] font-medium transition ${
                           isActive ? "text-mint" : "text-ink-faint hover:text-ink-muted"
                         }`}>
                <Icone nome={item.icone} className="h-5 w-5" />
                {item.titulo}
              </NavLink>
            </li>
          ))}
          <li>
            <NavLink to="/app/mais"
                     className={({ isActive }) =>
                       `flex flex-col items-center gap-1 py-2.5 text-[11px] font-medium transition ${
                         isActive || pathname.startsWith("/app/mais")
                           ? "text-mint" : "text-ink-faint hover:text-ink-muted"
                       }`}>
              <Icone nome="LayoutGrid" className="h-5 w-5" />
              Mais
            </NavLink>
          </li>
        </ul>
      </nav>
    </div>
  );
}

function curto(titulo: string): string {
  const mapa: Record<string, string> = {
    "Conta BMoto": "Conta",
    "Ganhos dos apps": "Ganhos",
    "Margem líquida real": "Margem",
    "MEI e contabilidade": "MEI",
  };
  return mapa[titulo] ?? titulo.split(" ")[0];
}
