import { COLLECTIONS, findOne, updateRecord, type AdminRecord, type StudentRecord, type TeacherRecord } from "./repository";
import type { SchoolRole } from "@/lib/roles";
import type { VerifiedIdentity } from "@/lib/firebase/token";
import type { SchoolSession } from "@/lib/session";

export type SchoolProfile =
  | { role: "admin"; admin: AdminRecord }
  | { role: "teacher"; teacher: TeacherRecord }
  | { role: "student"; student: StudentRecord };

const collectionFor = (role: SchoolRole) => {
  if (role === "admin") return COLLECTIONS.admins;
  if (role === "teacher") return COLLECTIONS.teachers;
  return COLLECTIONS.students;
};

/**
 * Binds a verified Firebase identity to a school record. An account only gets a
 * session when its email exists in the Firestore collection for the category the
 * user picked on the login screen, so a teacher cannot sign in as an admin.
 */
export async function findSchoolProfile(
  identity: VerifiedIdentity,
  role: SchoolRole,
): Promise<SchoolProfile | null> {
  const collectionName = collectionFor(role);
  const byUid = await findOne<{ id: number; authUid: string }>(collectionName, "authUid", identity.uid);
  const record = byUid ?? (await findOne<{ id: number }>(collectionName, "email", identity.email));
  if (!record) return null;

  if (role === "admin") return { role, admin: record as unknown as AdminRecord };
  if (role === "teacher") return { role, teacher: record as unknown as TeacherRecord };
  return { role, student: record as unknown as StudentRecord };
}

export function toSession(identity: VerifiedIdentity, profile: SchoolProfile): SchoolSession {
  if (profile.role === "admin") {
    return {
      uid: identity.uid,
      email: profile.admin.email || identity.email,
      role: "admin",
      name: profile.admin.name,
      profileId: profile.admin.id,
      classId: null,
    };
  }
  if (profile.role === "teacher") {
    return {
      uid: identity.uid,
      email: profile.teacher.email || identity.email,
      role: "teacher",
      name: profile.teacher.name,
      profileId: profile.teacher.id,
      classId: null,
    };
  }
  return {
    uid: identity.uid,
    email: profile.student.email || identity.email,
    role: "student",
    name: `${profile.student.firstName} ${profile.student.lastName}`,
    profileId: profile.student.id,
    classId: profile.student.classId,
  };
}

/** Stores the Firebase uid on the school record so later sign-ins match on uid first. */
export async function rememberAuthUid(profile: SchoolProfile, uid: string): Promise<void> {
  const collectionName = collectionFor(profile.role);
  const current = profile.role === "admin" ? profile.admin : profile.role === "teacher" ? profile.teacher : profile.student;
  if (current.authUid === uid) return;
  await updateRecord(collectionName, current.id, { authUid: uid });
}
