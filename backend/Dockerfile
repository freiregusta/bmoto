FROM python:3.12-slim

WORKDIR /app

# Dependências primeiro (cache de layer)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

ENV PORT=8000
# Com Postgres (DATABASE_URL), múltiplos workers são seguros — o estado é
# compartilhado no banco. Ajuste WEB_CONCURRENCY conforme o plano.
ENV WEB_CONCURRENCY=2

EXPOSE 8000
CMD ["sh", "-c", "uvicorn api:app --host 0.0.0.0 --port ${PORT} --workers ${WEB_CONCURRENCY}"]
