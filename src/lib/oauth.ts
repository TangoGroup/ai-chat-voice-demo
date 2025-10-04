type TokenResponse = {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope?: string;
};

type CachedToken = {
  accessToken: string;
  expiresAtMs: number;
};

let cachedToken: CachedToken | null = null;

function getTokenEndpoint(): string {
  const endpoint = process.env.OAUTH_TOKEN_ENDPOINT;
  if (!endpoint) {
    throw new Error("OAUTH_TOKEN_ENDPOINT not configured");
  }
  return endpoint;
}

export async function getClientCredentialsToken(scope: string = "api/access"): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAtMs - 10_000 > now) {
    return cachedToken.accessToken;
  }

  const clientId = process.env.OAUTH_CLIENT_ID;
  const clientSecret = process.env.OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("OAUTH_CLIENT_ID and OAUTH_CLIENT_SECRET must be set");
  }

  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const res = await fetch(getTokenEndpoint(), {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${basic}`,
    },
    body: new URLSearchParams({
      scope,
      grant_type: "client_credentials",
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Token endpoint error ${res.status}: ${errText}`);
  }

  const json = (await res.json()) as TokenResponse;
  const expiresAtMs = Date.now() + Math.max(30, json.expires_in - 5) * 1000;
  cachedToken = { accessToken: json.access_token, expiresAtMs };
  return json.access_token;
}


