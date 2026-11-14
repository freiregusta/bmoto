/**
 * Entrada — a primeira tela de quem acabou de instalar o app.
 *
 * Nada de produto antes de existir uma pessoa. A jornada é:
 *
 *   boas-vindas → e-mail → código de 6 dígitos → seus dados → início
 *
 * Por que e-mail e não senha: senha é a primeira coisa que se esquece num app
 * que a pessoa abre uma vez por semana. Por que não SMS: SMS no Brasil exige
 * provedor contratado — quando entrar, só o PerfilProvider muda, esta tela
 * continua igual.
 *
 * O cadastro aqui é da PESSOA no app. Abrir conta bancária é outra coisa, com
 * KYC e provisionamento em BaaS, e é a jornada do módulo Conta.
 */

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Aviso, Campo, Card, Carregando, Icone, Logo } from "@/components/ui";
import { cpfValido, mascaraCpf, mascaraTelefone } from "@/lib/format";
import { configurado } from "@/lib/supabase";
import { usePerfil } from "@/platform/PerfilProvider";
import { rotaInicio } from "@/rotas";

type Passo = "boas-vindas" | "email" | "codigo" | "dados";

const PROMESSAS: Array<[string, string, string]> = [
  ["Calculator", "Quanto você ganha de verdade", "Desconta combustível, manutenção e DAS"],
  ["TrendingUp", "Crédito pela sua renda real", "Sem holerite, sem fiador: a corrida é a prova"],
  ["FileText", "Sua renda comprovada", "O extrato do repasse vira prova de renda"],
];

export default function Entrada() {
  const { autenticado, precisaCompletarCadastro, carregando } = usePerfil();
  const [passo, setPasso] = useState<Passo>("boas-vindas");
  const [email, setEmail] = useState("");
  const navegar = useNavigate();

  // Quem já tem sessão válida não precisa ver esta tela.
  useEffect(() => {
    if (autenticado) navegar(rotaInicio(), { replace: true });
  }, [autenticado, navegar]);

  // Entrou mas não terminou o cadastro (ou voltou pelo link do e-mail): segue
  // de onde parou, em vez de recomeçar.
  useEffect(() => {
    if (precisaCompletarCadastro) setPasso("dados");
  }, [precisaCompletarCadastro]);

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-lg flex-col px-5 pb-10 pt-10">
      <header className="mb-8 flex flex-col items-center gap-5 text-center">
        <Logo className="h-9" />
        <h1 className="text-2xl font-bold leading-tight">
          Tudo que o motoboy precisa,
          <br />
          <span className="text-mint">em um só lugar</span>
        </h1>
      </header>

      {!configurado && (
        <Aviso tom="atencao" titulo="Sem servidor configurado">
          Este app foi publicado sem a ligação com o servidor, então não dá para criar conta
          agora. Nada aqui é inventado para contornar isso.
        </Aviso>
      )}

      {carregando ? (
        <Card><Carregando texto="Verificando sua sessão…" /></Card>
      ) : (
        <>
          {passo === "boas-vindas" && <BoasVindas onEntrar={() => setPasso("email")} />}
          {passo === "email" && (
            <PedirEmail email={email} setEmail={setEmail}
                        onVoltar={() => setPasso("boas-vindas")}
                        onEnviado={() => setPasso("codigo")} />
          )}
          {passo === "codigo" && (
            <PedirCodigo email={email} onVoltar={() => setPasso("email")} />
          )}
          {passo === "dados" && <SeusDados />}
        </>
      )}
    </div>
  );
}

function BoasVindas({ onEntrar }: { onEntrar: () => void }) {
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
        <button className="btn-primary w-full" onClick={onEntrar} disabled={!configurado}>
          Começar
        </button>
        <p className="text-center text-xs leading-relaxed text-ink-faint">
          Criar conta e entrar são a mesma coisa aqui: você informa o e-mail e recebe um
          código. Sem senha para decorar.
        </p>
      </div>
    </div>
  );
}

function PedirEmail({ email, setEmail, onVoltar, onEnviado }: {
  email: string; setEmail: (v: string) => void; onVoltar: () => void; onEnviado: () => void;
}) {
  const { enviarCodigo } = usePerfil();
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState("");
  const valido = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());

  return (
    <form
      className="flex flex-1 flex-col"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!valido) return setErro("Confira o e-mail digitado.");
        setEnviando(true);
        setErro("");
        const r = await enviarCodigo(email);
        setEnviando(false);
        if (r.estado === "ok") onEnviado();
        else setErro(r.erro);
      }}
    >
      <Card className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-bold">Seu e-mail</h2>
          <button type="button" className="btn-ghost btn-sm" onClick={onVoltar}>Voltar</button>
        </div>
        <Campo rotulo="E-mail" obrigatorio erro={erro}
               ajuda="Mandamos um código de 6 dígitos para confirmar que é você">
          <input className="input" type="email" autoComplete="email" autoFocus
                 inputMode="email" value={email}
                 onChange={(ev) => { setEmail(ev.target.value); setErro(""); }}
                 placeholder="voce@email.com" />
        </Campo>
      </Card>

      <div className="mt-auto space-y-3 pt-6">
        <button className="btn-primary w-full" type="submit" disabled={enviando || !valido}>
          {enviando ? "Enviando…" : "Receber código"}
        </button>
      </div>
    </form>
  );
}

function PedirCodigo({ email, onVoltar }: { email: string; onVoltar: () => void }) {
  const { confirmarCodigo, enviarCodigo } = usePerfil();
  const [codigo, setCodigo] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState("");
  const [reenviado, setReenviado] = useState(false);

  return (
    <form
      className="flex flex-1 flex-col"
      onSubmit={async (e) => {
        e.preventDefault();
        setEnviando(true);
        setErro("");
        const r = await confirmarCodigo(email, codigo);
        setEnviando(false);
        // Deu certo: o PerfilProvider abre a sessão e a Entrada segue para os
        // dados (ou para o início, se o cadastro já estava completo).
        if (r.estado === "erro") setErro(r.erro);
      }}
    >
      <Card className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-bold">Código enviado</h2>
          <button type="button" className="btn-ghost btn-sm" onClick={onVoltar}>Trocar e-mail</button>
        </div>
        <p className="text-sm text-ink-muted">
          Enviamos 6 dígitos para <span className="font-medium text-ink">{email}</span>. Pode
          chegar na caixa de spam.
        </p>
        <Campo rotulo="Código" obrigatorio erro={erro}>
          <input className="input text-center font-display text-2xl tracking-[0.4em]"
                 inputMode="numeric" autoComplete="one-time-code" autoFocus maxLength={6}
                 value={codigo}
                 onChange={(ev) => { setCodigo(ev.target.value.replace(/\D/g, "")); setErro(""); }}
                 placeholder="000000" />
        </Campo>
      </Card>

      <div className="mt-auto space-y-3 pt-6">
        <button className="btn-primary w-full" type="submit"
                disabled={enviando || codigo.length < 6}>
          {enviando ? "Conferindo…" : "Entrar"}
        </button>
        {reenviado ? (
          <Aviso tom="ok">Código novo enviado.</Aviso>
        ) : (
          <button className="btn-ghost w-full" type="button"
                  onClick={async () => {
                    const r = await enviarCodigo(email);
                    if (r.estado === "ok") setReenviado(true);
                    else setErro(r.erro);
                  }}>
            Não recebi, enviar de novo
          </button>
        )}
      </div>
    </form>
  );
}

/**
 * Os dados que faltam depois de entrar. CPF e nome são do cadastro no app;
 * ainda não são KYC — a verificação de identidade acontece na jornada do
 * produto, com fornecedor contratado.
 */
function SeusDados() {
  const { cadastrar, perfil, sair } = usePerfil();
  const navegar = useNavigate();
  const [f, setF] = useState({ nome: perfil.nome, cpf: perfil.cpf,
                               nascimento: perfil.nascimento, celular: perfil.celular });
  const [aceito, setAceito] = useState(false);
  const [tocado, setTocado] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  const d = (chave: keyof typeof f, valor: string) => setF((a) => ({ ...a, [chave]: valor }));

  const erros = {
    nome: f.nome.trim().split(" ").filter(Boolean).length < 2 ? "Nome e sobrenome" : "",
    cpf: f.cpf && !cpfValido(f.cpf) ? "CPF inválido" : "",
    nascimento: f.nascimento && idade(f.nascimento) < 18 ? "Precisa ter 18 anos" : "",
    celular: f.celular.replace(/\D/g, "").length < 10 ? "Celular com DDD" : "",
  };
  const completo = f.nome && f.cpf && f.nascimento && f.celular
                   && !Object.values(erros).some(Boolean) && aceito;

  return (
    <form
      className="flex flex-1 flex-col"
      onSubmit={async (e) => {
        e.preventDefault();
        setTocado(true);
        if (!completo) return;
        setSalvando(true);
        setErro("");
        const r = await cadastrar({ ...f, aceitouLgpd: aceito });
        setSalvando(false);
        if (r.estado === "ok") navegar(rotaInicio(), { replace: true });
        else setErro(r.erro);
      }}
    >
      <Card className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-bold">Seus dados</h2>
          <button type="button" className="btn-ghost btn-sm" onClick={() => void sair()}>
            Sair
          </button>
        </div>
        <p className="text-sm text-ink-muted">
          Entrou como <span className="font-medium text-ink">{perfil.email}</span>.
        </p>

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

        <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-white/10 bg-white/[.03] p-4">
          <input type="checkbox" checked={aceito}
                 className="mt-0.5 h-5 w-5 shrink-0 accent-[#2DD4A8]"
                 onChange={(e) => setAceito(e.target.checked)} />
          <span className="text-sm text-ink-muted">
            Aceito os termos de uso e autorizo o tratamento dos meus dados, nos termos da LGPD.
            Você pode apagar sua conta e todos os seus dados quando quiser, no Perfil.
          </span>
        </label>
      </Card>

      <div className="mt-auto space-y-3 pt-6">
        {erro && <Aviso tom="erro">{erro}</Aviso>}
        {tocado && !completo && !erro
          && <Aviso tom="erro">Confira os campos acima para continuar.</Aviso>}
        <button className="btn-primary w-full" type="submit" disabled={salvando}>
          {salvando ? "Criando…" : "Criar minha conta"}
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
