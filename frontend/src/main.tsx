import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import './index.css'
import Formalizacao from './pages/formalizacao/Formalizacao'
import Dashboard from './pages/dashboard/Dashboard'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/formalizacao" element={<Formalizacao />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="*" element={<Navigate to="/formalizacao" replace />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
)
