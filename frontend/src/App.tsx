import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createBrowserRouter, ScrollRestoration, Outlet } from "react-router-dom";
import Index from "./pages/Index";
import NotFound from "./pages/NotFound";
import Formalizacao from "./pages/Formalizacao";
import AdminLayout from "./components/admin/AdminLayout";
import AdminDashboard from "./pages/admin/Dashboard";
import AdminProposals from "./pages/admin/Proposals";
import AdminPricing from "./pages/admin/Pricing";
import AdminCredit from "./pages/admin/Credit";
import AdminFlow from "./pages/admin/Flow";
import AdminPartners from "./pages/admin/Partners";
import AdminSettings from "./pages/admin/Settings";

const queryClient = new QueryClient();

const Layout = () => (
  <>
    <ScrollRestoration />
    <Outlet />
  </>
);

const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { path: "/", element: <Index /> },
      { path: "/formalizacao", element: <Formalizacao /> },
      {
        path: "/admin",
        element: <AdminLayout />,
        children: [
          { index: true, element: <AdminDashboard /> },
          { path: "propostas", element: <AdminProposals /> },
          { path: "pricing", element: <AdminPricing /> },
          { path: "credito", element: <AdminCredit /> },
          { path: "fluxo", element: <AdminFlow /> },
          { path: "parceiros", element: <AdminPartners /> },
          { path: "configuracoes", element: <AdminSettings /> },
        ],
      },
      { path: "*", element: <NotFound /> },
    ],
  },
]);

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <RouterProvider router={router} />
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
