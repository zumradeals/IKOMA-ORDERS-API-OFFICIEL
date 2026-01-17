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

# 5. Create Orders (Regression test for deterministic claim)
echo "📦 5. Creating Orders (Regression test for deterministic claim)..."
# Create first order
IDEM_KEY_1="idem-1-$(date +%s)"
ORDER_RES_1=$(api_call "POST" "/orders" "{\"serverId\":\"$SERVER_ID\",\"playbookKey\":\"$PLAYBOOK_KEY\",\"action\":\"test-1\",\"idempotencyKey\":\"$IDEM_KEY_1\",\"createdBy\":\"smoke-test\"}")
ORDER_ID_1=$(extract_json_value "$ORDER_RES_1" "id")
if [ -z "$ORDER_ID_1" ]; then
  echo "❌ Failed to create order 1. Response: $ORDER_RES_1"
  exit 1
fi
echo "✅ Order 1 created: $ORDER_ID_1"

# Wait a bit to ensure different createdAt if needed (though DB precision should handle it)
sleep 1

# Create second order
IDEM_KEY_2="idem-2-$(date +%s)"
ORDER_RES_2=$(api_call "POST" "/orders" "{\"serverId\":\"$SERVER_ID\",\"playbookKey\":\"$PLAYBOOK_KEY\",\"action\":\"test-2\",\"idempotencyKey\":\"$IDEM_KEY_2\",\"createdBy\":\"smoke-test\"}")
ORDER_ID_2=$(extract_json_value "$ORDER_RES_2" "id")
if [ -z "$ORDER_ID_2" ]; then
  echo "❌ Failed to create order 2. Response: $ORDER_RES_2"
  exit 1
fi
echo "✅ Order 2 created: $ORDER_ID_2"

# We will use ORDER_ID_1 for the rest of the smoke test as it should be claimed first
ORDER_ID=$ORDER_ID_1

# 6. Runner Heartbeat
echo "💓 6. Runner Heartbeat..."
HB_RES=$(api_call "POST" "/runner/heartbeat" "{\"status\":\"ONLINE\"}" "$RUNNER_H1" "$RUNNER_H2")
if [[ ! "$HB_RES" == *"ok\":true"* ]]; then
  echo "❌ Heartbeat failed. Response: $HB_RES"
  exit 1
fi
echo "✅ Heartbeat sent"

# 7. Claim Order
echo "📥 7. Claiming Order..."
CLAIM_RES=$(api_call "POST" "/runner/orders/claim-next" "{}" "$RUNNER_H1" "$RUNNER_H2")
CLAIMED_ID=$(extract_json_value "$CLAIM_RES" "id")
if [ "$CLAIMED_ID" != "$ORDER_ID" ]; then
  echo "❌ Failed to claim correct order. Expected $ORDER_ID, got $CLAIMED_ID. Response: $CLAIM_RES"
  exit 1
fi
echo "✅ Order claimed"

# 8. Start Order
echo "🎬 8. Starting Order..."
START_RES=$(api_call "POST" "/runner/orders/$ORDER_ID/start" "{}" "$RUNNER_H1" "$RUNNER_H2")
if [[ ! "$START_RES" == *"$ORDER_ID"* ]]; then
  echo "❌ Failed to start order. Response: $START_RES"
  exit 1
fi
echo "✅ Order started"

# 9. Complete Order
echo "🏁 9. Completing Order..."
REPORT="{\"report\":{\"version\":\"v1\",\"ok\":true,\"summary\":\"Smoke test success\",\"startedAt\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"finishedAt\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"steps\":[],\"artifacts\":{},\"errors\":[]}}"
COMP_RES=$(api_call "POST" "/runner/orders/$ORDER_ID/complete" "$REPORT" "$RUNNER_H1" "$RUNNER_H2")
if [[ ! "$COMP_RES" == *"$ORDER_ID"* ]]; then
  echo "❌ Failed to complete order. Response: $COMP_RES"
  exit 1
fi
echo "✅ Order completed"

# 10. Verify Final Status
echo "🔍 10. Verifying Final Status..."
FINAL_RES=$(api_call "GET" "/orders/$ORDER_ID" "")
FINAL_STATUS=$(extract_json_value "$FINAL_RES" "status")
if [ "$FINAL_STATUS" != "SUCCEEDED" ]; then
  echo "❌ Final status mismatch. Expected SUCCEEDED, got $FINAL_STATUS. Response: $FINAL_RES"
  exit 1
fi
echo "✅ Final status verified: $FINAL_STATUS"

echo "🎉 Smoke Test Passed Successfully!"
