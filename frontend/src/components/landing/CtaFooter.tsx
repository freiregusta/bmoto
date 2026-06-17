import { ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";

export function CtaFooter() {
  return (
    <footer id="simular" className="relative overflow-hidden border-t border-border">
      <div className="absolute inset-0 bg-gradient-hero opacity-70" />
      <div className="container-bm relative py-24">
        <div className="surface p-10 md:p-16 text-center">
          <h2 className="mx-auto max-w-3xl font-display text-4xl font-bold md:text-6xl">
            Pronto para originar <span className="glow-text">crédito de verdade</span>?
          </h2>
          <p className="mx-auto mt-5 max-w-xl text-muted-foreground">
            Crie sua conta, simule em segundos ou fale com nosso time para integrar sua loja.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <a href="mailto:ola@bmoto.com.br" className="btn-primary">Começar agora <ArrowRight className="h-4 w-4" /></a>
            <Link to="/admin" className="btn-ghost">Acessar painel</Link>
          </div>
        </div>

        <div className="mt-16 grid gap-10 border-t border-border pt-10 md:grid-cols-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-mint font-display font-bold text-primary-foreground">B</span>
              <span className="font-display text-lg font-bold">BMoto</span>
            </div>
            <p className="mt-4 max-w-xs text-sm text-muted-foreground">
              Originadora de crédito para o varejo. CNPJ 00.000.000/0001-00.
            </p>
          </div>
          <FooterCol title="Produto" items={["CDC", "Crédito Pessoal", "Private Label", "BNPL"]} />
          <FooterCol title="Empresa" items={["Sobre", "Parceiros", "Carreiras", "Contato"]} />
          <FooterCol title="Legal" items={["Termos", "Privacidade", "LGPD", "Ouvidoria"]} />
        </div>
        <div className="mt-10 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-6 text-xs text-muted-foreground">
          <span>© {new Date().getFullYear()} BMoto. Todos os direitos reservados.</span>
          <span>Correspondente bancário autorizado pelo BACEN.</span>
        </div>
      </div>
    </footer>
  );
}

function FooterCol({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-[0.2em] text-foreground">{title}</div>
      <ul className="mt-4 space-y-2 text-sm text-muted-foreground">
        {items.map((i) => <li key={i}><a href="#" className="hover:text-foreground">{i}</a></li>)}
      </ul>
    </div>
  );
}
