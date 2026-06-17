import { ArrowUpRight, CreditCard, HandCoins, ShoppingBag, Wallet } from "lucide-react";

const products = [
  { icon: HandCoins,   t: "CDC",              d: "Crédito Direto ao Consumidor para bens de maior ticket, com prazos até 36 meses.", tag: "Até R$ 60 mil" },
  { icon: Wallet,      t: "Crédito Pessoal",  d: "Linha rápida sem destinação, com avaliação instantânea e parcelas fixas.",         tag: "Até R$ 25 mil" },
  { icon: CreditCard,  t: "Cartão Private Label", d: "Cartão da bandeira do lojista, com limite recorrente e cashback configurável.", tag: "Recorrente" },
  { icon: ShoppingBag, t: "BNPL",             d: "Compre agora, pague depois. 0% para o consumidor, taxa MDR para o lojista.",      tag: "0% juros" },
];

export function Products() {
  return (
    <section id="produtos" className="border-t border-border bg-surface/30 py-24">
      <div className="container-bm">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div className="max-w-2xl">
            <span className="text-xs uppercase tracking-[0.2em] text-primary">Produtos</span>
            <h2 className="mt-3 font-display text-4xl font-bold md:text-5xl">
              Uma esteira de crédito <span className="glow-text">para cada momento</span>.
            </h2>
          </div>
          <a href="#simular" className="btn-ghost">Ver simulações</a>
        </div>

        <div className="mt-14 grid gap-4 md:grid-cols-2">
          {products.map((p) => (
            <div key={p.t} className="surface group p-8 transition-all hover:border-primary/50 hover:shadow-glow">
              <div className="flex items-start justify-between">
                <div className="grid h-12 w-12 place-items-center rounded-xl bg-primary/10 text-primary">
                  <p.icon className="h-6 w-6" />
                </div>
                <span className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground">{p.tag}</span>
              </div>
              <div className="mt-6 flex items-center justify-between">
                <h3 className="font-display text-2xl font-semibold">{p.t}</h3>
                <ArrowUpRight className="h-5 w-5 text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:-translate-y-1 group-hover:text-primary" />
              </div>
              <p className="mt-3 text-sm text-muted-foreground">{p.d}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
