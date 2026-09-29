import type { PermissionKey, SchoolRole } from "@/lib/roles";

/**
 * Firestore layout for Buraq Public School.
 *
 * Every collection mirrors the PostgreSQL/Drizzle schema in src/db/schema.ts
 * (admins is the one addition, so the school office can hold its own login).
 * Documents keep the schema's integer ids: the id is stored both as the numeric
 * `id` field and as the document id, so classId / teacherId / studentId /
 * examId references keep working exactly as they did in Postgres.
 */
export const COLLECTIONS = {
  admins: "admins",
  teachers: "teachers",
  students: "students",
  classes: "school_classes",
  attendance: "attendance",
  exams: "exams",
  marks: "marks",
  announcements: "announcements",
  permissions: "permissions",
} as const;

export type CollectionKey = keyof typeof COLLECTIONS;

export type AdminRecord = {
  id: number;
  name: string;
  email: string;
  phone: string;
  title: string;
  authUid: string | null;
};

export type TeacherRecord = {
  id: number;
  name: string;
  email: string;
  subject: string;
  phone: string;
  authUid: string | null;
  /**
   * Modules the school office granted this teacher. New teachers are saved with
   * an empty list and stay locked until the office grants access by hand. A
   * document written before this field existed has no key at all, which is read
   * as the standard teacher set so existing staff keep working.
   */
  permissions?: PermissionKey[];
};

/** Role-wide access, one document per role id (currently "student"). */
export type RolePermissionRecord = {
  role: SchoolRole;
  modules: PermissionKey[];
  updatedAt: string;
  updatedBy: string;
};

export type StudentRecord = {
  id: number;
  admissionNo: string;
  firstName: string;
  lastName: string;
  gender: string;
  guardianName: string;
  guardianPhone: string;
  classId: number | null;
  admissionDate: string;
  birthDate: string | null;
  status: string;
  /** Added for Firebase sign-in; the SQL schema had no student login. */
  email: string;
  authUid: string | null;
};

export type ClassRecord = { id: number; grade: string; section: string; teacherId: number | null };

export type AttendanceRecord = {
  id: number;
  studentId: number;
  classId: number;
  attendanceDate: string;
  status: string;
};

export type ExamRecord = {
  id: number;
  title: string;
  subject: string;
  classId: number;
  examDate: string;
  maxMarks: number;
  term: string;
};

export type MarkRecord = { id: number; examId: number; studentId: number; score: number };

export type AnnouncementRecord = {
  id: number;
  title: string;
  body: string;
  audience: string;
  classId: number | null;
  authorName: string;
  createdAt: string;
};

export const attendanceDocId = (studentId: number, attendanceDate: string) => `${studentId}_${attendanceDate}`;
export const marksDocId = (examId: number, studentId: number) => `${examId}_${studentId}`;

/** Time-ordered, collision-free stand-in for the SQL `serial` column. */
export function nextRecordId(): number {
  return Date.now() * 100 + Math.floor(Math.random() * 100);
}
