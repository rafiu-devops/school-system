import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { isSchoolRole, type SchoolRole } from "./roles";

export const SESSION_COOKIE = "buraq_session";

export type SchoolSession = {
  uid: string;
  email: string;
  role: SchoolRole;
  name: string;
  /** Document id inside the role's Firestore collection. */
  profileId: number;
  /** Students only: the class they are enrolled in. */
  classId: number | null;
};

function secret() {
  const value = process.env.SESSION_SECRET;
  if (!value || value.length < 32) {
    throw new Error("SESSION_SECRET is missing. Add it to .env.local before signing users in.");
  }
  return value;
}

function sign(body: string) {
  return createHmac("sha256", secret()).update(body).digest("base64url");
}

export function encodeSession(session: SchoolSession): string {
  const body = Buffer.from(JSON.stringify(session)).toString("base64url");
  return `${body}.${sign(body)}`;
}

export function decodeSession(token: string | undefined): SchoolSession | null {
  if (!token) return null;
  const [body, signature] = token.split(".");
  if (!body || !signature) return null;

  const expected = sign(body);
  const given = Buffer.from(signature);
  const wanted = Buffer.from(expected);
  if (given.length !== wanted.length || !timingSafeEqual(given, wanted)) return null;

  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Partial<SchoolSession>;
    if (
      typeof parsed.uid !== "string" ||
      typeof parsed.email !== "string" ||
      !isSchoolRole(parsed.role) ||
      typeof parsed.profileId !== "number"
    ) {
      return null;
    }
    return {
      uid: parsed.uid,
      email: parsed.email,
      role: parsed.role,
      name: typeof parsed.name === "string" ? parsed.name : parsed.email,
      profileId: parsed.profileId,
      classId: typeof parsed.classId === "number" ? parsed.classId : null,
    };
  } catch {
    return null;
  }
}

export async function getSession(): Promise<SchoolSession | null> {
  return decodeSession((await cookies()).get(SESSION_COOKIE)?.value);
}

export function sessionCookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge,
  };
}
