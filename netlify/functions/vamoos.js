// netlify/functions/vamoos.js
// Proxies all Vamoos API calls server-side, adding the auth header.
// Called by the React app at: /.netlify/functions/vamoos?path=/itinerary

export default async (req) => {
  const url = new URL(req.url);
  const apiPath = url.searchParams.get("path") || "/itinerary";
  
  // Forward any query params except "path"
  const forwardParams = new URLSearchParams();
  for (const [key, val] of url.searchParams.entries()) {
    if (key !== "path") forwardParams.append(key, val);
  }
  
  const queryString = forwardParams.toString();
  const targetUrl = `https://live.vamoos.com/v3${apiPath}${queryString ? "?" + queryString : ""}`;

  let body = null;
  if (req.method !== "GET" && req.method !== "HEAD") {
    body = await req.text();
  }

  try {
    const response = await fetch(targetUrl, {
      method: req.method,
      headers: {
        "X-User-Access-Token": "lc98kyzju11Yz6BoZ5JQqh7iBQVeuQovzOjSl1Gj",
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      ...(body ? { body } : {}),
    });

    const data = await response.text();

    return new Response(data, {
      status: response.status,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }
};

export const config = {
  path: "/.netlify/functions/vamoos",
};
