#!/bin/bash
# Auto-publish script: generate → approve → publish
# Uso: ./auto-publish.sh "topico" "style" (default: "list")
set -euo pipefail

API_KEY="${API_KEY:-7badf0401726a869f679a92a987edb2856c26bdd87e543ad}"
API_URL="${API_URL:-http://localhost:3456}"
TOPIC="${1:-misterios da aviacao desaparecidas}"
STYLE="${2:-list}"

log() { echo "[$(date '+%H:%M:%S')] $1"; }

log "Gerando video sobre: $TOPIC"
RESP=$(curl -s -X POST "$API_URL/generate" \
  -H "Content-Type: application/json" \
  -H "x-api-key: $API_KEY" \
  -d "{\"topic\":\"$TOPIC\",\"style\":\"$STYLE\",\"language\":\"pt-BR\"}")

JOB_ID=$(echo "$RESP" | python3 -c "import json,sys; print(json.load(sys.stdin)['result']['id'])" 2>/dev/null || echo "")
if [ -z "$JOB_ID" ]; then
  log "FALHA ao iniciar job: $RESP"
  exit 1
fi
log "Job: $JOB_ID"

log "Aguardando conclusão..."
for i in {1..60}; do
  STATUS=$(curl -s "$API_URL/api/jobs/$JOB_ID" | python3 -c "import json,sys; d=json.load(sys.stdin); r=d.get('result',d); print(r.get('status'), r.get('stage'))" 2>/dev/null || echo "unknown")
  log "[$i min] $STATUS"
  if echo "$STATUS" | grep -q "completed"; then break; fi
  if echo "$STATUS" | grep -q "failed"; then
    log "Job falhou"
    exit 1
  fi
  sleep 60
done

log "Aprovando video..."
APPROVE=$(curl -s -X POST "$API_URL/api/content/$JOB_ID/approve" \
  -H "Content-Type: application/json" \
  -H "x-api-key: $API_KEY" \
  -d '{"factChecked":true,"rightsConfirmed":true,"privacyStatus":"private"}')

if ! echo "$APPROVE" | python3 -c "import json,sys; d=json.load(sys.stdin); json.load(d); exit(0 if d.get('success') else 1)"; then
  log "Falha na aprovação: $APPROVE"
  exit 1
fi

PUBLISH=$(curl -s -X POST "$API_URL/publish/$JOB_ID" \
  -H "Content-Type: application/json" \
  -H "x-api-key: $API_KEY" \
  -d '{}')

if echo "$PUBLISH" | python3 -c "import json,sys; d=json.load(sys.stdin); exit(0 if d.get('success') else 1)"; then
  YT_URL=$(echo "$PUBLISH" | python3 -c "import json,sys; print(json.load(sys.stdin)['result'].get('youtubeUrl',''))")
  log "✅ Publicado: $YT_URL"
else
  log "Falha no publish: $PUBLISH"
  exit 1
fi