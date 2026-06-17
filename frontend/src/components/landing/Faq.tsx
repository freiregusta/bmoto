import { useState } from "react";
import { ChevronDown } from "lucide-react";

const faqs = [
  { q: "A BMoto é regulada?", a: "Sim. Operamos como correspondente bancário e SCD em parceria com instituições autorizadas pelo Banco Central, seguindo todas as normas de LGPD, SCR e prevenção à lavagem de dinheiro." },
  { q: "Qual o tempo de integração para lojistas?", a: "Integrações via API levam em média 7 dias úteis. Para checkouts populares (Shopify, VTEX, Nuvemshop) temos plugins prontos com setup em horas." },
  { q: "Quem assume o risco da operação?", a: "A BMoto. O lojista recebe o valor cheio à vista, e nós fazemos toda a gestão de risco, cobrança e recuperação." },
  { q: "Quais produtos vocês oferecem?", a: "CDC, Crédito Pessoal, Cartão Private Label e BNPL. Cada produto tem motor de score, política e pricing próprios, configuráveis por lojista." },
  { q: "Posso simular sem CPF?", a: "Sim, a simulação inicial é livre. CPF e dados só são solicitados na etapa de aprovação." },
];

export function Faq() {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <section id="faq" className="py-24">
      <div className="container-bm grid gap-12 lg:grid-cols-[1fr_1.5fr]">
        <div>
          <span className="text-xs uppercase tracking-[0.2em] text-primary">FAQ</span>
          <h2 className="mt-3 font-display text-4xl font-bold md:text-5xl">Perguntas frequentes.</h2>
          <p className="mt-4 text-sm text-muted-foreground">
            Não achou o que procurava? Fale com nosso time em
            <a href="mailto:ola@bmoto.com.br" className="text-primary hover:underline"> ola@bmoto.com.br</a>.
          </p>
        </div>
        <div className="divide-y divide-border border-y border-border">
          {faqs.map((f, i) => {
            const isOpen = open === i;
            return (
              <button key={f.q} onClick={() => setOpen(isOpen ? null : i)} className="block w-full py-5 text-left">
                <div className="flex items-center justify-between gap-4">
                  <span className="font-display text-lg font-medium">{f.q}</span>
                  <ChevronDown className={`h-5 w-5 shrink-0 text-muted-foreground transition-transform ${isOpen ? "rotate-180" : ""}`} />
                </div>
                {isOpen && <p className="mt-3 text-sm text-muted-foreground">{f.a}</p>}
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
