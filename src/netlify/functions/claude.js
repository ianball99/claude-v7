// netlify/functions/claude.js
// v8.3 - robust error handling, detailed logging

export const handler = async (event) => {
    // CORS preflight
    if (event.httpMethod === "OPTIONS") {
      return {
        statusCode: 200,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Headers": "Content-Type",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
        },
        body: "",
      };
    }
  
    if (event.httpMethod !== "POST") {
      return {
        statusCode: 405,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({ error: "Method not allowed" }),
      };
    }
  
    // Check API key is present
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      console.error("[claude] ANTHROPIC_API_KEY is not set");
      return {
        statusCode: 500,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({ error: "ANTHROPIC_API_KEY environment variable is not set" }),
      };
    }
  
    let body;
    try {
      body = JSON.parse(event.body || "{}");
    } catch (err) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({ error: `Invalid JSON body: ${err.message}` }),
      };
    }
  
    console.log(`[claude] calling Anthropic API, model: ${body.model}, max_tokens: ${body.max_tokens}`);
  
    try {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify(body),
      });
  
      const responseText = await response.text();
      console.log(`[claude] Anthropic response status: ${response.status}, body: ${responseText.slice(0, 200)}`);
  
      return {
        statusCode: response.status,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
        body: responseText,
      };
    } catch (err) {
      console.error(`[claude] fetch error: ${err.message}`);
      return {
        statusCode: 500,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({ error: err.message }),
      };
    }
  };