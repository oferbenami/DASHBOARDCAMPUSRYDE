const GOOGLE_TOKENINFO_URL = "https://oauth2.googleapis.com/tokeninfo";

async function verifyGoogleIdToken(idToken) {
  const url = `${GOOGLE_TOKENINFO_URL}?id_token=${encodeURIComponent(idToken)}`;
  const response = await fetch(url);

  if (!response.ok) {
    return { ok: false, reason: "Token validation failed" };
  }

  const payload = await response.json();
  if (!payload.sub || !payload.email) {
    return { ok: false, reason: "Token payload missing required claims" };
  }

  if (payload.email_verified !== "true") {
    return { ok: false, reason: "Google account email is not verified" };
  }

  const expectedClientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  if (expectedClientId && payload.aud !== expectedClientId) {
    return { ok: false, reason: "Token audience does not match configured client id" };
  }

  return {
    ok: true,
    profile: {
      googleSub: payload.sub,
      email: payload.email,
      fullName: payload.name || payload.email
    }
  };
}

module.exports = {
  verifyGoogleIdToken
};
