/**
 * Entrada — a primeira tela de quem acabou de instalar o app.
 *
 * Nada de produto antes de existir uma pessoa: quem chega cria a conta (ou
 * entra, se já criou neste aparelho) e só então vê início, saldo e ofertas.
 *
 * O cadastro aqui é da PESSOA no app. Abrir a conta bancária é outra coisa,
 * com KYC e provisionamento no BaaS — e isso é a jornada do módulo Conta.
 */

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Aviso, Campo, Card, Icone, Logo } from "@/components/ui";
import { cpfValido, mascaraCpf, mascaraTelefone } from "@/lib/format";
import { usePerfil } from "@/platform/PerfilProvider";
import { rotaInicio } from "@/rotas";

type Passo = "boas-vindas" | "cadastro" | "entrar";

const PROMESSAS: Array<[string, string, string]> = [
  ["Wallet", "Conta sem tarifa", "O repasse dos apps cai em um lugar só"],
  ["TrendingUp", "Crédito pela sua renda real", "Sem holerite, sem fiador: a corrida é a prova"],
  ["Calculator", "Quanto você ganha de verdade", "Desconta combustível, manutenção e DAS"],
];

export default function Entrada() {
  const [passo, setPasso] = useState<Passo>("boas-vindas");

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-lg flex-col px-5 pb-10 pt-10">
      <header className="mb-8 flex flex-col items-center gap-5 text-center">
        <Logo className="h-9" />
        <div>
          <h1 className="text-2xl font-bold leading-tight">
            Tudo que o motoboy precisa,
            <br />
            <span className="text-mint">em um só lugar</span>
          </h1>
        </div>
      </header>

      {passo === "boas-vindas" && <BoasVindas onIr={setPasso} />}
      {passo === "cadastro" && <FormularioCadastro onVoltar={() => setPasso("boas-vindas")} />}
      {passo === "entrar" && <FormularioEntrar onVoltar={() => setPasso("boas-vindas")}
                                               onCriarConta={() => setPasso("cadastro")} />}
    </div>
  );
}

function BoasVindas({ onIr }: { onIr: (p: Passo) => void }) {
  return (
    <div className="flex flex-1 flex-col">
      <ul className="space-y-3">
        {PROMESSAS.map(([icone, titulo, texto]) => (
          <li key={titulo} className="card flex items-start gap-4">
            <div className="rounded-xl bg-mint/12 p-2.5">
              <Icone nome={icone} className="h-5 w-5 text-mint" />
            </div>
            <div>
              <p className="font-semibold">{titulo}</p>
              <p className="mt-0.5 text-sm text-ink-muted">{texto}</p>
            </div>
          </li>
        ))}
      </ul>

      <div className="mt-auto space-y-3 pt-8">
        <button className="btn-primary w-full" onClick={() => onIr("cadastro")}>
          Criar minha conta
        </button>
        <button className="btn-ghost w-full" onClick={() => onIr("entrar")}>
          Já tenho conta
        </button>
      </div>
    </div>
  );
}

function FormularioCadastro({ onVoltar }: { onVoltar: () => void }) {
  const { cadastrar } = usePerfil();
  const navegar = useNavigate();
  const [f, setF] = useState({ nome: "", cpf: "", nascimento: "", celular: "", email: "" });
  const [aceito, setAceito] = useState(false);
  const [tocado, setTocado] = useState(false);

  const d = (chave: keyof typeof f, valor: string) => setF((a) => ({ ...a, [chave]: valor }));

  const erros = {
    nome: f.nome.trim().split(" ").filter(Boolean).length < 2 ? "Nome e sobrenome" : "",
    cpf: f.cpf && !cpfValido(f.cpf) ? "CPF inválido" : "",
    nascimento: f.nascimento && idade(f.nascimento) < 18 ? "Precisa ter 18 anos" : "",
    celular: f.celular.replace(/\D/g, "").length < 10 ? "Celular com DDD" : "",
  };
  const completo =
    f.nome && f.cpf && f.nascimento && f.celular &&
    !Object.values(erros).some(Boolean) && aceito;

  return (
    <form
      className="flex flex-1 flex-col"
      onSubmit={(e) => {
        e.preventDefault();
        setTocado(true);
        if (!completo) return;
        cadastrar(f);
        navegar(rotaInicio(), { replace: true });
      }}
    >
      <Card className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-bold">Criar conta</h2>
          <button type="button" className="btn-ghost btn-sm" onClick={onVoltar}>Voltar</button>
        </div>

        <Campo rotulo="Nome completo" obrigatorio erro={tocado ? erros.nome : ""}>
          <input className="input" autoComplete="name" value={f.nome}
                 onChange={(e) => d("nome", e.target.value)} placeholder="Como no documento" />
        </Campo>
        <Campo rotulo="CPF" obrigatorio erro={erros.cpf}>
          <input className="input" inputMode="numeric" value={mascaraCpf(f.cpf)}
                 onChange={(e) => d("cpf", e.target.value)} placeholder="000.000.000-00" />
        </Campo>
        <div className="grid grid-cols-2 gap-3">
          <Campo rotulo="Nascimento" obrigatorio erro={erros.nascimento}>
            <input className="input" type="date" value={f.nascimento}
                   onChange={(e) => d("nascimento", e.target.value)} />
          </Campo>
          <Campo rotulo="Celular" obrigatorio erro={tocado ? erros.celular : ""}>
            <input className="input" inputMode="tel" autoComplete="tel" value={f.celular}
                   onChange={(e) => d("celular", mascaraTelefone(e.target.value))}
                   placeholder="(11) 90000-0000" />
          </Campo>
        </div>
        <Campo rotulo="E-mail" ajuda="Para avisos de cobrança e contrato">
          <input className="input" type="email" autoComplete="email" value={f.email}
                 onChange={(e) => d("email", e.target.value)} />
        </Campo>

        <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-white/10 bg-white/[.03] p-4">
          <input type="checkbox" checked={aceito} className="mt-0.5 h-5 w-5 shrink-0 accent-[#2DD4A8]"
                 onChange={(e) => setAceito(e.target.checked)} />
          <span className="text-sm text-ink-muted">
            Aceito os termos de uso e autorizo o tratamento dos meus dados, nos termos da LGPD.
          </span>
        </label>
      </Card>

      <div className="mt-auto space-y-3 pt-6">
        {tocado && !completo && <Aviso tom="erro">Confira os campos acima para continuar.</Aviso>}
        <button className="btn-primary w-full" type="submit">Criar conta</button>
        <p className="text-center text-xs leading-relaxed text-ink-faint">
          Enquanto o login por SMS não entra no ar, seu cadastro fica guardado neste aparelho.
        </p>
      </div>
    </form>
  );
}

function FormularioEntrar({ onVoltar, onCriarConta }: {
  onVoltar: () => void; onCriarConta: () => void;
}) {
  const { entrar } = usePerfil();
  const navegar = useNavigate();
  const [cpf, setCpf] = useState("");
  const [erro, setErro] = useState("");

  return (
    <form
      className="flex flex-1 flex-col"
      onSubmit={(e) => {
        e.preventDefault();
        if (entrar(cpf)) navegar(rotaInicio(), { replace: true });
        else setErro("Não achamos esse CPF neste aparelho.");
      }}
    >
      <Card className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-bold">Entrar</h2>
          <button type="button" className="btn-ghost btn-sm" onClick={onVoltar}>Voltar</button>
        </div>
        <Campo rotulo="Seu CPF" obrigatorio erro={erro}>
          <input className="input" inputMode="numeric" autoFocus value={mascaraCpf(cpf)}
                 onChange={(e) => { setCpf(e.target.value); setErro(""); }}
                 placeholder="000.000.000-00" />
        </Campo>
      </Card>

      <div className="mt-auto space-y-3 pt-6">
        <button className="btn-primary w-full" type="submit" disabled={!cpfValido(cpf)}>
          Entrar
        </button>
        <button className="btn-ghost w-full" type="button" onClick={onCriarConta}>
          Ainda não tenho conta
        </button>
      </div>
    </form>
  );
}

function idade(nascimento: string): number {
  const d = new Date(`${nascimento}T12:00:00`);
  if (Number.isNaN(d.getTime())) return 0;
  return Math.floor((Date.now() - d.getTime()) / (365.25 * 864e5));
}
