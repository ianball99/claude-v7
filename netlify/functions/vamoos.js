// netlify/functions/vamoos.js
// ES module syntax — compatible with "type": "module" in root package.json
// Uses built-in fetch (Node 18+, supported by Netlify)

export const handler = async (event) => {
  // Handle CORS preflight
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

  // Forward all query params except "path"
  const forwardParams = new URLSearchParams();
  for (const [key, val] of Object.entries(event.queryStringParameters || {})) {
    if (key !== "path") forwardParams.append(key, val);
  }
  const qs = forwardParams.toString();
  const targetUrl = `https://live.vamoos.com/v3${apiPath}${qs ? "?" + qs : ""}`;

  try {
    const response = await fetch(targetUrl, {
      method: event.httpMethod,
      headers: {
        "X-User-Access-Token": "lc98kyzju11Yz6BoZ5JQqh7iBQVeuQovzOjSl1Gj",
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      ...(event.body && event.httpMethod !== "GET" ? { body: event.body } : {}),
    });

    const data = await response.text();

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
    return {
      statusCode: 500,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
      body: JSON.stringify({ error: err.message }),
    };
  }
};
