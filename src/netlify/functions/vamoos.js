const https = require("https");
const http = require("http");

exports.handler = async function (event) {
  const apiPath = event.queryStringParameters?.path || "/itinerary";

  // Forward all query params except "path"
  const forwardParams = new URLSearchParams();
  for (const [key, val] of Object.entries(event.queryStringParameters || {})) {
    if (key !== "path") forwardParams.append(key, val);
  }
  const qs = forwardParams.toString();
  const targetUrl = `https://live.vamoos.com/v3${apiPath}${qs ? "?" + qs : ""}`;

  try {
    const result = await new Promise((resolve, reject) => {
      const options = {
        method: event.httpMethod,
        headers: {
          "X-User-Access-Token": "lc98kyzju11Yz6BoZ5JQqh7iBQVeuQovzOjSl1Gj",
          "Content-Type": "application/json",
          "Accept": "application/json",
        },
      };

      const lib = targetUrl.startsWith("https") ? https : http;
      const req = lib.request(targetUrl, options, (res) => {
        let data = "";
        res.on("data", chunk => { data += chunk; });
        res.on("end", () => resolve({ status: res.statusCode, body: data }));
      });

      req.on("error", reject);

      if (event.body && event.httpMethod !== "GET") {
        req.write(event.body);
      }

      req.end();
    });

    return {
      statusCode: result.status,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
      },
      body: result.body,
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ error: err.message }),
    };
  }
};