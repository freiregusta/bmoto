import { Link, NavLink } from "react-router-dom";
import { Menu } from "lucide-react";
import { useState } from "react";

export function Nav() {
  const [open, setOpen] = useState(false);
  const linkCls = ({ isActive }: { isActive: boolean }) =>
    `text-sm transition-colors ${isActive ? "text-foreground" : "text-muted-foreground hover:text-foreground"}`;

  return (
    <header className="sticky top-0 z-50 border-b border-border/60 bg-background/70 backdrop-blur-xl">
      <div className="container-bm flex h-16 items-center justify-between">
        <Link to="/" className="flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-mint text-primary-foreground font-display font-bold">
            B
          </span>
          <span className="font-display text-lg font-bold tracking-tight">BMoto</span>
        </Link>

        <nav className="hidden items-center gap-8 md:flex">
          <a href="#produtos" className="text-sm text-muted-foreground hover:text-foreground">Produtos</a>
          <a href="#como-funciona" className="text-sm text-muted-foreground hover:text-foreground">Como funciona</a>
          <a href="#parceiros" className="text-sm text-muted-foreground hover:text-foreground">Parceiros</a>
          <a href="#faq" className="text-sm text-muted-foreground hover:text-foreground">FAQ</a>
          <NavLink to="/admin" className={linkCls}>Admin</NavLink>
        </nav>

        <div className="hidden items-center gap-3 md:flex">
          <Link to="/admin" className="text-sm text-muted-foreground hover:text-foreground">Entrar</Link>
          <a href="#simular" className="btn-primary !py-2 !px-4 text-xs">Simular crédito</a>
        </div>

        <button className="md:hidden" onClick={() => setOpen(!open)} aria-label="Menu">
          <Menu className="h-6 w-6" />
        </button>
      </div>
      {open && (
        <div className="border-t border-border/60 md:hidden">
          <div className="container-bm flex flex-col gap-4 py-4 text-sm">
            <a href="#produtos">Produtos</a>
            <a href="#como-funciona">Como funciona</a>
            <a href="#parceiros">Parceiros</a>
            <a href="#faq">FAQ</a>
            <Link to="/admin">Admin</Link>
            <a href="#simular" className="btn-primary justify-center">Simular crédito</a>
          </div>
        </div>
      )}
    </header>
  );
}
