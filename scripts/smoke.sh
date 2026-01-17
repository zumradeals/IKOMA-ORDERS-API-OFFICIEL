#!/bin/bash
set -e

# Configuration
API_URL=${API_URL:-"http://localhost:3000/v1"}
ADMIN_KEY=${IKOMA_ADMIN_KEY:-"admin-secret-key"}

echo "🚀 Starting IKOMA Orders API Smoke Test"
echo "📍 API URL: $API_URL"

# Helper for API calls
api_call() {
  local method=$1
  local path=$2
  local data=$3
  local auth_header="x-ikoma-admin-key: $ADMIN_KEY"
  
  if [ -n "$4" ]; then
    auth_header="$4"
  fi

  curl -s -X "$method" "$API_URL$path" \
    -H "Content-Type: application/json" \
    -H "$auth_header" \
    -d "$data"
}

# 1. Create Playbook
echo "📝 1. Creating Playbook..."
PLAYBOOK_KEY="smoke-test-$(date +%s)"
PLAYBOOK_RES=$(api_call "POST" "/playbooks" "{\"key\":\"$PLAYBOOK_KEY\",\"name\":\"Smoke Test Playbook\",\"category\":\"BASE\",\"riskLevel\":\"LOW\",\"schemaVersion\":\"1.0\",\"spec\":{\"steps\":[]}}")
echo "✅ Playbook created: $PLAYBOOK_KEY"

# 2. Create Server
echo "🖥️ 2. Creating Server..."
SERVER_RES=$(api_call "POST" "/servers" "{\"name\":\"Smoke Server\",\"baseUrl\":\"https://example.com\"}")
SERVER_ID=$(echo $SERVER_RES | grep -o '"id":"[^"]*' | cut -d'"' -f4)
echo "✅ Server created: $SERVER_ID"

# 3. Create Runner
echo "🏃 3. Creating Runner..."
RUNNER_RES=$(api_call "POST" "/runners" "{\"name\":\"Smoke Runner\"}")
RUNNER_ID=$(echo $RUNNER_RES | grep -o '"id":"[^"]*' | cut -d'"' -f4)
RUNNER_TOKEN=$(echo $RUNNER_RES | grep -o '"token":"[^"]*' | cut -d'"' -f4)
echo "✅ Runner created: $RUNNER_ID"

# 4. Attach Runner to Server
echo "🔗 4. Attaching Runner to Server..."
api_call "PATCH" "/servers/$SERVER_ID/attach-runner" "{\"runnerId\":\"$RUNNER_ID\"}" > /dev/null
echo "✅ Runner attached"

# 5. Create Order
echo "📦 5. Creating Order..."
IDEM_KEY="idem-$(date +%s)"
ORDER_RES=$(api_call "POST" "/orders" "{\"serverId\":\"$SERVER_ID\",\"playbookKey\":\"$PLAYBOOK_KEY\",\"action\":\"test\",\"idempotencyKey\":\"$IDEM_KEY\",\"createdBy\":\"smoke-test\"}")
ORDER_ID=$(echo $ORDER_RES | grep -o '"id":"[^"]*' | cut -d'"' -f4)
echo "✅ Order created: $ORDER_ID"

# Runner Auth Header
RUNNER_AUTH="x-runner-id: $RUNNER_ID"
RUNNER_AUTH_FULL="$RUNNER_AUTH\nx-runner-token: $RUNNER_TOKEN"

# 6. Runner Heartbeat
echo "💓 6. Runner Heartbeat..."
api_call "POST" "/runner/heartbeat" "{\"status\":\"ONLINE\"}" "$(echo -e $RUNNER_AUTH_FULL)" > /dev/null
echo "✅ Heartbeat sent"

# 7. Claim Order
echo "📥 7. Claiming Order..."
CLAIM_RES=$(api_call "POST" "/runner/orders/claim-next" "{}" "$(echo -e $RUNNER_AUTH_FULL)")
CLAIMED_ID=$(echo $CLAIM_RES | grep -o '"id":"[^"]*' | cut -d'"' -f4)
if [ "$CLAIMED_ID" != "$ORDER_ID" ]; then
  echo "❌ Failed to claim correct order. Expected $ORDER_ID, got $CLAIMED_ID"
  exit 1
fi
echo "✅ Order claimed"

# 8. Start Order
echo "🎬 8. Starting Order..."
api_call "POST" "/runner/orders/$ORDER_ID/start" "{}" "$(echo -e $RUNNER_AUTH_FULL)" > /dev/null
echo "✅ Order started"

# 9. Complete Order
echo "🏁 9. Completing Order..."
REPORT="{\"report\":{\"version\":\"v1\",\"ok\":true,\"summary\":\"Smoke test success\",\"startedAt\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"finishedAt\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"steps\":[],\"artifacts\":{},\"errors\":[]}}"
api_call "POST" "/runner/orders/$ORDER_ID/complete" "$REPORT" "$(echo -e $RUNNER_AUTH_FULL)" > /dev/null
echo "✅ Order completed"

# 10. Verify Final Status
echo "🔍 10. Verifying Final Status..."
FINAL_RES=$(api_call "GET" "/orders/$ORDER_ID" "")
FINAL_STATUS=$(echo $FINAL_RES | grep -o '"status":"[^"]*' | cut -d'"' -f4)
if [ "$FINAL_STATUS" != "SUCCEEDED" ]; then
  echo "❌ Final status mismatch. Expected SUCCEEDED, got $FINAL_STATUS"
  exit 1
fi
echo "✅ Final status verified: $FINAL_STATUS"

echo "🎉 Smoke Test Passed Successfully!"
