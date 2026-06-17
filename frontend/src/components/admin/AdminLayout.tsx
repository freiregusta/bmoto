import { NavLink, Outlet, Link } from "react-router-dom";
import { LayoutDashboard, FileText, Tag, ShieldCheck, GitBranch, Store, Settings, ArrowLeft, Menu } from "lucide-react";
import { useState } from "react";

const items = [
  { to: "/admin",             label: "Dashboard",  icon: LayoutDashboard, end: true },
  { to: "/admin/propostas",   label: "Propostas",  icon: FileText },
  { to: "/admin/pricing",     label: "Pricing",    icon: Tag },
  { to: "/admin/credito",     label: "Crédito",    icon: ShieldCheck },
  { to: "/admin/fluxo",       label: "Fluxo",      icon: GitBranch },
  { to: "/admin/parceiros",   label: "Parceiros",  icon: Store },
  { to: "/admin/configuracoes", label: "Configurações", icon: Settings },
];

export default function AdminLayout() {
  const [open, setOpen] = useState(false);
  return (
    <div className="min-h-screen bg-background">
      <aside className={`fixed inset-y-0 left-0 z-40 w-64 transform border-r border-border bg-surface/40 backdrop-blur-xl transition-transform lg:translate-x-0 ${open ? "translate-x-0" : "-translate-x-full"}`}>
        <div className="flex h-16 items-center gap-2 border-b border-border px-6">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-mint font-display font-bold text-primary-foreground">B</span>
          <span className="font-display text-lg font-bold">BMoto</span>
          <span className="ml-auto rounded-full border border-border px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">Admin</span>
        </div>
        <nav className="flex flex-col gap-1 p-4">
          {items.map((it) => (
            <NavLink key={it.to} to={it.to} end={it.end} onClick={() => setOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
                  isActive ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-white/5 hover:text-foreground"
                }`
              }>
              <it.icon className="h-4 w-4" /> {it.label}
            </NavLink>
          ))}
        </nav>
        <div className="absolute bottom-4 left-0 right-0 px-4">
          <Link to="/" className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-3.5 w-3.5" /> Voltar para o site
          </Link>
        </div>
      </aside>

      <div className="lg:pl-64">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border bg-background/70 px-6 backdrop-blur-xl">
          <button className="lg:hidden" onClick={() => setOpen(!open)} aria-label="Menu">
            <Menu className="h-5 w-5" />
          </button>
          <div className="text-sm text-muted-foreground">Painel de originação</div>
          <div className="ml-auto flex items-center gap-3">
            <span className="hidden text-xs text-muted-foreground sm:inline">demo@bmoto.com.br</span>
            <div className="grid h-8 w-8 place-items-center rounded-full bg-primary/15 text-xs font-semibold text-primary">DA</div>
          </div>
        </header>
        <main className="p-6 lg:p-10">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
