import fs from "node:fs";

const env = Object.fromEntries(
  fs.readFileSync(".env", "utf8")
    .split(/\r?\n/)
    .filter((line) => line && !line.trimStart().startsWith("#"))
    .map((line) => {
      const index = line.indexOf("=");
      return [line.slice(0, index).trim(), line.slice(index + 1).trim().replace(/^(?:"|')|(?:"|')$/g, "")];
    }),
);

const baseUrl = env.VITE_SUPABASE_URL;
const apiKey = env.VITE_SUPABASE_ANON_KEY;
const response = await fetch(`${baseUrl}/rest/v1/school_payments?select=organization_id,reference&limit=1`, {
  headers: {
    apikey: apiKey,
    Authorization: `Bearer ${apiKey}`,
    Prefer: "count=exact",
    Range: "0-0",
  },
});
const body = await response.json();
console.log(JSON.stringify({
  status: response.status,
  total: response.headers.get("content-range"),
  sample: Array.isArray(body) ? body.map(({ organization_id, reference }) => ({ organization_id, reference })) : body,
}));
