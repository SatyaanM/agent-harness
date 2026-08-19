import { check, sleep } from "k6";
import http from "k6/http";

export const options = {
  stages: [
    { duration: "5s", target: 10 },
    { duration: "10s", target: 25 },
    { duration: "5s", target: 0 },
  ],
  thresholds: {
    http_req_failed: ["rate<0.01"], // <1% failure rate
    http_req_duration: ["p(95)<500"], // 95% of requests under 500ms
  },
};

const BASE_URL = __ENV.TARGET_URL || "http://127.0.0.1:3001";

export default function () {
  // 1. Health check
  const healthRes = http.get(`${BASE_URL}/api/health`);
  check(healthRes, {
    "health status is 200": (r) => r.status === 200,
  });

  // 2. Create session
  const payload = JSON.stringify({
    prompt: `k6 Load Test Session VU ${__VU} Iter ${__ITER}`,
  });
  const params = {
    headers: { "Content-Type": "application/json" },
  };

  const createRes = http.post(`${BASE_URL}/api/sessions`, payload, params);
  const createOk = check(createRes, {
    "session created status is 201": (r) => r.status === 201,
  });

  if (createOk) {
    const sessionData = JSON.parse(createRes.body);
    const sessionId = sessionData.sessionId;

    // 3. Post chat message triggering fake LLM execution
    const chatPayload = JSON.stringify({
      sessionId,
      message: "k6 load test message E2E_SCENARIO:simple-reply",
    });

    const chatRes = http.post(`${BASE_URL}/api/chat`, chatPayload, params);
    check(chatRes, {
      "chat status is 200": (r) => r.status === 200,
    });
  }

  sleep(0.1);
}
