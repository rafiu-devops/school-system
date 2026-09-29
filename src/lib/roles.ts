export const SCHOOL_ROLES = ["admin", "teacher", "student"] as const;

export type SchoolRole = (typeof SCHOOL_ROLES)[number];

export const ROLE_LABELS: Record<SchoolRole, string> = {
  admin: "Admin",
  teacher: "Teacher",
  student: "Student",
};

export function isSchoolRole(value: unknown): value is SchoolRole {
  return typeof value === "string" && (SCHOOL_ROLES as readonly string[]).includes(value);
}

export const SCHOOL_CITY = "Sukkur";

export const SCHOOL_NAME = "Buraq Public School";

/**
 * Every part of the school the office can hand out. The admin always holds the
 * full list; teacher access is granted one teacher at a time, and students all
 * share the single set the office keeps for the student portal.
 */
export const PERMISSION_MODULES = [
  { key: "dashboard", label: "Dashboard", detail: "The signed-in overview for the role." },
  { key: "admissions", label: "Admissions", detail: "Add, edit, and remove student records." },
  { key: "students", label: "Student information", detail: "Student register and individual profiles." },
  { key: "classes", label: "Classes & staff", detail: "Classrooms, rosters, and class teachers." },
  { key: "attendance", label: "Attendance", detail: "Daily register and attendance records." },
  { key: "exams", label: "Exams & marks", detail: "Assessments, mark entry, and results." },
  { key: "reports", label: "Report cards", detail: "Progress reports and term results." },
  { key: "announcements", label: "Announcements", detail: "School notices and class updates." },
] as const;

export type PermissionKey = (typeof PERMISSION_MODULES)[number]["key"];

export const PERMISSION_KEYS = PERMISSION_MODULES.map((module) => module.key) as PermissionKey[];

/** What "grant standard access" gives a teacher. */
export const DEFAULT_TEACHER_PERMISSIONS: PermissionKey[] = [
  "dashboard",
  "students",
  "classes",
  "attendance",
  "exams",
  "reports",
  "announcements",
];

/** The student portal starts with these and stays the same for every student. */
export const DEFAULT_STUDENT_PERMISSIONS: PermissionKey[] = [
  "dashboard",
  "students",
  "attendance",
  "exams",
  "reports",
  "announcements",
];

/** Drops anything unknown so a hand-edited document can never widen access. */
export function normalizePermissions(value: unknown): PermissionKey[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<PermissionKey>();
  value.forEach((entry) => {
    if (typeof entry === "string" && (PERMISSION_KEYS as string[]).includes(entry)) {
      seen.add(entry as PermissionKey);
    }
  });
  return PERMISSION_KEYS.filter((key) => seen.has(key));
}

export function hasPermission(granted: readonly string[], key: PermissionKey): boolean {
  return granted.includes(key);
}
