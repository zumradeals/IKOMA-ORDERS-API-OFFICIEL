#!/bin/bash
set -e

API_URL=${API_URL:-"http://localhost:3000/v1"}
ADMIN_KEY=${IKOMA_ADMIN_KEY:-"admin-secret-key"}

echo "🚀 Testing SYSTEM.diagnostics Playbook"
echo "📍 API URL: $API_URL"

api_call() {
  local method=$1
  local path=$2
  local data=$3
  curl -s -X "$method" "$API_URL$path" \
    -H "Content-Type: application/json" \
    -H "x-ikoma-admin-key: $ADMIN_KEY" \
    -d "$data"
}

# Create a dummy server first because the order creation schema requires it
echo "🖥️ Creating dummy server..."
SERVER_RES=$(api_call "POST" "/servers" "{\"name\":\"Diag Test Server\",\"baseUrl\":\"https://example.com\"}")
SERVER_ID=$(echo "$SERVER_RES" | grep -o '"id":"[^"]*"' | cut -d'"' -f4)
echo "✅ Server ID: $SERVER_ID"

echo "📦 Triggering SYSTEM.diagnostics..."
IDEM_KEY="diag-$(date +%s)"
DIAG_RES=$(api_call "POST" "/orders" "{\"serverId\":\"$SERVER_ID\",\"playbookKey\":\"SYSTEM.diagnostics\",\"action\":\"run\",\"idempotencyKey\":\"$IDEM_KEY\",\"createdBy\":\"test-script\"}")

echo "📊 Diagnostics Result:"
echo "$DIAG_RES" | python3 -m json.tool

# Basic validation
if [[ "$DIAG_RES" == *"SYSTEM.diagnostics"* ]] && [[ "$DIAG_RES" == *"report"* ]]; then
  echo "✅ SYSTEM.diagnostics test passed!"
else
  echo "❌ SYSTEM.diagnostics test failed!"
  exit 1
fi
