// src/components/Layout.tsx
import React from 'react'

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-white">
      <header className="bg-brand-900 text-white px-4 py-4 shadow-md">
        <div className="max-w-lg mx-auto flex items-center gap-2">
          <span className="text-2xl font-bold tracking-tight">BMoto</span>
          <span className="text-brand-100 text-sm font-medium">
            Crédito do Trabalhador
          </span>
        </div>
      </header>
      <main className="max-w-lg mx-auto px-4 py-8">{children}</main>
    </div>
  )
}
