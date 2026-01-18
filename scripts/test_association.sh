#!/bin/bash
set -e

# Configuration
API_URL=${API_URL:-"http://localhost:3000/v1"}
ADMIN_KEY=${IKOMA_ADMIN_KEY:-"admin-secret"}

echo "--- Test de régression: Association Serveur <-> Runner ---"

# 1. Créer un Runner
echo "1. Création d'un runner..."
RUNNER_RESP=$(curl -s -X POST "$API_URL/runners" \
  -H "Content-Type: application/json" \
  -H "x-ikoma-admin-key: $ADMIN_KEY" \
  -d '{"name": "Test Runner Association"}')

RUNNER_ID=$(echo $RUNNER_RESP | grep -o '"id":"[^"]*' | cut -d'"' -f4)
echo "Runner créé: $RUNNER_ID"

# 2. Créer un Serveur
echo "2. Création d'un serveur..."
SERVER_RESP=$(curl -s -X POST "$API_URL/servers" \
  -H "Content-Type: application/json" \
  -H "x-ikoma-admin-key: $ADMIN_KEY" \
  -d '{"name": "Test Server Association", "baseUrl": "https://test-server.com"}')

SERVER_ID=$(echo $SERVER_RESP | grep -o '"id":"[^"]*' | cut -d'"' -f4)
echo "Serveur créé: $SERVER_ID"

# 3. Associer via PATCH /v1/servers/:id
echo "3. Association via PATCH /v1/servers/$SERVER_ID..."
ASSOC_RESP=$(curl -s -X PATCH "$API_URL/servers/$SERVER_ID" \
  -H "Content-Type: application/json" \
  -H "x-ikoma-admin-key: $ADMIN_KEY" \
  -d "{\"runnerId\": \"$RUNNER_ID\"}")

CHECK_RUNNER_ID=$(echo $ASSOC_RESP | grep -o '"runnerId":"[^"]*' | cut -d'"' -f4)

if [ "$CHECK_RUNNER_ID" == "$RUNNER_ID" ]; then
  echo "✅ Association réussie dans la réponse du serveur."
else
  echo "❌ Échec de l'association dans la réponse du serveur."
  echo "Réponse: $ASSOC_RESP"
  exit 1
fi

# 4. Vérifier GET /v1/runners
echo "4. Vérification de GET /v1/runners..."
RUNNERS_LIST=$(curl -s -X GET "$API_URL/runners" \
  -H "x-ikoma-admin-key: $ADMIN_KEY")

# Vérifier si le runner a le bon serverId
MATCH=$(echo $RUNNERS_LIST | grep -o "{\"id\":\"$RUNNER_ID\"[^{}]*\"serverId\":\"$SERVER_ID\"")

if [ ! -z "$MATCH" ]; then
  echo "✅ Succès: Le runner $RUNNER_ID expose bien le serverId $SERVER_ID."
  SERVER_NAME_MATCH=$(echo $MATCH | grep -o "\"serverName\":\"Test Server Association\"")
  if [ ! -z "$SERVER_NAME_MATCH" ]; then
    echo "✅ Succès: Le runner expose aussi le serverName."
  else
    echo "⚠️ Attention: serverName manquant ou incorrect."
  fi
else
  echo "❌ Échec: Le runner n'expose pas l'association attendue."
  echo "Liste des runners: $RUNNERS_LIST"
  exit 1
fi

echo "--- Test terminé avec succès ---"
