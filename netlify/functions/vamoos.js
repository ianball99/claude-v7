// netlify/functions/vamoos.js
// v8.4 - omits Content-Type header on GET requests

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      },
      body: "",
    };
  }

  const apiPath = event.queryStringParameters?.path || "/itinerary";

  const forwardParams = new URLSearchParams();
  for (const [key, val] of Object.entries(event.queryStringParameters || {})) {
    if (key !== "path") forwardParams.append(key, val);
  }
  const qs = forwardParams.toString();
  const targetUrl = `https://live.vamoos.com/v3${apiPath}${qs ? "?" + qs : ""}`;

  console.log(`[vamoos proxy] ${event.httpMethod} ${targetUrl}`);

  try {
    const headers = {
      "X-User-Access-Token": "lc98kyzju11Yz6BoZ5JQqh7iBQVeuQovzOjSl1Gj",
      "operator_code": "alisdair",
      "Accept": "application/json",
    };
    // Only set Content-Type for requests with a body
    if (event.httpMethod !== "GET" && event.httpMethod !== "HEAD") {
      headers["Content-Type"] = "application/json";
    }

    const response = await fetch(targetUrl, {
      method: event.httpMethod,
      headers,
      ...(event.body && event.httpMethod !== "GET" ? { body: event.body } : {}),
    });

    const data = await response.text();
    console.log(`[vamoos proxy] response ${response.status}: ${data.slice(0, 200)}`);

    return {
      statusCode: response.status,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
      },
      body: data,
    };
  } catch (err) {
    console.error(`[vamoos proxy] error: ${err.message}`);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ error: err.message }),
    };
  }
};
