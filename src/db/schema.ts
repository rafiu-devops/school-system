import {
  date,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const teachers = pgTable("teachers", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  subject: text("subject").notNull(),
  phone: text("phone").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const schoolClasses = pgTable(
  "school_classes",
  {
    id: serial("id").primaryKey(),
    grade: text("grade").notNull(),
    section: text("section").notNull(),
    teacherId: integer("teacher_id").references(() => teachers.id, { onDelete: "set null" }),
  },
  (table) => [uniqueIndex("school_classes_grade_section_unique").on(table.grade, table.section)],
);

export const students = pgTable("students", {
  id: serial("id").primaryKey(),
  admissionNo: text("admission_no").notNull().unique(),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  gender: text("gender").notNull(),
  guardianName: text("guardian_name").notNull(),
  guardianPhone: text("guardian_phone").notNull(),
  classId: integer("class_id").references(() => schoolClasses.id, { onDelete: "set null" }),
  admissionDate: date("admission_date").notNull(),
  birthDate: date("birth_date"),
  status: text("status").notNull().default("Active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const attendance = pgTable(
  "attendance",
  {
    id: serial("id").primaryKey(),
    studentId: integer("student_id").notNull().references(() => students.id, { onDelete: "cascade" }),
    classId: integer("class_id").notNull().references(() => schoolClasses.id, { onDelete: "cascade" }),
    attendanceDate: date("attendance_date").notNull(),
    status: text("status").notNull(),
  },
  (table) => [uniqueIndex("attendance_student_date_unique").on(table.studentId, table.attendanceDate)],
);

export const exams = pgTable("exams", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  subject: text("subject").notNull(),
  classId: integer("class_id").notNull().references(() => schoolClasses.id, { onDelete: "cascade" }),
  examDate: date("exam_date").notNull(),
  maxMarks: integer("max_marks").notNull().default(100),
  term: text("term").notNull().default("Term 1"),
});

export const marks = pgTable(
  "marks",
  {
    id: serial("id").primaryKey(),
    examId: integer("exam_id").notNull().references(() => exams.id, { onDelete: "cascade" }),
    studentId: integer("student_id").notNull().references(() => students.id, { onDelete: "cascade" }),
    score: integer("score").notNull(),
  },
  (table) => [uniqueIndex("marks_exam_student_unique").on(table.examId, table.studentId)],
);

export const announcements = pgTable("announcements", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  audience: text("audience").notNull().default("Everyone"),
  classId: integer("class_id").references(() => schoolClasses.id, { onDelete: "set null" }),
  authorName: text("author_name").notNull().default("School office"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
