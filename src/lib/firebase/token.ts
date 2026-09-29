import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { serverProjectId } from "./server";

const GOOGLE_JWKS = createRemoteJWKSet(
  new URL("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com"),
);

export type VerifiedIdentity = { uid: string; email: string; name: string };

export type TokenVerification =
  | { ok: true; identity: VerifiedIdentity }
  | { ok: false; reason: string };

/**
 * Verifies a Firebase ID token against Google's signing keys and the project audience,
 * so the server can trust the identity the browser claims without a service account.
 */
export async function verifyIdToken(idToken: string): Promise<TokenVerification> {
  if (!idToken || idToken.length > 4096) return { ok: false, reason: "Sign in again to continue." };

  try {
    const { payload } = await jwtVerify(idToken, GOOGLE_JWKS, {
      audience: serverProjectId,
      issuer: `https://securetoken.google.com/${serverProjectId}`,
    });
    const uid = typeof payload.sub === "string" ? payload.sub : "";
    const email = typeof payload.email === "string" ? payload.email.toLowerCase() : "";
    if (!uid || !email) return { ok: false, reason: "This account is missing an email address." };
    const name = typeof payload.name === "string" && payload.name
      ? payload.name
      : email.split("@")[0].replace(/[._-]+/g, " ");
    return { ok: true, identity: { uid, email, name } };
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code.includes("expired")) return { ok: false, reason: "Your sign-in expired. Please sign in again." };
    return { ok: false, reason: "We could not verify that sign-in. Please try again." };
  }
}

export type { JWTPayload };
