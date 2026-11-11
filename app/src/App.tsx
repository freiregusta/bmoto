/**
 * App — o projeto rodando sozinho.
 *
 * Monta o AppRoot sob a base (`/app` por padrão) e manda a raiz para lá.
 * Embutido em outro projeto, quem monta é o hospedeiro: importa o AppRoot e
 * o pendura numa rota coringa (ver app/README.md).
 */

import { Navigate, Route, Routes } from "react-router-dom";
import AppRoot from "./AppRoot";
import { BASE } from "./rotas";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to={BASE} replace />} />
      <Route path={`${BASE}/*`} element={<AppRoot />} />
      <Route path="*" element={<Navigate to={BASE} replace />} />
    </Routes>
  );
}
