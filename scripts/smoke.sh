#!/bin/bash
set -e

# Configuration
API_URL=${API_URL:-"http://localhost:3000/v1"}
ADMIN_KEY=${IKOMA_ADMIN_KEY:-"admin-secret-key"}

echo "🚀 Starting IKOMA Orders API Smoke Test"
echo "📍 API URL: $API_URL"

# Helper for API calls
# Usage: api_call METHOD PATH DATA [HEADER1] [HEADER2] ...
api_call() {
  local method=$1
  local path=$2
  local data=$3
  shift 3
  
  local curl_args=("-s" "-X" "$method" "$API_URL$path" "-H" "Content-Type: application/json")
  
  if [ $# -gt 0 ]; then
    # Use custom headers if provided
    for header in "$@"; do
      curl_args+=("-H" "$header")
    done
  else
    # Default to admin key if no custom headers
    curl_args+=("-H" "x-ikoma-admin-key: $ADMIN_KEY")
  fi

  if [ -n "$data" ] && [ "$data" != "null" ]; then
    curl_args+=("-d" "$data")
  fi

  curl "${curl_args[@]}"
}

# Helper to extract value from JSON string without jq
extract_json_value() {
  local json=$1
  local key=$2
  echo "$json" | grep -o "\"$key\":\"[^\"]*\"" | cut -d'"' -f4
}

# 1. Create Playbook
echo "📝 1. Creating Playbook..."
PLAYBOOK_KEY="smoke-test-$(date +%s)"
PLAYBOOK_RES=$(api_call "POST" "/playbooks" "{\"key\":\"$PLAYBOOK_KEY\",\"name\":\"Smoke Test Playbook\",\"category\":\"BASE\",\"riskLevel\":\"LOW\",\"schemaVersion\":\"1.0\",\"spec\":{\"steps\":[]}}")
if [[ ! "$PLAYBOOK_RES" == *"$PLAYBOOK_KEY"* ]]; then
  echo "❌ Failed to create playbook. Response: $PLAYBOOK_RES"
  exit 1
fi
echo "✅ Playbook created: $PLAYBOOK_KEY"

# 2. Create Server
echo "🖥️ 2. Creating Server..."
SERVER_RES=$(api_call "POST" "/servers" "{\"name\":\"Smoke Server\",\"baseUrl\":\"https://example.com\"}")
SERVER_ID=$(extract_json_value "$SERVER_RES" "id")
if [ -z "$SERVER_ID" ]; then
  echo "❌ Failed to create server. Response: $SERVER_RES"
  exit 1
fi
echo "✅ Server created: $SERVER_ID"

# 3. Create Runner
echo "🏃 3. Creating Runner..."
RUNNER_RES=$(api_call "POST" "/runners" "{\"name\":\"Smoke Runner\"}")
RUNNER_ID=$(extract_json_value "$RUNNER_RES" "id")
RUNNER_TOKEN=$(extract_json_value "$RUNNER_RES" "token")
if [ -z "$RUNNER_ID" ] || [ -z "$RUNNER_TOKEN" ]; then
  echo "❌ Failed to create runner. Response: $RUNNER_RES"
  exit 1
fi
echo "✅ Runner created: $RUNNER_ID"

# Runner Headers
RUNNER_H1="x-runner-id: $RUNNER_ID"
RUNNER_H2="x-runner-token: $RUNNER_TOKEN"

# 4. Attach Runner to Server
echo "🔗 4. Attaching Runner to Server..."
ATTACH_RES=$(api_call "PATCH" "/servers/$SERVER_ID/attach-runner" "{\"runnerId\":\"$RUNNER_ID\"}")
if [[ ! "$ATTACH_RES" == *"$RUNNER_ID"* ]]; then
  echo "❌ Failed to attach runner. Response: $ATTACH_RES"
  exit 1
fi
echo "✅ Runner attached"

# 5. FIFO Regression Test: Create 2 orders and check claim order
echo "📦 5. FIFO Regression Test..."
IDEM_KEY_1="idem-1-$(date +%s)"
ORDER_RES_1=$(api_call "POST" "/orders" "{\"serverId\":\"$SERVER_ID\",\"playbookKey\":\"$PLAYBOOK_KEY\",\"action\":\"test-1\",\"idempotencyKey\":\"$IDEM_KEY_1\",\"createdBy\":\"smoke-test\"}")
ORDER_ID_1=$(extract_json_value "$ORDER_RES_1" "id")
echo "✅ Order 1 created: $ORDER_ID_1"

sleep 1 # Ensure different createdAt

IDEM_KEY_2="idem-2-$(date +%s)"
ORDER_RES_2=$(api_call "POST" "/orders" "{\"serverId\":\"$SERVER_ID\",\"playbookKey\":\"$PLAYBOOK_KEY\",\"action\":\"test-2\",\"idempotencyKey\":\"$IDEM_KEY_2\",\"createdBy\":\"smoke-test\"}")
ORDER_ID_2=$(extract_json_value "$ORDER_RES_2" "id")
echo "✅ Order 2 created: $ORDER_ID_2"

# 6. Runner Heartbeat
echo "💓 6. Runner Heartbeat..."
HB_RES=$(api_call "POST" "/runner/heartbeat" "{\"status\":\"ONLINE\"}" "$RUNNER_H1" "$RUNNER_H2")
if [[ ! "$HB_RES" == *"ok\":true"* ]]; then
  echo "❌ Heartbeat failed. Response: $HB_RES"
  exit 1
fi
echo "✅ Heartbeat sent"

# 7. Claim First Order (Should be Order 1)
echo "📥 7. Claiming First Order (FIFO)..."
CLAIM_RES_1=$(api_call "POST" "/runner/orders/claim-next" "{}" "$RUNNER_H1" "$RUNNER_H2")
CLAIMED_ID_1=$(extract_json_value "$CLAIM_RES_1" "id")
if [ "$CLAIMED_ID_1" != "$ORDER_ID_1" ]; then
  echo "❌ FIFO Violation! Expected Order 1 ($ORDER_ID_1), but claimed $CLAIMED_ID_1. Response: $CLAIM_RES_1"
  exit 1
fi
echo "✅ Order 1 claimed correctly (FIFO)"

# 8. Start and Complete Order 1
echo "🎬 8. Processing Order 1..."
api_call "POST" "/runner/orders/$ORDER_ID_1/start" "{}" "$RUNNER_H1" "$RUNNER_H2" > /dev/null
REPORT="{\"report\":{\"version\":\"v1\",\"ok\":true,\"summary\":\"FIFO test 1 success\",\"startedAt\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"finishedAt\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"steps\":[],\"artifacts\":{},\"errors\":[]}}"
api_call "POST" "/runner/orders/$ORDER_ID_1/complete" "$REPORT" "$RUNNER_H1" "$RUNNER_H2" > /dev/null
echo "✅ Order 1 completed"

# 9. Claim Second Order (Should be Order 2)
echo "📥 9. Claiming Second Order..."
CLAIM_RES_2=$(api_call "POST" "/runner/orders/claim-next" "{}" "$RUNNER_H1" "$RUNNER_H2")
CLAIMED_ID_2=$(extract_json_value "$CLAIM_RES_2" "id")
if [ "$CLAIMED_ID_2" != "$ORDER_ID_2" ]; then
  echo "❌ Failed to claim Order 2. Expected $ORDER_ID_2, got $CLAIMED_ID_2. Response: $CLAIM_RES_2"
  exit 1
fi
echo "✅ Order 2 claimed correctly"

# 10. Final Verification
echo "🔍 10. Final Verification..."
FINAL_RES=$(api_call "GET" "/orders/$ORDER_ID_2" "")
FINAL_STATUS=$(extract_json_value "$FINAL_RES" "status")
echo "✅ Final status of Order 2: $FINAL_STATUS"

echo "🎉 Smoke Test & FIFO Regression Passed Successfully!"
