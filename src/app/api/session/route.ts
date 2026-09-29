import { NextResponse } from "next/server";
import { isSchoolRole, SCHOOL_CITY, SCHOOL_NAME } from "@/lib/roles";
import { verifyIdToken } from "@/lib/firebase/token";
import { findSchoolProfile, rememberAuthUid, toSession } from "@/lib/firestore/profiles";
import { SESSION_COOKIE, encodeSession, sessionCookieOptions } from "@/lib/session";

export const dynamic = "force-dynamic";

const SESSION_MAX_AGE = 60 * 60 * 12;

const missingProfileMessage = {
  admin: `No school office account is linked to that email at ${SCHOOL_NAME}, ${SCHOOL_CITY}.`,
  teacher: "No teacher profile is linked to that email. Ask the school office to add you under Teaching staff.",
  student: "No student profile is linked to that email. Ask the school office to add your admission record first.",
} as const;

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "The sign-in request could not be read." }, { status: 400 });
  }

  const payload = (typeof body === "object" && body !== null ? body : {}) as { idToken?: unknown; role?: unknown };
  if (!isSchoolRole(payload.role)) {
    return NextResponse.json({ error: "Choose Admin, Teacher, or Student to continue." }, { status: 400 });
  }
  if (typeof payload.idToken !== "string") {
    return NextResponse.json({ error: "Sign in with your email and password first." }, { status: 400 });
  }

  const verified = await verifyIdToken(payload.idToken);
  if (!verified.ok) return NextResponse.json({ error: verified.reason }, { status: 401 });

  try {
    const profile = await findSchoolProfile(verified.identity, payload.role);
    if (!profile) {
      return NextResponse.json({ error: missingProfileMessage[payload.role] }, { status: 403 });
    }

    const session = toSession(verified.identity, profile);
    try {
      await rememberAuthUid(profile, verified.identity.uid);
    } catch (error) {
      console.warn("Could not store the Firebase uid on the school profile", error);
    }

    const response = NextResponse.json({ role: session.role, name: session.name, email: session.email });
    response.cookies.set(SESSION_COOKIE, encodeSession(session), sessionCookieOptions(SESSION_MAX_AGE));
    return response;
  } catch (error) {
    console.error("Could not open a school session", error);
    return NextResponse.json(
      { error: "We could not open your school workspace. Please try again." },
      { status: 500 },
    );
  }
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, "", sessionCookieOptions(0));
  return response;
}
