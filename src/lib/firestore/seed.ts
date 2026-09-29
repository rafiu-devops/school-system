import seedData from "./seed.json";
import {
  COLLECTIONS,
  attendanceDocId,
  marksDocId,
  isEmpty,
  seedCollection,
  setDocument,
  nextRecordId,
} from "./repository";
import { DEFAULT_STUDENT_PERMISSIONS, type PermissionKey } from "@/lib/roles";

export const DEFAULT_SEED_PASSWORD = "Buraq@2026";

type SeedAdmin = { id: number; name: string; email: string; phone: string; title: string; authUid: string | null };
type SeedTeacher = {
  id: number;
  name: string;
  email: string;
  subject: string;
  phone: string;
  authUid: string | null;
  permissions?: PermissionKey[];
};
type SeedClass = { id: number; grade: string; section: string; teacherId: number | null };
type SeedStudent = {
  id: number;
  admissionNo: string;
  firstName: string;
  lastName: string;
  gender: string;
  guardianName: string;
  guardianPhone: string;
  classId: number | null;
  admissionDateOffset: number;
  birthDate: string | null;
  status: string;
  email: string;
  authUid: string | null;
};
type SeedExam = { id: number; title: string; subject: string; classId: number; examDateOffset: number; maxMarks: number; term: string };
type SeedAnnouncement = {
  id: number;
  title: string;
  body: string;
  audience: string;
  classId: number | null;
  authorName: string;
  createdAtOffsetHours: number;
};

const admins = seedData.admins as SeedAdmin[];
const teachers = seedData.teachers as SeedTeacher[];
const classes = seedData.classes as SeedClass[];
const students = seedData.students as SeedStudent[];
const exams = seedData.exams as SeedExam[];
const announcements = seedData.announcements as SeedAnnouncement[];

export function dateOffset(days: number) {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export const seedAccounts = [
  { role: "admin" as const, email: admins[0]?.email ?? "", name: admins[0]?.name ?? "" },
  ...teachers.map((teacher) => ({ role: "teacher" as const, email: teacher.email, name: teacher.name })),
  ...students.slice(0, 3).map((student) => ({
    role: "student" as const,
    email: student.email,
    name: `${student.firstName} ${student.lastName}`,
  })),
];

const markScoreSets = [
  [88, 91, 76, 84, 69, 93, 81],
  [82, 89, 91, 78, 85, 76, 87],
  [92, 81, 87, 90, 73, 84, 88],
];

function buildStudents() {
  return students.map(({ admissionDateOffset, ...student }) => ({
    ...student,
    admissionDate: dateOffset(admissionDateOffset),
  }));
}

function buildAttendance(classAId: number) {
  const rows: Record<string, unknown>[] = [];
  for (let dayOffset = 0; dayOffset < 7; dayOffset += 1) {
    const attendanceDate = dateOffset(-dayOffset);
    students.forEach((student, index) => {
      rows.push({
        id: nextRecordId(),
        studentId: student.id,
        classId: student.classId ?? classAId,
        attendanceDate,
        status: (index * 3 + dayOffset) % 17 === 0 ? "Absent" : "Present",
      });
    });
  }
  return rows;
}

function buildMarks(classAId: number) {
  const classAStudents = students
    .filter((student) => student.classId === classAId)
    .sort((left, right) => left.admissionNo.localeCompare(right.admissionNo));
  const scoredExams = exams.filter((exam) => exam.classId === classAId).slice(0, 3);
  return scoredExams.flatMap((exam, examIndex) =>
    classAStudents.map((student, studentIndex) => ({
      id: nextRecordId(),
      examId: exam.id,
      studentId: student.id,
      score: markScoreSets[examIndex]?.[studentIndex] ?? 80,
    })),
  );
}

/** Populates the Firestore collections the first time the school data is requested. */
export async function ensureSeedData(): Promise<{ seeded: boolean; message?: string }> {
  try {
    if (!(await isEmpty(COLLECTIONS.students))) return { seeded: false };
  } catch (error) {
    return {
      seeded: false,
      message: `Firestore could not be read: ${error instanceof Error ? error.message : "unknown error"}`,
    };
  }

  const classA = classes[0];
  if (!classA) return { seeded: false, message: "The seed data is missing Class 8 – A." };

  try {
    await seedCollection(COLLECTIONS.admins, admins as unknown as Record<string, unknown>[], (row) => String(row.id));
    await seedCollection(COLLECTIONS.teachers, teachers as unknown as Record<string, unknown>[], (row) => String(row.id));
    await seedCollection(COLLECTIONS.classes, classes as unknown as Record<string, unknown>[], (row) => String(row.id));
    await seedCollection(COLLECTIONS.students, buildStudents() as unknown as Record<string, unknown>[], (row) => String(row.id));

    const attendance = buildAttendance(classA.id);
    await seedCollection(COLLECTIONS.attendance, attendance, (row) =>
      attendanceDocId(row.studentId as number, row.attendanceDate as string),
    );

    const marks = buildMarks(classA.id);
    await seedCollection(COLLECTIONS.marks, marks, (row) => marksDocId(row.examId as number, row.studentId as number));

    const examRows = exams.map(({ examDateOffset, ...exam }) => ({ ...exam, examDate: dateOffset(examDateOffset) }));
    await seedCollection(COLLECTIONS.exams, examRows as unknown as Record<string, unknown>[], (row) => String(row.id));

    const now = Date.now();
    const announcementRows = announcements.map(({ createdAtOffsetHours, ...announcement }) => ({
      ...announcement,
      createdAt: new Date(now + createdAtOffsetHours * 3600_000).toISOString(),
    }));
    await seedCollection(COLLECTIONS.announcements, announcementRows as unknown as Record<string, unknown>[], (row) =>
      String(row.id),
    );

    // One shared student set: every student signs in with exactly this access.
    await setDocument(COLLECTIONS.permissions, "student", {
      role: "student",
      modules: DEFAULT_STUDENT_PERMISSIONS,
      updatedAt: new Date(now).toISOString(),
      updatedBy: "School office",
    });

    return { seeded: true };
  } catch (error) {
    return {
      seeded: false,
      message: `Firestore seed failed: ${error instanceof Error ? error.message : "unknown error"}`,
    };
  }
}
