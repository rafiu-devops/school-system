import { NextResponse } from "next/server";
import { getSession, type SchoolSession } from "@/lib/session";
import {
  DEFAULT_STUDENT_PERMISSIONS,
  DEFAULT_TEACHER_PERMISSIONS,
  hasPermission,
  normalizePermissions,
  PERMISSION_KEYS,
  type PermissionKey,
  type SchoolRole,
} from "@/lib/roles";
import { ensureSeedData } from "@/lib/firestore/seed";
import {
  COLLECTIONS,
  attendanceDocId,
  createRecord,
  deleteRecord,
  deleteWhere,
  getDocument,
  listAll,
  marksDocId,
  setDocument,
  updateRecord,
  upsertByDocumentId,
  type AdminRecord,
  type AnnouncementRecord,
  type AttendanceRecord,
  type ClassRecord,
  type ExamRecord,
  type MarkRecord,
  type RolePermissionRecord,
  type StudentRecord,
  type TeacherRecord,
} from "@/lib/firestore/repository";

export const dynamic = "force-dynamic";

const todayKey = () => new Date().toISOString().slice(0, 10);

function classLabel(item: { grade: string; section: string }) {
  return `${item.grade} – ${item.section}`;
}

function safeText(value: unknown, max = 160) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function safeId(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function responseError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function safeModuleList(value: unknown): PermissionKey[] | null {
  if (!Array.isArray(value)) return null;
  if (value.some((entry) => typeof entry !== "string" || !(PERMISSION_KEYS as string[]).includes(entry))) return null;
  return normalizePermissions(value);
}

/** Firestore reports rule violations and disabled APIs as plain permission errors. */
function looksLikeRulesError(error: unknown) {
  const code = typeof error === "object" && error !== null && "code" in error ? String((error as { code: unknown }).code) : "";
  const message = error instanceof Error ? error.message : String(error);
  return /permission|insufficient/i.test(`${code} ${message}`);
}

type SchoolData = {
  role: SchoolRole;
  identity: { name: string; title: string; email: string; adminId?: number | null; teacherId?: number | null; studentId?: number | null };
  /** Modules the office granted this person. Admins always hold every module. */
  permissions: PermissionKey[];
  /** The role-wide sets, so the admin workspace can show and edit them. */
  rolePermissions: { student: PermissionKey[] };
  today: string;
  classes: ClassRecord[];
  /** The school office, so the admin workspace can manage every sign-in. */
  admins: AdminRecord[];
  teachers: TeacherRecord[];
  students: StudentRecord[];
  attendance: AttendanceRecord[];
  exams: ExamRecord[];
  marks: MarkRecord[];
  announcements: AnnouncementRecord[];
};

type Bundle = {
  admins: AdminRecord[];
  teachers: TeacherRecord[];
  classes: ClassRecord[];
  students: StudentRecord[];
  attendance: AttendanceRecord[];
  exams: ExamRecord[];
  marks: MarkRecord[];
  announcements: AnnouncementRecord[];
  studentPermissions: PermissionKey[];
};

async function loadBundle(): Promise<Bundle> {
  const [admins, teachers, classes, students, attendance, exams, marks, announcements, studentPermissionsDoc] = await Promise.all([
    listAll<AdminRecord>(COLLECTIONS.admins),
    listAll<TeacherRecord>(COLLECTIONS.teachers),
    listAll<ClassRecord>(COLLECTIONS.classes),
    listAll<StudentRecord>(COLLECTIONS.students),
    listAll<AttendanceRecord>(COLLECTIONS.attendance),
    listAll<ExamRecord>(COLLECTIONS.exams),
    listAll<MarkRecord>(COLLECTIONS.marks),
    listAll<AnnouncementRecord>(COLLECTIONS.announcements),
    getDocument<RolePermissionRecord>(COLLECTIONS.permissions, "student"),
  ]);
  // Students all share one set, so an unset document simply means the standard portal.
  const studentPermissions = studentPermissionsDoc?.modules
    ? normalizePermissions(studentPermissionsDoc.modules)
    : DEFAULT_STUDENT_PERMISSIONS;
  return { admins, teachers, classes, students, attendance, exams, marks, announcements, studentPermissions };
}

function teacherOf(session: SchoolSession, bundle: Bundle) {
  return bundle.teachers.find((person) => person.id === session.profileId) ?? null;
}

function studentOf(session: SchoolSession, bundle: Bundle) {
  return bundle.students.find((person) => person.id === session.profileId) ?? null;
}

function isAllowedClass(session: SchoolSession, classId: number, ownClassIds: number[]) {
  return session.role === "admin" || ownClassIds.includes(classId);
}

/**
 * What this person may open. Admins hold everything, students share the single
 * set the office keeps for the portal, and a teacher only holds what the office
 * granted on their profile. A teacher document written before permissions
 * existed has no list at all, which reads as the standard teacher set.
 */
function permissionsFor(session: SchoolSession, bundle: Bundle, teacher: TeacherRecord | null): PermissionKey[] {
  if (session.role === "admin") return [...PERMISSION_KEYS];
  if (session.role === "student") return bundle.studentPermissions;
  if (!teacher) return [];
  return teacher.permissions === undefined ? [...DEFAULT_TEACHER_PERMISSIONS] : normalizePermissions(teacher.permissions);
}

/** Student rows are only needed by the modules that work with students. */
function needsStudentData(granted: PermissionKey[]) {
  return (["dashboard", "students", "attendance", "exams", "reports"] as PermissionKey[]).some((key) =>
    hasPermission(granted, key),
  );
}

/** Report cards are built from results, so they reuse the exams and marks lists. */
function needsExamData(granted: PermissionKey[]) {
  return hasPermission(granted, "exams") || hasPermission(granted, "reports");
}

function buildSchoolData(session: SchoolSession, bundle: Bundle): SchoolData {
  const teacher = teacherOf(session, bundle);
  const student = studentOf(session, bundle);
  const permissions = permissionsFor(session, bundle, teacher);

  const ownClassIds =
    session.role === "teacher" && teacher
      ? bundle.classes.filter((item) => item.teacherId === teacher.id).map((item) => item.id)
      : session.role === "student" && student?.classId
        ? [student.classId]
        : bundle.classes.map((item) => item.id);

  const visibleStudents = !needsStudentData(permissions)
    ? []
    : session.role === "student"
      ? bundle.students.filter((item) => item.id === student?.id)
      : bundle.students.filter((item) => item.classId !== null && ownClassIds.includes(item.classId));
  const studentIds = new Set(visibleStudents.map((item) => item.id));

  const visibleExams = !needsExamData(permissions)
    ? []
    : bundle.exams.filter(
        (item) =>
          ownClassIds.includes(item.classId) &&
          (session.role !== "teacher" || item.subject === teacher?.subject),
      );
  const examIds = new Set(visibleExams.map((item) => item.id));

  const canSeeAttendance = hasPermission(permissions, "attendance") || hasPermission(permissions, "reports");
  const canSeeAnnouncements = hasPermission(permissions, "announcements");
  const visibleAnnouncements = !canSeeAnnouncements
    ? []
    : bundle.announcements
        .filter((item) => item.classId === null || ownClassIds.includes(item.classId))
        .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());

  const assignedTeacherIds = new Set(
    bundle.classes
      .filter((item) => ownClassIds.includes(item.id) && item.teacherId !== null)
      .map((item) => item.teacherId as number),
  );
  const visibleTeachers =
    session.role === "admin" ? bundle.teachers : bundle.teachers.filter((person) => assignedTeacherIds.has(person.id));

  const studentClass = student?.classId ? bundle.classes.find((item) => item.id === student.classId) ?? null : null;
  const identity = {
    email: session.email,
    ...(session.role === "admin"
      ? {
          name: bundle.admins.find((person) => person.id === session.profileId)?.name ?? session.name,
          title: "Principal · School admin",
          adminId: session.profileId,
        }
      : session.role === "teacher"
        ? {
            name: teacher?.name ?? session.name,
            title: `${teacher?.subject ?? "Teacher"} · ${bundle.classes.filter((item) => ownClassIds.includes(item.id)).map(classLabel).join(", ")}`,
            teacherId: teacher?.id ?? null,
          }
        : {
            name: student ? `${student.firstName} ${student.lastName}` : session.name,
            title: `Student · ${studentClass ? classLabel(studentClass) : "Not enrolled"}`,
            studentId: student?.id ?? null,
          }),
  };

  return {
    role: session.role,
    identity,
    permissions,
    rolePermissions: { student: bundle.studentPermissions },
    today: todayKey(),
    classes: bundle.classes.filter((item) => ownClassIds.includes(item.id)),
    admins: session.role === "admin" ? bundle.admins : [],
    teachers: visibleTeachers,
    students: visibleStudents,
    attendance: canSeeAttendance
      ? bundle.attendance.filter((item) => ownClassIds.includes(item.classId) && studentIds.has(item.studentId))
      : [],
    exams: visibleExams,
    marks: needsExamData(permissions)
      ? bundle.marks.filter((item) => studentIds.has(item.studentId) && examIds.has(item.examId))
      : [],
    announcements: visibleAnnouncements,
  };
}

export async function GET() {
  const session = await getSession();
  if (!session) return responseError("Please sign in to view school data.", 401);

  try {
    const seed = await ensureSeedData();
    if (seed.message) console.warn(seed.message);
    return NextResponse.json(buildSchoolData(session, await loadBundle()));
  } catch (error) {
    console.error("Failed to load school data", error);
    if (looksLikeRulesError(error)) {
      return responseError(
        "Firestore is refusing the request. Publish the rules in firestore.rules from the Firebase console, then try again.",
        500,
      );
    }
    return responseError("School data could not be loaded. Please try again.", 500);
  }
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return responseError("Please sign in to make changes.", 401);

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return responseError("The submitted form could not be read.");
  }
  const action = safeText(body.action, 40);

  try {
    const seed = await ensureSeedData();
    if (seed.message) console.warn(seed.message);
    const bundle = await loadBundle();
    const teacher = teacherOf(session, bundle);
    const permissions = permissionsFor(session, bundle, teacher);
    const ownClassIds =
      session.role === "teacher" && teacher
        ? bundle.classes.filter((item) => item.teacherId === teacher.id).map((item) => item.id)
        : [];
    const canManage = session.role === "admin";
    const can = (key: PermissionKey) => canManage || hasPermission(permissions, key);

    /**
     * One email means one sign-in. Without this a single person could hold two
     * roles and reach the school under whichever one they picked at login.
     */
    const emailAlreadyUsed = async (email: string, exceptId?: number) => {
      const inAdmins = bundle.admins.some((item) => item.email === email && item.id !== exceptId);
      const inTeachers = bundle.teachers.some((item) => item.email === email && item.id !== exceptId);
      const inStudents = bundle.students.some((item) => item.email === email && item.id !== exceptId);
      return inAdmins || inTeachers || inStudents;
    };

    if (action === "saveTeacherPermissions") {
      if (!canManage) return responseError("Only the school admin can change permissions.", 403);
      const id = safeId(body.teacherId);
      const modules = safeModuleList(body.modules);
      if (!id) return responseError("Choose a teacher to update.");
      if (!modules) return responseError("Those permissions could not be read.");
      if (!bundle.teachers.some((item) => item.id === id)) return responseError("Teacher not found.", 404);
      await updateRecord(COLLECTIONS.teachers, id, { permissions: modules });
      const teacherName = bundle.teachers.find((item) => item.id === id)?.name ?? "Teacher";
      return NextResponse.json({
        ok: true,
        permissions: modules,
        message: modules.length ? `Access granted to ${teacherName}.` : `Access removed from ${teacherName}.`,
      });
    }

    if (action === "saveStudentPermissions") {
      if (!canManage) return responseError("Only the school admin can change permissions.", 403);
      const modules = safeModuleList(body.modules);
      if (!modules) return responseError("Those permissions could not be read.");
      await setDocument(COLLECTIONS.permissions, "student", {
        role: "student",
        modules,
        updatedAt: new Date().toISOString(),
        updatedBy: bundle.admins.find((person) => person.id === session.profileId)?.name ?? session.name,
      });
      return NextResponse.json({
        ok: true,
        permissions: modules,
        message: modules.length ? "Student portal access updated." : "Student portal access removed.",
      });
    }

    if (action === "addStudent") {
      if (!canManage) return responseError("Only the school admin can admit a student.", 403);
      const firstName = safeText(body.firstName, 80);
      const lastName = safeText(body.lastName, 80);
      const gender = safeText(body.gender, 20);
      const guardianName = safeText(body.guardianName, 100);
      const guardianPhone = safeText(body.guardianPhone, 40);
      const email = safeText(body.email, 140).toLowerCase();
      const classId = safeId(body.classId);
      if (!firstName || !lastName || !guardianName || !guardianPhone || !classId || !["Boy", "Girl"].includes(gender)) {
        return responseError("Please complete each required student detail.");
      }
      if (!email.includes("@")) return responseError("Add the student's login email address.");
      if (!bundle.classes.some((item) => item.id === classId)) return responseError("Choose a class from the list.");
      if (await emailAlreadyUsed(email)) {
        return responseError("That email already has a school sign-in.", 409);
      }

      const admissionNo = `BPS-${new Date().getFullYear()}${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
      const created = await createRecord<StudentRecord>(COLLECTIONS.students, {
        admissionNo,
        firstName,
        lastName,
        gender,
        guardianName,
        guardianPhone,
        classId,
        admissionDate: todayKey(),
        birthDate: null,
        status: "Active",
        email,
        authUid: null,
      });
      return NextResponse.json({ ok: true, student: created });
    }

    if (action === "updateStudent") {
      if (!canManage) return responseError("Only the school admin can edit student details.", 403);
      const id = safeId(body.id);
      const firstName = safeText(body.firstName, 80);
      const lastName = safeText(body.lastName, 80);
      const guardianName = safeText(body.guardianName, 100);
      const guardianPhone = safeText(body.guardianPhone, 40);
      const email = safeText(body.email, 140).toLowerCase();
      const classId = safeId(body.classId);
      if (!id || !firstName || !lastName || !guardianName || !guardianPhone || !classId) {
        return responseError("Please complete each required student detail.");
      }
      if (!email.includes("@")) return responseError("Add the student's login email address.");
      if (!bundle.students.some((item) => item.id === id)) return responseError("Student not found.", 404);
      if (!bundle.classes.some((item) => item.id === classId)) return responseError("Choose a class from the list.");
      if (await emailAlreadyUsed(email, id)) return responseError("That email already has a school sign-in.", 409);
      await updateRecord(COLLECTIONS.students, id, { firstName, lastName, guardianName, guardianPhone, email, classId });
      return NextResponse.json({ ok: true });
    }

    if (action === "deleteStudent") {
      if (!canManage) return responseError("Only the school admin can remove a student.", 403);
      const id = safeId(body.id);
      if (!id) return responseError("Choose a student to remove.");
      if (!bundle.students.some((item) => item.id === id)) return responseError("Student not found.", 404);
      // Mirrors the SQL ON DELETE CASCADE rules for attendance and marks.
      await Promise.all([
        deleteWhere(COLLECTIONS.attendance, "studentId", id),
        deleteWhere(COLLECTIONS.marks, "studentId", id),
      ]);
      await deleteRecord(COLLECTIONS.students, id);
      return NextResponse.json({ ok: true });
    }

    if (action === "addAdmin") {
      if (!canManage) return responseError("Only the school admin can manage office accounts.", 403);
      const name = safeText(body.name, 100);
      const email = safeText(body.email, 140).toLowerCase();
      const phone = safeText(body.phone, 40);
      const title = safeText(body.title, 100);
      if (!name || !email.includes("@") || !phone || !title) {
        return responseError("Enter a name, valid email, phone number, and job title.");
      }
      if (await emailAlreadyUsed(email)) return responseError("That email already has a school sign-in.", 409);
      const created = await createRecord<AdminRecord>(COLLECTIONS.admins, { name, email, phone, title, authUid: null });
      return NextResponse.json({ ok: true, admin: created });
    }

    if (action === "updateAdmin") {
      if (!canManage) return responseError("Only the school admin can manage office accounts.", 403);
      const id = safeId(body.id);
      const name = safeText(body.name, 100);
      const email = safeText(body.email, 140).toLowerCase();
      const phone = safeText(body.phone, 40);
      const title = safeText(body.title, 100);
      if (!id || !name || !email.includes("@") || !phone || !title) {
        return responseError("Enter a name, valid email, phone number, and job title.");
      }
      if (!bundle.admins.some((item) => item.id === id)) return responseError("Office account not found.", 404);
      if (await emailAlreadyUsed(email, id)) return responseError("That email already has a school sign-in.", 409);
      await updateRecord(COLLECTIONS.admins, id, { name, email, phone, title });
      return NextResponse.json({ ok: true });
    }

    if (action === "deleteAdmin") {
      if (!canManage) return responseError("Only the school admin can manage office accounts.", 403);
      const id = safeId(body.id);
      if (!id) return responseError("Choose an office account to remove.");
      if (id === session.profileId) return responseError("You cannot remove your own office account.", 400);
      if (!bundle.admins.some((item) => item.id === id)) return responseError("Office account not found.", 404);
      if (bundle.admins.length <= 1) return responseError("The school needs at least one office account.", 400);
      await deleteRecord(COLLECTIONS.admins, id);
      return NextResponse.json({ ok: true });
    }

    if (action === "addTeacher") {
      if (!canManage) return responseError("Only the school admin can manage staff.", 403);
      const name = safeText(body.name, 100);
      const email = safeText(body.email, 140).toLowerCase();
      const subject = safeText(body.subject, 80);
      const phone = safeText(body.phone, 40);
      if (!name || !email.includes("@") || !subject || !phone) {
        return responseError("Enter a name, valid email, subject, and phone number.");
      }
      if (await emailAlreadyUsed(email)) {
        return responseError("That email already has a school sign-in.", 409);
      }
      // Access is never handed out automatically: the office grants it by hand.
      const created = await createRecord<TeacherRecord>(COLLECTIONS.teachers, {
        name,
        email,
        subject,
        phone,
        authUid: null,
        permissions: [],
      });
      return NextResponse.json({ ok: true, teacher: created });
    }

    if (action === "updateTeacher") {
      if (!canManage) return responseError("Only the school admin can edit staff.", 403);
      const id = safeId(body.id);
      const name = safeText(body.name, 100);
      const email = safeText(body.email, 140).toLowerCase();
      const subject = safeText(body.subject, 80);
      const phone = safeText(body.phone, 40);
      if (!id || !name || !email.includes("@") || !subject || !phone) {
        return responseError("Enter a name, valid email, subject, and phone number.");
      }
      if (!bundle.teachers.some((item) => item.id === id)) return responseError("Teacher not found.", 404);
      if (await emailAlreadyUsed(email, id)) return responseError("That email already has a school sign-in.", 409);
      // permissions is left alone so editing details never reopens an account.
      await updateRecord(COLLECTIONS.teachers, id, { name, email, subject, phone });
      return NextResponse.json({ ok: true });
    }

    if (action === "deleteTeacher") {
      if (!canManage) return responseError("Only the school admin can manage staff.", 403);
      const id = safeId(body.id);
      if (!id) return responseError("Choose a teacher to remove.");
      const assigned = bundle.classes.filter((item) => item.teacherId === id);
      if (assigned.length) {
        await Promise.all(assigned.map((item) => updateRecord(COLLECTIONS.classes, item.id, { teacherId: null })));
      }
      await deleteRecord(COLLECTIONS.teachers, id);
      return NextResponse.json({ ok: true });
    }

    if (action === "addClass") {
      if (!canManage) return responseError("Only the school admin can create a class.", 403);
      const grade = safeText(body.grade, 40);
      const section = safeText(body.section, 8).toUpperCase();
      const teacherId = body.teacherId === "" || body.teacherId === null || body.teacherId === undefined ? null : safeId(body.teacherId);
      if (!grade || !section) return responseError("Add a grade and section to create a class.");
      if (body.teacherId && !teacherId) return responseError("Choose a valid class teacher.");
      const existing = bundle.classes.find((item) => item.grade === grade && item.section === section);
      if (existing) return responseError(`${grade} – ${section} already exists.`, 409);
      const created = await createRecord<ClassRecord>(COLLECTIONS.classes, { grade, section, teacherId });
      return NextResponse.json({ ok: true, class: created });
    }

    if (action === "assignTeacher") {
      if (!canManage) return responseError("Only the school admin can assign teachers.", 403);
      const classId = safeId(body.classId);
      const teacherId = body.teacherId === "" || body.teacherId === null ? null : safeId(body.teacherId);
      if (!classId || (body.teacherId && !teacherId)) return responseError("Choose a class and a valid teacher.");
      if (teacherId && !bundle.teachers.some((item) => item.id === teacherId)) return responseError("Teacher not found.", 404);
      if (!bundle.classes.some((item) => item.id === classId)) return responseError("Class not found.", 404);
      await updateRecord(COLLECTIONS.classes, classId, { teacherId });
      return NextResponse.json({ ok: true });
    }

    if (action === "deleteClass") {
      if (!canManage) return responseError("Only the school admin can remove a class.", 403);
      const id = safeId(body.id);
      if (!id) return responseError("Choose a class to remove.");
      const inUse = bundle.students.some((item) => item.classId === id);
      if (inUse) return responseError("Move those students to another class before removing this one.", 409);
      const classExams = bundle.exams.filter((item) => item.classId === id);
      await Promise.all([
        deleteWhere(COLLECTIONS.attendance, "classId", id),
        ...classExams.map((exam) => deleteWhere(COLLECTIONS.marks, "examId", exam.id)),
      ]);
      await Promise.all(classExams.map((exam) => deleteRecord(COLLECTIONS.exams, exam.id)));
      await deleteRecord(COLLECTIONS.classes, id);
      return NextResponse.json({ ok: true });
    }

    if (action === "saveAttendance") {
      if (session.role === "student") return responseError("The student portal is view-only.", 403);
      if (!can("attendance")) return responseError("Your access does not include taking attendance.", 403);
      const classId = safeId(body.classId);
      const attendanceDate = safeText(body.date, 10);
      const records = Array.isArray(body.records) ? body.records : [];
      if (!classId || !/^\d{4}-\d{2}-\d{2}$/.test(attendanceDate) || !records.length) {
        return responseError("Choose a class and at least one student.");
      }
      if (!isAllowedClass(session, classId, ownClassIds)) {
        return responseError("You can only take attendance for your assigned class.", 403);
      }
      const classStudents = bundle.students.filter((item) => item.classId === classId);
      const validIds = new Set(classStudents.map((item) => item.id));
      const rows = records.flatMap((record) => {
        if (typeof record !== "object" || record === null) return [];
        const item = record as { studentId?: unknown; status?: unknown };
        const studentId = safeId(item.studentId);
        const status = safeText(item.status, 16);
        if (!studentId || !validIds.has(studentId) || !["Present", "Absent", "Late"].includes(status)) return [];
        return [{ studentId, classId, attendanceDate, status }];
      });
      if (!rows.length) return responseError("No valid attendance records were provided.");
      await Promise.all(
        rows.map((row) => upsertByDocumentId(COLLECTIONS.attendance, attendanceDocId(row.studentId, row.attendanceDate), row)),
      );
      return NextResponse.json({ ok: true, saved: rows.length });
    }

    if (action === "addExam") {
      if (!canManage) return responseError("Only the school admin can create exams.", 403);
      const title = safeText(body.title, 100);
      const subject = safeText(body.subject, 80);
      const classId = safeId(body.classId);
      const examDate = safeText(body.examDate, 10);
      const maxMarks = Number(body.maxMarks);
      const term = safeText(body.term, 40) || "Term 1";
      if (
        !title ||
        !subject ||
        !classId ||
        !/^\d{4}-\d{2}-\d{2}$/.test(examDate) ||
        !Number.isInteger(maxMarks) ||
        maxMarks < 1 ||
        maxMarks > 1000
      ) {
        return responseError("Please enter an exam name, subject, class, date, and valid total marks.");
      }
      if (!bundle.classes.some((item) => item.id === classId)) return responseError("Choose a class from the list.");
      const created = await createRecord<ExamRecord>(COLLECTIONS.exams, { title, subject, classId, examDate, maxMarks, term });
      return NextResponse.json({ ok: true, exam: created });
    }

    if (action === "saveMarks") {
      if (session.role === "student") return responseError("The student portal is view-only.", 403);
      if (!can("exams")) return responseError("Your access does not include entering marks.", 403);
      const examId = safeId(body.examId);
      const records = Array.isArray(body.records) ? body.records : [];
      if (!examId || !records.length) return responseError("Choose an exam and enter at least one mark.");
      const exam = bundle.exams.find((item) => item.id === examId);
      if (!exam) return responseError("That exam could not be found.", 404);
      if (!isAllowedClass(session, exam.classId, ownClassIds)) {
        return responseError("You can only enter marks for your assigned class.", 403);
      }
      if (session.role === "teacher" && exam.subject !== teacher?.subject) {
        return responseError("You can only enter marks for your subject.", 403);
      }
      const validIds = new Set(bundle.students.filter((item) => item.classId === exam.classId).map((item) => item.id));
      const rows = records.flatMap((record) => {
        if (typeof record !== "object" || record === null) return [];
        const item = record as { studentId?: unknown; score?: unknown };
        const studentId = safeId(item.studentId);
        const score = Number(item.score);
        if (!studentId || !validIds.has(studentId) || !Number.isInteger(score) || score < 0 || score > exam.maxMarks) return [];
        return [{ examId, studentId, score }];
      });
      if (!rows.length) return responseError("Check that each mark is between 0 and the exam total.");
      await Promise.all(
        rows.map((row) => upsertByDocumentId(COLLECTIONS.marks, marksDocId(row.examId, row.studentId), row)),
      );
      return NextResponse.json({ ok: true, saved: rows.length });
    }

    if (action === "addAnnouncement") {
      const title = safeText(body.title, 120);
      const message = safeText(body.body, 1000);
      const requestedClass =
        body.classId === "" || body.classId === null || body.classId === undefined ? null : safeId(body.classId);
      if (!title || !message) return responseError("Add a title and message for the announcement.");
      if (body.classId && !requestedClass) return responseError("Choose a valid class.");
      if (session.role === "student") return responseError("The student portal is view-only.", 403);
      if (!can("announcements")) return responseError("Your access does not include posting announcements.", 403);
      if (session.role === "teacher" && (!requestedClass || !ownClassIds.includes(requestedClass))) {
        return responseError("Teachers can post to their assigned class only.", 403);
      }
      if (requestedClass && !bundle.classes.some((item) => item.id === requestedClass)) {
        return responseError("Choose a class from the list.");
      }
      const targetClass = requestedClass ? bundle.classes.find((item) => item.id === requestedClass) ?? null : null;
      const authorName =
        session.role === "teacher"
          ? teacher?.name ?? "Class teacher"
          : `${bundle.admins.find((person) => person.id === session.profileId)?.name ?? session.name} · School office`;
      const created = await createRecord<AnnouncementRecord>(COLLECTIONS.announcements, {
        title,
        body: message,
        audience: targetClass ? classLabel(targetClass) : "Everyone",
        classId: requestedClass,
        authorName,
        createdAt: new Date().toISOString(),
      });
      return NextResponse.json({ ok: true, announcement: created });
    }

    if (action === "deleteAnnouncement") {
      if (!canManage) return responseError("Only the school admin can remove school announcements.", 403);
      const id = safeId(body.id);
      if (!id) return responseError("Choose an announcement to remove.");
      await deleteRecord(COLLECTIONS.announcements, id);
      return NextResponse.json({ ok: true });
    }

    return responseError("That school action is not available.");
  } catch (error) {
    console.error("Failed to save school data", error);
    if (error instanceof Error && (error.message.includes("already exists") || error.message.includes("duplicate"))) {
      return responseError("That record already exists. Check the details and try again.", 409);
    }
    return responseError("Your changes could not be saved. Please try again.", 500);
  }
}
