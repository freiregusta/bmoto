"""
agents/base.py — Framework base dos agentes internos da BMoto.

Cada agente = system prompt especializado + ferramentas (funções Python)
que acessam os módulos já existentes (pricing, crédito, contabilidade).

Usa a mesma infra da Mia: API Anthropic via httpx assíncrono.
Modelo default: Haiku (barato/rápido). Agentes analíticos podem usar
Sonnet via env AGENTS_MODEL.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable

import httpx

ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages"
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
AGENTS_MODEL = os.getenv("AGENTS_MODEL", "claude-haiku-4-5-20251001")
MAX_TOOL_ROUNDS = int(os.getenv("AGENTS_MAX_TOOL_ROUNDS", "6"))


@dataclass
class Tool:
    """Ferramenta exposta a um agente."""

    name: str
    description: str
    input_schema: dict
    handler: Callable[..., Awaitable[Any]]

    def to_api(self) -> dict:
        return {
            "name": self.name,
            "description": self.description,
            "input_schema": self.input_schema,
        }


@dataclass
class BaseAgent:
    """Agente genérico com loop de tool-use."""

    name: str
    role: str
    system_prompt: str
    tools: list[Tool] = field(default_factory=list)
    model: str = AGENTS_MODEL
    max_tokens: int = 1500

    def _tool_map(self) -> dict[str, Tool]:
        return {t.name: t for t in self.tools}

    async def ask(self, question: str, context: dict | None = None) -> dict:
        """
        Faz uma pergunta ao agente. Executa até MAX_TOOL_ROUNDS rodadas
        de tool-use antes de exigir resposta final.

        Retorna: {"agent": name, "answer": str, "tool_calls": [...]}
        """
        if not ANTHROPIC_API_KEY:
            return {
                "agent": self.name,
                "answer": "ANTHROPIC_API_KEY não configurada.",
                "tool_calls": [],
                "error": True,
            }

        user_content = question
        if context:
            user_content += "\n\n<contexto>\n" + json.dumps(
                context, ensure_ascii=False, default=str
            ) + "\n</contexto>"

        messages: list[dict] = [{"role": "user", "content": user_content}]
        tool_calls_log: list[dict] = []
        tool_map = self._tool_map()

        async with httpx.AsyncClient(timeout=60) as client:
            for _round in range(MAX_TOOL_ROUNDS):
                payload: dict = {
                    "model": self.model,
                    "max_tokens": self.max_tokens,
                    "system": self.system_prompt,
                    "messages": messages,
                }
                if self.tools:
                    payload["tools"] = [t.to_api() for t in self.tools]

                resp = await client.post(
                    ANTHROPIC_API_URL,
                    headers={
                        "x-api-key": ANTHROPIC_API_KEY,
                        "anthropic-version": "2023-06-01",
                        "content-type": "application/json",
                    },
                    json=payload,
                )
                resp.raise_for_status()
                data = resp.json()

                tool_uses = [b for b in data.get("content", []) if b.get("type") == "tool_use"]
                texts = [b.get("text", "") for b in data.get("content", []) if b.get("type") == "text"]

                if not tool_uses or data.get("stop_reason") != "tool_use":
                    return {
                        "agent": self.name,
                        "answer": "\n".join(t for t in texts if t).strip(),
                        "tool_calls": tool_calls_log,
                    }

                # Executa as ferramentas pedidas e devolve os resultados
                messages.append({"role": "assistant", "content": data["content"]})
                results = []
                for tu in tool_uses:
                    tool = tool_map.get(tu["name"])
                    try:
                        if tool is None:
                            raise ValueError(f"Ferramenta desconhecida: {tu['name']}")
                        output = await tool.handler(**(tu.get("input") or {}))
                    except Exception as exc:  # noqa: BLE001 — reporta erro ao modelo
                        output = {"erro": str(exc)}
                    tool_calls_log.append({"tool": tu["name"], "input": tu.get("input")})
                    results.append(
                        {
                            "type": "tool_result",
                            "tool_use_id": tu["id"],
                            "content": json.dumps(output, ensure_ascii=False, default=str),
                        }
                    )
                messages.append({"role": "user", "content": results})

        return {
            "agent": self.name,
            "answer": "Limite de rodadas de ferramentas atingido sem resposta final.",
            "tool_calls": tool_calls_log,
            "error": True,
        }
