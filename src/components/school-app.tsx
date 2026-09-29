"use client";

import {
  Activity,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  Bell,
  BookOpen,
  CalendarCheck,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  ClipboardCheck,
  Clock3,
  FileText,
  GraduationCap,
  LayoutDashboard,
  LogOut,
  Megaphone,
  Menu,
  MoreHorizontal,
  Plus,
  Printer,
  Rocket,
  Search,
  ShieldCheck,
  UserCog,
  UserRound,
  UserRoundPlus,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import Image from "next/image";
import { signInWithEmailAndPassword, signOut } from "firebase/auth";
import { getFirebaseAuth } from "@/lib/firebase/client";
import { SCHOOL_CITY, SCHOOL_NAME, DEFAULT_TEACHER_PERMISSIONS, hasPermission, PERMISSION_KEYS, PERMISSION_MODULES, type PermissionKey, type SchoolRole } from "@/lib/roles";

type ViewKey =
  | "dashboard"
  | "students"
  | "studentProfile"
  | "classes"
  | "teachers"
  | "attendance"
  | "exams"
  | "report"
  | "announcements"
  | "permissions"
  | "users"
  | "roadmap";

type SchoolClass = { id: number; grade: string; section: string; teacherId: number | null };
type Teacher = { id: number; name: string; email: string; subject: string; phone: string; permissions?: string[] };
type SchoolAdmin = { id: number; name: string; email: string; phone: string; title: string };
type Student = {
  id: number;
  admissionNo: string;
  firstName: string;
  lastName: string;
  gender: string;
  guardianName: string;
  guardianPhone: string;
  classId: number | null;
  admissionDate: string;
  birthDate?: string | null;
  status: string;
  email?: string;
};
type AttendanceRecord = { id: number; studentId: number; classId: number; attendanceDate: string; status: string };
type Exam = { id: number; title: string; subject: string; classId: number; examDate: string; maxMarks: number; term: string };
type Mark = { id: number; examId: number; studentId: number; score: number };
type Announcement = {
  id: number;
  title: string;
  body: string;
  audience: string;
  classId: number | null;
  authorName: string;
  createdAt: string;
};
type SchoolData = {
  role: SchoolRole;
  identity: { name: string; title: string; email: string; adminId?: number | null; teacherId?: number | null; studentId?: number | null };
  permissions: string[];
  rolePermissions: { student: string[] };
  today: string;
  classes: SchoolClass[];
  admins: SchoolAdmin[];
  teachers: Teacher[];
  students: Student[];
  attendance: AttendanceRecord[];
  exams: Exam[];
  marks: Mark[];
  announcements: Announcement[];
};
type AttendanceStatus = "Present" | "Absent" | "Late";
type AttendanceDisplayStatus = AttendanceStatus | "Not recorded";
type ModalKey = "student" | "editStudent" | "teacher" | "editTeacher" | "admin" | "editAdmin" | "class" | "exam" | "announcement" | null;

type NavItem = { key: ViewKey; label: string; icon: LucideIcon; group: string };

const roleCategories: { role: SchoolRole; label: string; title: string; icon: LucideIcon }[] = [
  { role: "admin", label: "Admin", title: "Principal & school office", icon: ShieldCheck },
  { role: "teacher", label: "Teacher", title: "Classes, attendance & marks", icon: BookOpen },
  { role: "student", label: "Student", title: "My attendance, results & report", icon: GraduationCap },
];

const navigation: Record<SchoolRole, NavItem[]> = {
  admin: [
    { key: "dashboard", label: "Overview", icon: LayoutDashboard, group: "Workspace" },
    { key: "students", label: "Students", icon: GraduationCap, group: "School" },
    { key: "classes", label: "Classes", icon: BookOpen, group: "School" },
    { key: "teachers", label: "Teachers", icon: UserCog, group: "School" },
    { key: "attendance", label: "Attendance", icon: CalendarCheck, group: "School" },
    { key: "exams", label: "Exams & marks", icon: ClipboardCheck, group: "School" },
    { key: "report", label: "Report cards", icon: FileText, group: "School" },
    { key: "announcements", label: "Announcements", icon: Megaphone, group: "Connect" },
    { key: "permissions", label: "Role permissions", icon: ShieldCheck, group: "Connect" },
    { key: "users", label: "Users", icon: Users, group: "Connect" },
  ],
  teacher: [
    { key: "dashboard", label: "My overview", icon: LayoutDashboard, group: "Workspace" },
    { key: "classes", label: "My class", icon: BookOpen, group: "Classroom" },
    { key: "students", label: "My students", icon: GraduationCap, group: "Classroom" },
    { key: "attendance", label: "Attendance", icon: CalendarCheck, group: "Classroom" },
    { key: "exams", label: "Exams & marks", icon: ClipboardCheck, group: "Classroom" },
    { key: "report", label: "Report cards", icon: FileText, group: "Classroom" },
    { key: "announcements", label: "Announcements", icon: Megaphone, group: "Connect" },
  ],
  student: [
    { key: "dashboard", label: "My overview", icon: LayoutDashboard, group: "My school" },
    { key: "attendance", label: "Attendance", icon: CalendarCheck, group: "My school" },
    { key: "report", label: "Report card", icon: FileText, group: "My school" },
    { key: "announcements", label: "Announcements", icon: Megaphone, group: "Connect" },
  ],
};

/** Views only the school office can open. */
const adminOnlyViews: ViewKey[] = ["permissions", "users"];

/** The module a view needs before it can be opened. */
const viewPermission: Partial<Record<ViewKey, PermissionKey>> = {
  dashboard: "dashboard",
  students: "students",
  studentProfile: "students",
  classes: "classes",
  attendance: "attendance",
  exams: "exams",
  report: "reports",
  announcements: "announcements",
};

/** Admissions stay with the school office, so the other roles can never hold it. */
const officeOnlyModules: PermissionKey[] = ["admissions"];

function canOpenView(view: ViewKey, role: SchoolRole, granted: readonly string[]) {
  if (role === "admin") return true;
  if (adminOnlyViews.includes(view)) return false;
  const needed = viewPermission[view];
  return needed ? hasPermission(granted, needed) : true;
}

const pageMeta: Record<ViewKey, { title: string; description: string }> = {
  dashboard: { title: "Overview", description: "A clear picture of what matters today." },
  students: { title: "Students", description: "Every student, thoughtfully organized." },
  studentProfile: { title: "Student profile", description: "A closer look at a student's school journey." },
  classes: { title: "Classes & sections", description: "Keep classrooms, rosters, and teachers in sync." },
  teachers: { title: "Teaching staff", description: "The people who make every school day count." },
  attendance: { title: "Attendance", description: "A quick, clear check-in for every student." },
  exams: { title: "Exams & marks", description: "Record results and keep every subject on track." },
  report: { title: "Report cards", description: "See the progress behind every result." },
  announcements: { title: "Announcements", description: "One dependable place for school updates." },
  permissions: { title: "Role permissions", description: "Decide who can see and do what in your school." },
  users: { title: "Users & access", description: "Every sign-in in your school, and exactly what each one can open." },
  roadmap: { title: "The full Buraq experience", description: "A few good things waiting just beyond this prototype." },
};

function classNameFor(item?: SchoolClass | null) {
  return item ? `${item.grade} – ${item.section}` : "Unassigned";
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

function shortDate(value: string, options?: Intl.DateTimeFormatOptions) {
  if (!value) return "—";
  const parsed = new Date(`${value.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("en-PK", options ?? { day: "numeric", month: "short", year: "numeric" }).format(parsed);
}

function dateAfter(value: string, offset: number) {
  const parsed = new Date(`${value}T12:00:00`);
  parsed.setDate(parsed.getDate() + offset);
  return parsed.toISOString().slice(0, 10);
}

function attendanceRate(records: AttendanceRecord[]) {
  if (!records.length) return 0;
  const present = records.filter((record) => record.status !== "Absent").length;
  return Math.round((present / records.length) * 100);
}

function letterGrade(percent: number) {
  if (percent >= 90) return "A+";
  if (percent >= 80) return "A";
  if (percent >= 70) return "B";
  if (percent >= 60) return "C";
  if (percent >= 50) return "D";
  return "F";
}

function IconAvatar({ name, size = "normal" }: { name: string; size?: "normal" | "large" | "small" }) {
  return <span className={`avatar avatar-${size}`} aria-hidden="true">{initials(name)}</span>;
}

function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`brand-lockup${compact ? " brand-compact" : ""}`}>
      <span className="brand-mark"><span /><span /><span /><span /></span>
      {!compact && <span className="brand-copy"><strong>buraq</strong><small>PUBLIC SCHOOL</small></span>}
    </div>
  );
}

function EmptyState({ icon: Icon = FileText, title, text, action }: { icon?: LucideIcon; title: string; text: string; action?: ReactNode }) {
  return (
    <div className="empty-state">
      <span className="empty-icon"><Icon size={22} /></span>
      <h3>{title}</h3>
      <p>{text}</p>
      {action}
    </div>
  );
}

/** One module on one of the permission panels. */
function PermissionToggle({ module, active, locked, onToggle }: { module: (typeof PERMISSION_MODULES)[number]; active: boolean; locked?: boolean; onToggle?: () => void }) {
  return (
    <button
      type="button"
      className={`permission-toggle${active ? " permission-toggle-on" : ""}${locked ? " permission-toggle-locked" : ""}`}
      aria-pressed={active}
      disabled={locked}
      onClick={onToggle}
    >
      <span className="permission-toggle-box">{active ? <Check size={12} strokeWidth={3} /> : null}</span>
      <span className="permission-toggle-copy">
        <strong>{module.label}</strong>
        <small>{module.detail}</small>
      </span>
    </button>
  );
}

/** Shown when the school office has not granted this person any access yet. */
function AccessPendingScreen({ name, onLogout }: { name: string; onLogout: () => void }) {
  return (
    <div className="login-screen">
      <div className="login-card access-pending-card">
        <BrandMark />
        <h1>{SCHOOL_NAME}</h1>
        <p className="login-tagline">{SCHOOL_CITY} · Your access is waiting</p>
        <div className="access-pending-note">
          <span className="permission-shield"><ShieldCheck size={22} /></span>
          <strong>Hello {name.split(" ")[0]}, you&apos;re signed in.</strong>
          <p>The school office grants each teacher access part by part, so nothing is shared until they decide. As soon as they open your account, your classes, attendance, and results will appear here.</p>
        </div>
        <button className="button button-secondary full-width" onClick={onLogout}><LogOut size={15} /> Sign out</button>
      </div>
    </div>
  );
}

function ModalFrame({ title, subtitle, onClose, children }: { title: string; subtitle: string; onClose: () => void; children: ReactNode }) {  return (
    <div className="modal-scrim" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <div className="modal-heading">
          <div><h2 id="modal-title">{title}</h2><p>{subtitle}</p></div>
          <button className="icon-button" type="button" aria-label="Close dialog" onClick={onClose}><X size={18} /></button>
        </div>
        {children}
      </section>
    </div>
  );
}

/** Asks before signing out, from anywhere in the app. */
function ConfirmSignOut({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: () => void }) {
  return (
    <ModalFrame title="Sign out of Buraq?" subtitle="This ends the session on this device." onClose={onCancel}>
      <div className="modal-form">
        <p className="confirm-note">You will need your school email and password to sign back in. Nothing you have saved will be lost.</p>
        <div className="modal-actions">
          <button className="button button-secondary" type="button" onClick={onCancel}>Stay signed in</button>
          <button className="button button-danger" type="button" onClick={onConfirm}><LogOut size={15} /> Sign out</button>
        </div>
      </div>
    </ModalFrame>
  );
}

/** The account menu. Signing out is an option inside it, never a single click. */
function AccountMenu({ name, roleLabel, email, onSignOut, onClose }: { name: string; roleLabel: string; email: string; onSignOut: () => void; onClose: () => void }) {
  return (
    <>
      <button className="menu-scrim" aria-label="Close account menu" onClick={onClose} />
      <div className="account-menu" role="menu">
        <div className="account-menu-head">
          <IconAvatar name={name} />
          <span><strong>{name}</strong><small>{roleLabel}</small></span>
        </div>
        {email && <p className="account-menu-email">{email}</p>}
        <div className="account-menu-separator" />
        <button className="account-menu-item account-menu-danger" role="menuitem" onClick={onSignOut}><LogOut size={15} /><span><strong>Sign out</strong><small>End this session on this device</small></span></button>
      </div>
    </>
  );
}

function FormField({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return <label className="form-field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>;
}

const authErrorMessages: Record<string, string> = {
  "auth/invalid-credential": "That email and password do not match an account.",
  "auth/wrong-password": "That email and password do not match an account.",
  "auth/user-not-found": "No account was found for that email address.",
  "auth/invalid-email": "Enter a valid email address.",
  "auth/user-disabled": "This account has been disabled. Contact the school office.",
  "auth/too-many-requests": "Too many attempts. Please wait a moment and try again.",
  "auth/network-request-failed": "We could not reach the sign-in service. Check your connection.",
  "auth/operation-not-allowed": "Email and password sign-in is not enabled in the Firebase console yet.",
};

export default function SchoolApp({ initialRole }: { initialRole: SchoolRole | null }) {
  const [role, setRole] = useState<SchoolRole | null>(initialRole);
  const [selectedRole, setSelectedRole] = useState<SchoolRole>("admin");
  const [data, setData] = useState<SchoolData | null>(null);
  const [currentView, setCurrentView] = useState<ViewKey>("dashboard");
  const [loading, setLoading] = useState(Boolean(initialRole));
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [toast, setToast] = useState("");
  const [modal, setModal] = useState<ModalKey>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [accountMenu, setAccountMenu] = useState<"sidebar" | "topbar" | null>(null);
  const [confirmingSignOut, setConfirmingSignOut] = useState(false);
  const [studentSearch, setStudentSearch] = useState("");
  const [studentFilter, setStudentFilter] = useState("all");
  const [userSearch, setUserSearch] = useState("");
  const [userRoleFilter, setUserRoleFilter] = useState<"all" | SchoolRole>("all");
  const [expandedUserId, setExpandedUserId] = useState<number | null>(null);
  const [editingTeacherId, setEditingTeacherId] = useState(0);
  const [editingAdminId, setEditingAdminId] = useState(0);
  const [studentPage, setStudentPage] = useState(1);
  const [selectedStudentId, setSelectedStudentId] = useState(0);
  const [attendanceClassId, setAttendanceClassId] = useState(0);
  const [attendanceDate, setAttendanceDate] = useState("");
  const [attendanceStatuses, setAttendanceStatuses] = useState<Record<number, AttendanceDisplayStatus>>({});
  const [selectedExamId, setSelectedExamId] = useState(0);
  const [scores, setScores] = useState<Record<number, string>>({});
  // Unsaved permission edits, kept out of the loaded data until they are saved.
  const [accessDraft, setAccessDraft] = useState<{ student?: string[]; teachers?: Record<number, string[]> }>({});

  const loadData = useCallback(async () => {
    const response = await fetch("/api/school", { cache: "no-store" });
    const result = await response.json() as SchoolData & { error?: string };
    if (!response.ok) throw new Error(result.error || "We couldn't open your school workspace.");
    setData(result);
    setLoadError("");
    setLoading(false);
    return result;
  }, []);

  useEffect(() => {
    if (!role) {
      setData(null);
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    fetch("/api/school", { cache: "no-store" })
      .then(async (response) => {
        const result = await response.json() as SchoolData & { error?: string };
        if (!response.ok) throw new Error(result.error || "We couldn't open your school workspace.");
        if (active) {
          setData(result);
          setLoadError("");
          setLoading(false);
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setLoadError(error instanceof Error ? error.message : "We couldn't open your school workspace.");
          setLoading(false);
        }
      });
    return () => { active = false; };
  }, [role]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 3600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!data) return;
    setAttendanceClassId((current) => data.classes.some((item) => item.id === current) ? current : data.classes[0]?.id ?? 0);
    setAttendanceDate((current) => current || data.today);
    setSelectedStudentId((current) => data.students.some((item) => item.id === current) ? current : data.students[0]?.id ?? 0);
    setSelectedExamId((current) => data.exams.some((item) => item.id === current) ? current : data.exams[0]?.id ?? 0);
  }, [data]);

  useEffect(() => {
    if (!data || !attendanceClassId || !attendanceDate) return;
    const next: Record<number, AttendanceDisplayStatus> = {};
    data.students.filter((student) => student.classId === attendanceClassId).forEach((student) => {
      const saved = data.attendance.find((record) => record.studentId === student.id && record.attendanceDate === attendanceDate);
      const status = saved?.status;
      next[student.id] = status === "Absent" || status === "Late"
        ? status
        : saved
          ? "Present"
          : role === "student"
            ? "Not recorded"
            : "Present";
    });
    setAttendanceStatuses(next);
  }, [data, attendanceClassId, attendanceDate, role]);

  useEffect(() => {
    if (!data || !selectedExamId) return;
    const exam = data.exams.find((item) => item.id === selectedExamId);
    if (!exam) return;
    const next: Record<number, string> = {};
    data.students.filter((student) => student.classId === exam.classId).forEach((student) => {
      const saved = data.marks.find((mark) => mark.studentId === student.id && mark.examId === exam.id);
      next[student.id] = saved ? String(saved.score) : "";
    });
    setScores(next);
  }, [data, selectedExamId]);

  const login = async (email: string, password: string) => {
    setSaving(true);
    setActionError("");
    try {
      const credential = await signInWithEmailAndPassword(getFirebaseAuth(), email.trim(), password);
      const idToken = await credential.user.getIdToken();

      const response = await fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken, role: selectedRole }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) {
        await signOut(getFirebaseAuth());
        throw new Error(result.error || "We could not sign you in. Please try again.");
      }
      setCurrentView("dashboard");
      setRole(selectedRole);
      setLoadError("");
    } catch (error) {
      const code = typeof error === "object" && error !== null && "code" in error ? String((error as { code: unknown }).code) : "";
      setActionError(
        authErrorMessages[code] ?? (error instanceof Error ? error.message : "Sign in could not be completed."),
      );
    } finally {
      setSaving(false);
    }
  };

  const logout = async () => {
    setConfirmingSignOut(false);
    setAccountMenu(null);
    try {
      await signOut(getFirebaseAuth());
    } catch {
      // The Firebase session is gone either way; clear the school cookie below.
    }
    await fetch("/api/session", { method: "DELETE" });
    setData(null);
    setRole(null);
    setCurrentView("dashboard");
    setMobileOpen(false);
    setActionError("");
  };

  /** Signing out always asks first, whatever the person clicked. */
  const requestSignOut = () => {
    setAccountMenu(null);
    setConfirmingSignOut(true);
  };

  const mutate = async (payload: Record<string, unknown>, successMessage: string) => {
    setSaving(true);
    setActionError("");
    try {
      const response = await fetch("/api/school", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "Your changes could not be saved.");
      await loadData();
      setToast(successMessage);
      return true;
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Your changes could not be saved.");
      return false;
    } finally {
      setSaving(false);
    }
  };

  const submitForm = async (event: FormEvent<HTMLFormElement>, action: string, successMessage: string) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget).entries());
    const done = await mutate({ ...values, action }, successMessage);
    if (done) setModal(null);
  };

  const changeView = (next: ViewKey) => {
    setAccountMenu(null);
    if (role && !canOpenView(next, role, data?.permissions ?? [])) {
      setActionError("Your access does not include this part of the school yet.");
      setCurrentView(grantedNav[0]?.key ?? "dashboard");
      setMobileOpen(false);
      return;
    }
    setCurrentView(next);
    setMobileOpen(false);
    setActionError("");
  };

  if (!role) {
    return (
      <LoginScreen
        selectedRole={selectedRole}
        onSelect={setSelectedRole}
        onSubmit={login}
        saving={saving}
        error={actionError}
      />
    );
  }

  if (loading && !data) return <LoadingScreen />;
  if (!data) {
    return <><LoadingScreen error={loadError} onRetry={() => { setLoading(true); void loadData().catch((error: unknown) => { setLoadError(error instanceof Error ? error.message : "Please try again."); setLoading(false); }); }} onLogout={requestSignOut} />{confirmingSignOut && <ConfirmSignOut onCancel={() => setConfirmingSignOut(false)} onConfirm={() => void logout()} />}</>;
  }
  if (role !== "admin" && data.permissions.length === 0) return <><AccessPendingScreen name={data.identity.name} onLogout={requestSignOut} />{confirmingSignOut && <ConfirmSignOut onCancel={() => setConfirmingSignOut(false)} onConfirm={() => void logout()} />}</>;

  const classById = new Map(data.classes.map((item) => [item.id, item]));
  const teacherById = new Map(data.teachers.map((item) => [item.id, item]));
  const selectedStudent = data.students.find((item) => item.id === selectedStudentId) ?? data.students[0];
  const chosenAttendanceClass = data.classes.find((item) => item.id === attendanceClassId) ?? data.classes[0];
  const attendanceStudents = data.students.filter((student) => student.classId === attendanceClassId);
  const selectedExam = data.exams.find((item) => item.id === selectedExamId);
  const grantedNav = navigation[role].filter((item) => canOpenView(item.key, role, data.permissions));
  const shortcut: { view: ViewKey; title: string; sub: string } =
    role === "admin"
      ? { view: "users", title: "Everyone in your school", sub: "Add users and control access" }
      : hasPermission(data.permissions, "announcements")
        ? { view: "announcements", title: "School updates", sub: role === "teacher" ? "Post a note to your class" : "Read the latest notices" }
        : { view: grantedNav[0]?.key ?? "dashboard", title: "Your workspace", sub: "Open what you have access to" };
  const activeView: ViewKey = canOpenView(currentView, role, data.permissions) ? currentView : grantedNav[0]?.key ?? "dashboard";
  const activeLink = grantedNav.find((item) => item.key === activeView);
  const title = pageMeta[activeView].title;
  const roleLabel = role === "admin" ? "School admin" : role === "teacher" ? "Class teacher" : "Student portal";
  const identityName = data.identity.name;
  const todayAttendance = data.attendance.filter((record) => record.attendanceDate === data.today);
  const attendedPercent = attendanceRate(todayAttendance);
  const nextExam = data.exams
    .filter((exam) => exam.examDate >= data.today)
    .sort((left, right) => left.examDate.localeCompare(right.examDate))[0];
  const studentMarks = selectedStudent ? data.marks.filter((mark) => mark.studentId === selectedStudent.id) : [];
  const averageMarks = studentMarks.length
    ? Math.round(studentMarks.reduce((total, mark) => total + mark.score, 0) / studentMarks.length)
    : 0;
  const searchResults = data.students.filter((student) => {
    const fullName = `${student.firstName} ${student.lastName}`.toLowerCase();
    const matchesSearch = !studentSearch || `${fullName} ${student.admissionNo} ${student.guardianName}`.toLowerCase().includes(studentSearch.toLowerCase());
    const matchesClass = studentFilter === "all" || String(student.classId) === studentFilter;
    return matchesSearch && matchesClass;
  });
  const pageSize = 8;
  const pageCount = Math.max(1, Math.ceil(searchResults.length / pageSize));
  const pagedStudents = searchResults.slice((studentPage - 1) * pageSize, studentPage * pageSize);
  const reportStudent = selectedStudent;
  const reportExams = reportStudent
    ? data.exams.filter((exam) => exam.classId === reportStudent.classId && data.marks.some((mark) => mark.studentId === reportStudent.id && mark.examId === exam.id))
    : [];
  const reportTotal = reportExams.reduce((total, exam) => total + (data.marks.find((mark) => mark.studentId === reportStudent?.id && mark.examId === exam.id)?.score ?? 0), 0);
  const reportPossible = reportExams.reduce((total, exam) => total + exam.maxMarks, 0);
  const reportPercent = reportPossible ? Math.round((reportTotal / reportPossible) * 100) : 0;
  const reportAttendance = reportStudent
    ? data.attendance.filter((record) => record.studentId === reportStudent.id && record.attendanceDate >= dateAfter(data.today, -6))
    : [];
  const weeklyAttendance = Array.from({ length: 7 }, (_, index) => {
    const day = dateAfter(data.today, index - 6);
    const records = data.attendance.filter((record) => record.attendanceDate === day);
    return { day, label: shortDate(day, { weekday: "short" }), rate: attendanceRate(records), total: records.length };
  });

  const headlineActions: Partial<Record<ViewKey, ReactNode>> = {
    students: role === "admin" ? <button className="button button-primary" onClick={() => { setActionError(""); setModal("student"); }}><Plus size={16} /> Add student</button> : null,
    teachers: role === "admin" ? <button className="button button-primary" onClick={() => { setActionError(""); setModal("teacher"); }}><Plus size={16} /> Add teacher</button> : null,
    classes: role === "admin" ? <button className="button button-primary" onClick={() => { setActionError(""); setModal("class"); }}><Plus size={16} /> Create class</button> : null,
    exams: role === "admin" ? <button className="button button-primary" onClick={() => { setActionError(""); setModal("exam"); }}><Plus size={16} /> Create exam</button> : null,
    announcements: role !== "student" ? <button className="button button-primary" onClick={() => { setActionError(""); setModal("announcement"); }}><Plus size={16} /> New announcement</button> : null,
    users: role === "admin" ? <button className="button button-primary" onClick={() => { setActionError(""); setModal("admin"); }}><Plus size={16} /> Add user</button> : null,
  };

  const removeStudent = async (student: Student) => {
    if (!window.confirm(`Remove ${student.firstName} ${student.lastName} from the student list?`)) return;
    await mutate({ action: "deleteStudent", id: student.id }, "Student removed from the register.");
    if (selectedStudentId === student.id) setCurrentView("students");
  };

  const removeTeacher = async (teacher: Teacher) => {
    if (!window.confirm(`Remove ${teacher.name} from teaching staff?`)) return;
    await mutate({ action: "deleteTeacher", id: teacher.id }, "Teacher removed from staff.");
  };

  const removeUser = async (row: { role: SchoolRole; id: number; name: string }) => {
    const what = row.role === "admin" ? "this office account" : row.role === "teacher" ? "this teacher" : "this student";
    if (!window.confirm(`Remove ${what}, ${row.name}? They will no longer be able to sign in.`)) return;
    const action = row.role === "admin" ? "deleteAdmin" : row.role === "teacher" ? "deleteTeacher" : "deleteStudent";
    const done = await mutate({ action, id: row.id }, `${row.name} removed.`);
    if (done && expandedUserId === row.id) setExpandedUserId(null);
  };

  const saveAttendance = async () => {
    const records = attendanceStudents.map((student) => ({ studentId: student.id, status: attendanceStatuses[student.id] ?? "Present" }));
    await mutate({ action: "saveAttendance", classId: attendanceClassId, date: attendanceDate, records }, "Attendance saved for the selected class.");
  };

  const saveMarks = async () => {
    if (!selectedExam) return;
    const records = Object.entries(scores).filter(([, score]) => score !== "").map(([studentId, score]) => ({ studentId: Number(studentId), score: Number(score) }));
    await mutate({ action: "saveMarks", examId: selectedExam.id, records }, "Marks saved. The report card is up to date.");
  };

  const setAllAttendance = (status: AttendanceStatus) => {
    const updated: Record<number, AttendanceStatus> = {};
    attendanceStudents.forEach((student) => { updated[student.id] = status; });
    setAttendanceStatuses(updated);
  };

  const changeSelectedExam = (id: number) => {
    setSelectedExamId(id);
    const exam = data.exams.find((item) => item.id === id);
    if (!exam) return;
    const next: Record<number, string> = {};
    data.students.filter((student) => student.classId === exam.classId).forEach((student) => {
      const saved = data.marks.find((mark) => mark.studentId === student.id && mark.examId === id);
      next[student.id] = saved ? String(saved.score) : "";
    });
    setScores(next);
  };

  const renderDashboard = () => {
    const roleIsStudent = role === "student";
    const classLabel = role === "teacher" ? data.classes.map(classNameFor).join(", ") : selectedStudent ? classNameFor(classById.get(selectedStudent.classId ?? -1)) : "Your school";
    const weeklyRecords = data.attendance.filter((record) => record.attendanceDate >= dateAfter(data.today, -6));
    const dashboardRate = roleIsStudent && selectedStudent
      ? attendanceRate(weeklyRecords.filter((record) => record.studentId === selectedStudent.id))
      : attendanceRate(weeklyRecords);
    const dashboardMarkValues = roleIsStudent && selectedStudent
      ? data.marks.filter((mark) => mark.studentId === selectedStudent.id)
      : role === "teacher"
        ? data.marks.filter((mark) => data.exams.some((exam) => exam.id === mark.examId && exam.subject === "Mathematics"))
        : data.marks;
    const dashboardAverage = dashboardMarkValues.length
      ? Math.round(dashboardMarkValues.reduce((sum, mark) => sum + mark.score, 0) / dashboardMarkValues.length)
      : 0;
    const upcomingLabel = nextExam ? `${nextExam.subject} · ${classNameFor(classById.get(nextExam.classId))}` : "No exams scheduled";
    const daysUntil = nextExam ? Math.max(0, Math.ceil((new Date(`${nextExam.examDate}T12:00:00`).getTime() - new Date(`${data.today}T12:00:00`).getTime()) / 86400000)) : null;
    const stats = role === "admin"
      ? [
        { label: "Enrolled students", value: data.students.length.toString(), detail: `Across ${data.classes.length} active sections`, icon: GraduationCap, tint: "mint" },
        { label: "Teaching staff", value: data.teachers.length.toString(), detail: "All staff members active", icon: UserCog, tint: "lilac" },
        { label: "Today's attendance", value: `${attendedPercent}%`, detail: `${todayAttendance.filter((item) => item.status !== "Absent").length} students checked in`, icon: CalendarCheck, tint: "peach" },
        { label: "Upcoming assessment", value: daysUntil === null ? "—" : daysUntil === 0 ? "Today" : `${daysUntil} days`, detail: upcomingLabel, icon: Clock3, tint: "blue" },
      ]
      : role === "teacher"
        ? [
          { label: "Your students", value: data.students.length.toString(), detail: classLabel, icon: GraduationCap, tint: "mint" },
          { label: "Today's attendance", value: `${attendedPercent}%`, detail: "Class check-in so far", icon: CalendarCheck, tint: "peach" },
          { label: "Class average", value: `${dashboardAverage}%`, detail: "Across recorded marks", icon: BarChart3, tint: "lilac" },
          { label: "Next assessment", value: daysUntil === null ? "—" : `${daysUntil} days`, detail: upcomingLabel, icon: Clock3, tint: "blue" },
        ]
        : [
          { label: "My admission no.", value: selectedStudent?.admissionNo ?? "—", detail: classLabel, icon: GraduationCap, tint: "mint" },
          { label: "Attendance", value: `${dashboardRate}%`, detail: "This week's attendance", icon: CalendarCheck, tint: "peach" },
          { label: "Current average", value: `${dashboardAverage}%`, detail: "Across recorded subjects", icon: BarChart3, tint: "lilac" },
          { label: "Next assessment", value: daysUntil === null ? "—" : `${daysUntil} days`, detail: upcomingLabel, icon: Clock3, tint: "blue" },
        ];
    const firstName = identityName.split(" ")[0];
    const greetingHour = new Date().getHours();
    const greeting = greetingHour < 12 ? "Good morning" : greetingHour < 17 ? "Good afternoon" : "Good evening";
    const latestAnnouncement = data.announcements[0];
    const quickTargets: ViewKey[] = role === "teacher" ? ["attendance", "exams", "students"] : role === "student" ? ["report", "attendance", "announcements"] : ["attendance", "students"];
    const visibleQuickActionCount = role === "admin" ? 3 : quickTargets.filter((view) => canOpenView(view, role, data.permissions)).length;
    const bannerTarget: ViewKey = role === "student" ? "report" : role === "teacher" ? "attendance" : "students";
    const bannerTargetOpen = canOpenView(bannerTarget, role, data.permissions);
    return (
      <div className="dashboard-content">
        <section className="welcome-banner">
          <div className="welcome-text">
            <div className="banner-kicker"><span className="banner-dot" /> TERM 1 · BURAQ PUBLIC SCHOOL</div>
            <h2>{roleIsStudent ? `${greeting}, ${selectedStudent?.firstName ?? firstName}. Here's your school day.` : role === "teacher" ? "Your classroom, at a glance." : `${greeting}, ${firstName}. Here's your day at a glance.`}</h2>
            <p>{roleIsStudent ? "Your attendance, results, and school updates — all in one place." : role === "teacher" ? "Your students, attendance, and learning progress — ready when you are." : "The day-to-day, brought together in one calm place."}</p>
            {bannerTargetOpen && <button className="banner-link" onClick={() => changeView(bannerTarget)}>
              {roleIsStudent ? "View my report card" : role === "teacher" ? "Take today's attendance" : "Open student register"} <ArrowRight size={15} />
            </button>}
          </div>
          <div className="banner-art" aria-hidden="true">
            <span className="banner-orbit orbit-one" /><span className="banner-orbit orbit-two" />
            <span className="banner-art-card"><span className="art-card-top"><i /><i /><i /></span><span className="art-card-line wide" /><span className="art-card-line" /><span className="art-card-chart"><i /><i /><i /><i /><i /><i /></span><span className="art-card-foot"><span /><span /></span></span>
          </div>
          <div className="banner-date"><CalendarDays size={14} /> {shortDate(data.today, { weekday: "long", day: "numeric", month: "long" })}</div>
        </section>

        <section className="stat-grid" aria-label="School summary">
          {stats.map((stat) => <article className="stat-card" key={stat.label}>
            <div className={`stat-icon stat-${stat.tint}`}><stat.icon size={19} strokeWidth={1.8} /></div>
            <div className="stat-copy"><span>{stat.label}</span><strong className={stat.value.length > 12 ? "stat-value-small" : ""}>{stat.value}</strong><small>{stat.detail}</small></div>
            {stat.label === "Today's attendance" && <span className="stat-trend"><ArrowUpRight size={13} /> On track</span>}
          </article>)}
        </section>

        <section className="dashboard-lower-grid">
          <article className="panel attendance-panel">
            <div className="panel-heading"><div><span className="eyebrow">WEEK AT A GLANCE</span><h3>{roleIsStudent ? "Attendance trend" : "Attendance overview"}</h3></div>{canOpenView("attendance", role, data.permissions) && <button className="text-action" onClick={() => changeView("attendance")}>See attendance <ArrowRight size={14} /></button>}</div>
            <div className="chart-summary"><strong>{weeklyRecords.length ? `${roleIsStudent ? dashboardRate : attendanceRate(weeklyRecords)}%` : "—"}</strong><span>average attendance<br />over the last 7 days</span><span className="chart-note"><ArrowUpRight size={14} /> Steady this week</span></div>
            <div className="attendance-chart" role="img" aria-label="Attendance percentage over the last seven days">
              {weeklyAttendance.map((day) => <div className="chart-day" key={day.day}>
                <div className="chart-bar-track"><div className="chart-bar-fill" style={{ height: `${day.total ? Math.max(day.rate, 5) : 4}%` }} /></div>
                <span className="chart-day-label">{day.label}</span>
              </div>)}
            </div>
            <div className="chart-legend"><span><i /> Present or on time</span><span>Last 7 days</span></div>
          </article>

          <article className="panel action-panel">
            <div className="panel-heading"><div><span className="eyebrow">KEEP THINGS MOVING</span><h3>{roleIsStudent ? "Your shortcuts" : "Quick actions"}</h3></div></div>
            <div className="quick-action-list">
              {role === "admin" ? <>
                <button className="quick-action" onClick={() => setModal("student")}><span className="quick-icon quick-mint"><UserRoundPlus size={17} /></span><span><strong>Admit a student</strong><small>Add to your school register</small></span><ChevronRight size={16} /></button>
                <button className="quick-action" onClick={() => changeView("attendance")}><span className="quick-icon quick-peach"><CalendarCheck size={17} /></span><span><strong>Take attendance</strong><small>Mark a class in a few clicks</small></span><ChevronRight size={16} /></button>
                <button className="quick-action" onClick={() => setModal("exam")}><span className="quick-icon quick-blue"><ClipboardCheck size={17} /></span><span><strong>Create an exam</strong><small>Set up an upcoming assessment</small></span><ChevronRight size={16} /></button>
              </> : role === "teacher" ? <>
                {canOpenView("attendance", role, data.permissions) && <button className="quick-action" onClick={() => changeView("attendance")}><span className="quick-icon quick-peach"><CalendarCheck size={17} /></span><span><strong>Mark attendance</strong><small>Check in your class</small></span><ChevronRight size={16} /></button>}
                {canOpenView("exams", role, data.permissions) && <button className="quick-action" onClick={() => changeView("exams")}><span className="quick-icon quick-blue"><ClipboardCheck size={17} /></span><span><strong>Enter subject marks</strong><small>Update your latest assessment</small></span><ChevronRight size={16} /></button>}
                {canOpenView("students", role, data.permissions) && <button className="quick-action" onClick={() => changeView("students")}><span className="quick-icon quick-mint"><GraduationCap size={17} /></span><span><strong>View my students</strong><small>{data.students.length} learners in your class</small></span><ChevronRight size={16} /></button>}
              </> : <>
                {canOpenView("report", role, data.permissions) && <button className="quick-action" onClick={() => changeView("report")}><span className="quick-icon quick-blue"><FileText size={17} /></span><span><strong>Open report card</strong><small>See recent subject results</small></span><ChevronRight size={16} /></button>}
                {canOpenView("attendance", role, data.permissions) && <button className="quick-action" onClick={() => changeView("attendance")}><span className="quick-icon quick-peach"><CalendarCheck size={17} /></span><span><strong>Check attendance</strong><small>Follow this week&apos;s check-ins</small></span><ChevronRight size={16} /></button>}
                {canOpenView("announcements", role, data.permissions) && <button className="quick-action" onClick={() => changeView("announcements")}><span className="quick-icon quick-mint"><Megaphone size={17} /></span><span><strong>School updates</strong><small>{data.announcements.length} recent notices</small></span><ChevronRight size={16} /></button>}
              </>}
              {role !== "admin" && !visibleQuickActionCount && <p className="muted-note">Your office has opened your overview for now. More parts of the school will appear here as access is granted.</p>}
            </div>          </article>
        </section>

        <section className="dashboard-bottom-grid">
          <article className="panel exam-preview">
            <div className="panel-heading"><div><span className="eyebrow">UP NEXT</span><h3>Coming up</h3></div>{canOpenView(role === "student" ? "report" : "exams", role, data.permissions) && <button className="text-action" onClick={() => changeView(role === "student" ? "report" : "exams")}>All exams <ArrowRight size={14} /></button>}</div>
            {nextExam ? <div className="upcoming-card"><div className="exam-date-block"><strong>{shortDate(nextExam.examDate, { day: "numeric" })}</strong><span>{shortDate(nextExam.examDate, { month: "short" })}</span></div><div className="upcoming-info"><strong>{nextExam.title}</strong><span>{nextExam.subject} · {classNameFor(classById.get(nextExam.classId))}</span></div><span className="exam-pill">{daysUntil === 0 ? "Today" : `In ${daysUntil} days`}</span></div> : <p className="muted-note">No upcoming assessments on the calendar.</p>}
            {latestAnnouncement && canOpenView("announcements", role, data.permissions) && <div className="latest-note"><span className="note-icon"><Megaphone size={16} /></span><div><small>LATEST SCHOOL NOTE</small><strong>{latestAnnouncement.title}</strong><span>{shortDate(latestAnnouncement.createdAt.slice(0, 10))}</span></div><button className="icon-button slim" aria-label="View announcements" onClick={() => changeView("announcements")}><ArrowRight size={16} /></button></div>}
          </article>
          <article className="panel class-summary-panel">
            <div className="panel-heading"><div><span className="eyebrow">MY SCHOOL</span><h3>{role === "student" ? "My class" : "Class snapshot"}</h3></div><span className="panel-heading-icon"><Users size={16} /></span></div>
            {role === "student" ? <div className="child-summary"><IconAvatar name={selectedStudent ? `${selectedStudent.firstName} ${selectedStudent.lastName}` : identityName} size="large" /><div><strong>{selectedStudent ? `${selectedStudent.firstName} ${selectedStudent.lastName}` : identityName}</strong><span>{classLabel}</span></div><span className="active-pill">{selectedStudent?.status ?? "Active"}</span></div> : data.classes.map((schoolClass) => {
              const count = data.students.filter((student) => student.classId === schoolClass.id).length;
              const teacher = teacherById.get(schoolClass.teacherId ?? -1);
              return <button className="class-snapshot-row" key={schoolClass.id} onClick={() => { setAttendanceClassId(schoolClass.id); changeView("classes"); }}><span className="class-chip">{schoolClass.section}</span><span><strong>{classNameFor(schoolClass)}</strong><small>{teacher?.name ?? "Teacher not assigned"}</small></span><span className="class-count">{count}<small> students</small></span><ChevronRight size={15} /></button>;
            })}
            {role === "student" && <div className="child-progress"><span><strong>{reportPercent || dashboardAverage}%</strong> subject average</span><span className="progress-track"><i style={{ width: `${Math.max(reportPercent || dashboardAverage, 4)}%` }} /></span><button className="text-action" onClick={() => changeView("report")}>View progress <ArrowRight size={14} /></button></div>}
          </article>
        </section>
      </div>
    );
  };

  const renderStudents = () => (
    <section className="panel data-panel">
      <div className="table-toolbar">
        <div><strong className="table-total">{searchResults.length} students</strong><span className="toolbar-subtitle">A complete, searchable student register.</span></div>
        <div className="toolbar-controls">
          <label className="search-field"><Search size={16} /><input aria-label="Search students" placeholder="Search students..." value={studentSearch} onChange={(event) => { setStudentSearch(event.target.value); setStudentPage(1); }} /><kbd>⌘ K</kbd></label>
          <label className="select-wrap"><span className="sr-only">Filter by class</span><select value={studentFilter} onChange={(event) => { setStudentFilter(event.target.value); setStudentPage(1); }}><option value="all">All classes</option>{data.classes.map((item) => <option key={item.id} value={String(item.id)}>{classNameFor(item)}</option>)}</select><ChevronDown size={14} /></label>
        </div>
      </div>
      {pagedStudents.length ? <div className="table-scroll"><table className="data-table student-table"><thead><tr><th>STUDENT</th><th>ADMISSION NO.</th><th>CLASS</th><th>GUARDIAN</th><th>CONTACT</th><th>STATUS</th>{role === "admin" && <th><span className="sr-only">Actions</span></th>}</tr></thead><tbody>
        {pagedStudents.map((student) => <tr key={student.id}>
          <td><button className="student-name-cell" onClick={() => { setSelectedStudentId(student.id); changeView("studentProfile"); }}><IconAvatar name={`${student.firstName} ${student.lastName}`} /><span><strong>{student.firstName} {student.lastName}</strong><small>{student.gender} · enrolled {shortDate(student.admissionDate)}</small></span></button></td>
          <td><span className="mono-text">{student.admissionNo}</span></td>
          <td><span className="table-class-pill">{classNameFor(classById.get(student.classId ?? -1))}</span></td>
          <td>{student.guardianName}</td><td><span className="contact-text">{student.guardianPhone}</span></td>
          <td><span className="status-pill status-active"><i /> {student.status}</span></td>
          {role === "admin" && <td><div className="row-actions"><button className="icon-button slim" title="Edit student" aria-label={`Edit ${student.firstName}`} onClick={() => { setSelectedStudentId(student.id); setActionError(""); setModal("editStudent"); }}><MoreHorizontal size={17} /></button><button className="icon-button slim danger-icon" title="Remove student" aria-label={`Remove ${student.firstName}`} onClick={() => void removeStudent(student)}><X size={15} /></button></div></td>}
        </tr>)}
      </tbody></table></div> : <EmptyState icon={GraduationCap} title="No students found" text={studentSearch || studentFilter !== "all" ? "Try another search or class filter." : "Your student register is ready for its first admission."} action={role === "admin" ? <button className="button button-primary button-small" onClick={() => setModal("student")}><Plus size={15} /> Add a student</button> : undefined} />}
      <div className="table-footer"><span>Showing <strong>{searchResults.length ? (studentPage - 1) * pageSize + 1 : 0}–{Math.min(studentPage * pageSize, searchResults.length)}</strong> of <strong>{searchResults.length}</strong> students</span><div className="pagination"><button aria-label="Previous page" disabled={studentPage <= 1} onClick={() => setStudentPage((page) => Math.max(1, page - 1))}><ChevronLeft size={16} /></button><span>{studentPage} / {pageCount}</span><button aria-label="Next page" disabled={studentPage >= pageCount} onClick={() => setStudentPage((page) => Math.min(pageCount, page + 1))}><ChevronRight size={16} /></button></div></div>
    </section>
  );

  const renderStudentProfile = () => {
    if (!selectedStudent) return <EmptyState icon={GraduationCap} title="No student selected" text="Choose a student from the register to view their profile." action={<button className="button button-primary" onClick={() => changeView("students")}>Open students</button>} />;
    const studentAttendance = data.attendance.filter((record) => record.studentId === selectedStudent.id && record.attendanceDate >= dateAfter(data.today, -6));
    const studentReportExams = data.exams.filter((exam) => exam.classId === selectedStudent.classId && data.marks.some((mark) => mark.studentId === selectedStudent.id && mark.examId === exam.id));
    return <div className="profile-content">
      <button className="back-link" onClick={() => changeView("students")}><ArrowLeft size={15} /> Back to students</button>
      <section className="panel profile-hero"><div className="profile-main"><IconAvatar name={`${selectedStudent.firstName} ${selectedStudent.lastName}`} size="large" /><div><span className="eyebrow">STUDENT PROFILE</span><h2>{selectedStudent.firstName} {selectedStudent.lastName}</h2><div className="profile-meta"><span>{selectedStudent.admissionNo}</span><span>{classNameFor(classById.get(selectedStudent.classId ?? -1))}</span><span>{selectedStudent.gender}</span></div></div></div><div className="profile-actions"><span className="status-pill status-active"><i /> {selectedStudent.status}</span>{role === "admin" && <button className="button button-secondary button-small" onClick={() => { setActionError(""); setModal("editStudent"); }}>Edit profile</button>}</div></section>
      <div className="profile-stat-grid"><div className="panel mini-stat"><span>Attendance this week</span><strong>{attendanceRate(studentAttendance)}%</strong><small>{studentAttendance.filter((record) => record.status !== "Absent").length} of {studentAttendance.length} days present</small></div><div className="panel mini-stat"><span>Current average</span><strong>{studentReportExams.length ? Math.round(studentReportExams.reduce((sum, exam) => sum + (data.marks.find((mark) => mark.examId === exam.id && mark.studentId === selectedStudent.id)?.score ?? 0), 0) / studentReportExams.length) : 0}%</strong><small>Across recorded subjects</small></div><div className="panel mini-stat"><span>Admission date</span><strong className="profile-date">{shortDate(selectedStudent.admissionDate)}</strong><small>{SCHOOL_NAME}, {SCHOOL_CITY}</small></div></div>
      <div className="profile-detail-grid"><section className="panel detail-panel"><div className="panel-heading"><div><span className="eyebrow">FAMILY CONTACT</span><h3>Guardian details</h3></div><span className="detail-heading-icon"><UserRound size={17} /></span></div><div className="detail-row"><span>Parent / guardian</span><strong>{selectedStudent.guardianName}</strong></div><div className="detail-row"><span>Phone number</span><strong>{selectedStudent.guardianPhone}</strong></div><div className="detail-row"><span>Class teacher</span><strong>{teacherById.get(classById.get(selectedStudent.classId ?? -1)?.teacherId ?? -1)?.name ?? "To be assigned"}</strong></div><div className="detail-row"><span>Student login</span><strong>{selectedStudent.email ?? "Not set"}</strong></div></section><section className="panel detail-panel"><div className="panel-heading"><div><span className="eyebrow">RECENT RESULTS</span><h3>Subject progress</h3></div><button className="text-action" onClick={() => changeView("report")}>Report card <ArrowRight size={14} /></button></div>{studentReportExams.slice(0, 3).map((exam) => { const mark = data.marks.find((item) => item.examId === exam.id && item.studentId === selectedStudent.id); const percentage = mark ? Math.round((mark.score / exam.maxMarks) * 100) : 0; return <div className="subject-progress-row" key={exam.id}><span className="subject-dot" /><span><strong>{exam.subject}</strong><small>{exam.title}</small></span><span className="subject-grade">{mark?.score ?? "—"}<small> / {exam.maxMarks}</small></span><span className={`grade-pill ${percentage >= 40 ? "grade-pass" : "grade-fail"}`}>{mark ? letterGrade(percentage) : "Pending"}</span></div>; })}{!studentReportExams.length && <p className="muted-note">No results recorded yet.</p>}</section></div>
    </div>;
  };

  const renderClasses = () => <div className="class-page-grid">
    {data.classes.length ? data.classes.map((schoolClass) => {
      const members = data.students.filter((student) => student.classId === schoolClass.id);
      const teacher = teacherById.get(schoolClass.teacherId ?? -1);
      const classAttendance = data.attendance.filter((record) => record.classId === schoolClass.id && record.attendanceDate === data.today);
      return <article className="panel class-card" key={schoolClass.id}>
        <div className="class-card-top"><span className="class-symbol"><BookOpen size={19} /></span><span className="class-students"><Users size={14} /> {members.length} students</span>{role === "admin" && <button className="icon-button slim" aria-label={`Remove ${classNameFor(schoolClass)}`} onClick={() => { if (window.confirm(`Remove ${classNameFor(schoolClass)}?`)) void mutate({ action: "deleteClass", id: schoolClass.id }, "Class removed."); }}><MoreHorizontal size={17} /></button>}</div>
        <span className="eyebrow">CLASS & SECTION</span><h3>{schoolClass.grade} <span>— {schoolClass.section}</span></h3>
        <div className="class-teacher-row"><IconAvatar name={teacher?.name ?? "TBA"} size="small" /><span><small>CLASS TEACHER</small><strong>{teacher?.name ?? "Not assigned yet"}</strong></span></div>
        {role === "admin" && <label className="class-assign"><span>Assign class teacher</span><span className="select-wrap"><select aria-label={`Class teacher for ${classNameFor(schoolClass)}`} value={schoolClass.teacherId ?? ""} onChange={(event) => void mutate({ action: "assignTeacher", classId: schoolClass.id, teacherId: event.target.value }, "Class teacher assignment updated.")}><option value="">Unassigned</option>{data.teachers.map((person) => <option value={person.id} key={person.id}>{person.name} · {person.subject}</option>)}</select><ChevronDown size={14} /></span></label>}
        <div className="class-card-bottom"><span><CalendarCheck size={14} /> {classAttendance.filter((record) => record.status !== "Absent").length} / {members.length} present today</span>{canOpenView("students", role, data.permissions) && <button className="text-action" onClick={() => { setAttendanceClassId(schoolClass.id); changeView("students"); }}>View roster <ArrowRight size={14} /></button>}</div>
      </article>;
    }) : <EmptyState icon={BookOpen} title="No classes yet" text="Create your first class and assign a teacher to get started." action={role === "admin" ? <button className="button button-primary" onClick={() => setModal("class")}><Plus size={15} /> Create a class</button> : undefined} />}
    {role === "admin" ? <button className="add-class-card" onClick={() => setModal("class")}><span className="add-class-icon"><Plus size={20} /></span><strong>Create a new class</strong><small>Add a section and assign a class teacher.</small></button> : canOpenView("students", role, data.permissions) && <button className="add-class-card" onClick={() => changeView("students")}><span className="add-class-icon"><Plus size={20} /></span><strong>View your student roster</strong><small>See all students assigned to your classroom.</small></button>}
  </div>;

  const renderTeachers = () => <section className="panel data-panel"><div className="table-toolbar"><div><strong className="table-total">{data.teachers.length} teachers</strong><span className="toolbar-subtitle">Your people, subjects, and classroom assignments.</span></div><div className="staff-summary"><span className="staff-summary-dot" /> All staff profiles active</div></div>{data.teachers.length ? <div className="table-scroll"><table className="data-table"><thead><tr><th>TEACHER</th><th>SUBJECT</th><th>CLASS ASSIGNMENT</th><th>ACCESS</th><th>EMAIL</th><th>PHONE</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{data.teachers.map((teacher) => { const assigned = data.classes.filter((item) => item.teacherId === teacher.id); const held = teacher.permissions ?? DEFAULT_TEACHER_PERMISSIONS; return <tr key={teacher.id}><td><span className="student-name-cell"><IconAvatar name={teacher.name} /><span><strong>{teacher.name}</strong><small>Teaching staff</small></span></span></td><td><span className="subject-tag">{teacher.subject}</span></td><td>{assigned.length ? assigned.map(classNameFor).join(", ") : <span className="muted-inline">Not assigned</span>}</td><td><span className={`access-status${held.length ? " access-status-on" : " access-status-off"}`}>{held.length ? <CheckCircle2 size={14} /> : <X size={14} />} {held.length ? `${held.length} modules` : "No access yet"}</span></td><td>{teacher.email}</td><td>{teacher.phone}</td><td><span className="teacher-row-actions"><button className="text-action" onClick={() => { setEditingTeacherId(teacher.id); setUserRoleFilter("teacher"); setExpandedUserId(teacher.id); changeView("users"); }}>Access <ArrowRight size={13} /></button><button className="icon-button slim danger-icon" aria-label={`Remove ${teacher.name}`} onClick={() => void removeTeacher(teacher)}><X size={15} /></button></span></td></tr>; })}</tbody></table></div> : <EmptyState icon={UserCog} title="No teachers yet" text="Add your first staff profile to start assigning classes." action={<button className="button button-primary" onClick={() => setModal("teacher")}><Plus size={15} /> Add teacher</button>} />}<div className="table-footer"><span>Each teacher signs in with their own school email address.</span><span className="footer-privacy"><ShieldCheck size={14} /> Role-scoped access</span></div></section>;

  const renderAttendance = () => {
    const presentCount = attendanceStudents.filter((student) => attendanceStatuses[student.id] === "Present").length;
    const absentCount = attendanceStudents.filter((student) => attendanceStatuses[student.id] === "Absent").length;
    const lateCount = attendanceStudents.filter((student) => attendanceStatuses[student.id] === "Late").length;
    const isSavedToday = data.attendance.some((record) => record.classId === attendanceClassId && record.attendanceDate === attendanceDate);
    return <div className="attendance-page"><section className="panel attendance-controls"><div className="attendance-control-copy"><span className="eyebrow">DAILY REGISTER</span><h3>Who&apos;s in class today?</h3><p>{role === "student" ? "A clear day-by-day view of your own class check-ins." : "Mark each student present, absent, or late. Your changes are saved securely."}</p></div><div className="attendance-control-fields"><label className="form-field"><span>Class</span><span className="select-wrap"><select value={attendanceClassId || ""} onChange={(event) => setAttendanceClassId(Number(event.target.value))}>{data.classes.map((item) => <option value={item.id} key={item.id}>{classNameFor(item)}</option>)}</select><ChevronDown size={15} /></span></label><label className="form-field"><span>Date</span><input className="form-input" type="date" value={attendanceDate || data.today} max={data.today} onChange={(event) => setAttendanceDate(event.target.value)} /></label></div></section>
      <div className="attendance-summary-row"><div className="attendance-count-card"><span className="count-status count-present"><Check size={14} /></span><span><strong>{presentCount}</strong><small>Present</small></span></div><div className="attendance-count-card"><span className="count-status count-absent"><X size={14} /></span><span><strong>{absentCount}</strong><small>Absent</small></span></div><div className="attendance-count-card"><span className="count-status count-late"><Clock3 size={14} /></span><span><strong>{lateCount}</strong><small>Late</small></span></div><div className="attendance-count-hint"><span>{isSavedToday ? <><CheckCircle2 size={15} /> Last saved attendance is loaded</> : <>Ready for today&apos;s register</>}</span></div></div>
      <section className="panel attendance-register"><div className="table-toolbar attendance-toolbar"><div><strong className="table-total">{classNameFor(chosenAttendanceClass)}</strong><span className="toolbar-subtitle">{attendanceStudents.length} students · {shortDate(attendanceDate || data.today, { weekday: "long", day: "numeric", month: "long" })}</span></div>{role === "student" ? <span className="read-only-chip"><ShieldCheck size={14} /> View only</span> : <button className="button button-secondary button-small" onClick={() => setAllAttendance("Present")}><Check size={15} /> Mark all present</button>}</div>
        {attendanceStudents.length ? <div className="attendance-list">{attendanceStudents.map((student, index) => <div className="attendance-student-row" key={student.id}><span className="attendance-roll">{String(index + 1).padStart(2, "0")}</span><IconAvatar name={`${student.firstName} ${student.lastName}`} /><span className="attendance-student-name"><strong>{student.firstName} {student.lastName}</strong><small>{student.admissionNo}</small></span>{role === "student" ? <span className={`status-pill attendance-read-status ${attendanceStatuses[student.id] === "Absent" ? "status-absent" : attendanceStatuses[student.id] === "Late" ? "status-late" : attendanceStatuses[student.id] === "Present" ? "status-active" : "status-unrecorded"}`}><i /> {attendanceStatuses[student.id] ?? "Not recorded"}</span> : <div className="attendance-toggle" role="group" aria-label={`Attendance for ${student.firstName} ${student.lastName}`}>{(["Present", "Absent", "Late"] as AttendanceStatus[]).map((status) => <button key={status} className={`${attendanceStatuses[student.id] === status ? `attendance-${status.toLowerCase()} is-selected` : ""}`} onClick={() => setAttendanceStatuses((current) => ({ ...current, [student.id]: status }))}>{status}</button>)}</div>}</div>)}</div> : <EmptyState icon={Users} title="No students in this class" text="Add a student to the class roster before taking attendance." />}
        <div className="attendance-footer"><span><ShieldCheck size={14} /> {role === "student" ? "Attendance records are shared by the class teacher." : "Attendance is saved to the student record."}</span>{role === "student" ? <span className="read-only-chip"><ShieldCheck size={14} /> View only</span> : <button className="button button-primary" disabled={!attendanceStudents.length || saving} onClick={() => void saveAttendance()}>{saving ? "Saving…" : "Save attendance"}<ArrowRight size={15} /></button>}</div>
      </section></div>;
  };

  const renderExams = () => <div className="exam-layout"><section className="panel exam-picker"><div className="panel-heading"><div><span className="eyebrow">ASSESSMENT LIST</span><h3>All exams</h3></div><span className="exam-number-pill">{data.exams.length}</span></div>{data.exams.length ? <div className="exam-list">{data.exams.map((exam) => { const filled = data.marks.filter((mark) => mark.examId === exam.id).length; const active = exam.id === selectedExamId; return <button className={`exam-list-item${active ? " exam-list-active" : ""}`} key={exam.id} onClick={() => changeSelectedExam(exam.id)}><span className="exam-list-icon"><ClipboardCheck size={17} /></span><span className="exam-list-copy"><strong>{exam.title}</strong><small>{exam.subject} · {classNameFor(classById.get(exam.classId))}</small><span>{filled} of {data.students.filter((student) => student.classId === exam.classId).length} marks entered</span></span><ChevronRight size={15} /></button>; })}</div> : <EmptyState icon={ClipboardCheck} title="No exams yet" text="Create an exam to start entering student marks." />}{role === "admin" && <button className="button button-secondary full-width" onClick={() => setModal("exam")}><Plus size={15} /> Create an exam</button>}</section>
    <section className="panel marks-entry-panel">{selectedExam ? <><div className="marks-heading"><div><span className="eyebrow">{selectedExam.term.toUpperCase()} · {classNameFor(classById.get(selectedExam.classId))}</span><h2>{selectedExam.subject}</h2><p>{selectedExam.title} <span>·</span> {shortDate(selectedExam.examDate)} <span>·</span> Out of {selectedExam.maxMarks}</p></div><span className="marks-status"><CheckCircle2 size={14} /> {data.marks.filter((mark) => mark.examId === selectedExam.id).length} recorded</span></div><div className="table-scroll"><table className="data-table marks-table"><thead><tr><th>STUDENT</th><th>ADMISSION NO.</th><th>MARKS / {selectedExam.maxMarks}</th><th>GRADE</th></tr></thead><tbody>{data.students.filter((student) => student.classId === selectedExam.classId).map((student) => { const currentScore = Number(scores[student.id]); const hasScore = scores[student.id] !== undefined && scores[student.id] !== "" && Number.isFinite(currentScore); const percentage = hasScore ? Math.round((currentScore / selectedExam.maxMarks) * 100) : 0; return <tr key={student.id}><td><span className="student-name-cell"><IconAvatar name={`${student.firstName} ${student.lastName}`} size="small" /><span><strong>{student.firstName} {student.lastName}</strong></span></span></td><td><span className="mono-text">{student.admissionNo}</span></td><td><label className="score-input-wrap"><input aria-label={`Marks for ${student.firstName} ${student.lastName}`} type="number" min="0" max={selectedExam.maxMarks} value={scores[student.id] ?? ""} placeholder="—" onChange={(event) => setScores((current) => ({ ...current, [student.id]: event.target.value }))} /><span>/ {selectedExam.maxMarks}</span></label></td><td>{hasScore ? <span className={`grade-pill ${percentage >= 40 ? "grade-pass" : "grade-fail"}`}>{letterGrade(percentage)}</span> : <span className="muted-inline">Not entered</span>}</td></tr>; })}</tbody></table></div><div className="marks-footer"><span><ShieldCheck size={14} /> Marks update the student&apos;s report card automatically.</span><button className="button button-primary" disabled={saving || !data.students.some((student) => student.classId === selectedExam.classId)} onClick={() => void saveMarks()}>{saving ? "Saving…" : "Save marks"}<ArrowRight size={15} /></button></div></> : <EmptyState icon={ClipboardCheck} title="Choose an exam" text="Select an exam from the list to enter or review its marks." />}</section></div>;

  const renderReport = () => {
    if (!reportStudent) return <EmptyState icon={FileText} title="No report card to show yet" text="A student profile will appear here as soon as the first admission is added." />;
    const student = reportStudent;
    const gradePct = reportPossible ? Math.round((reportTotal / reportPossible) * 100) : 0;
    const subjectAttendance = data.attendance.filter((record) => record.studentId === student.id && record.attendanceDate >= dateAfter(data.today, -6));
    return <div className="report-page"><div className="report-toolbar"><div><span className="eyebrow">A MOMENT OF PROGRESS</span><p>Every effort adds up. Here&apos;s the latest picture.</p></div><div className="report-actions">{role !== "student" && <label className="select-wrap report-student-select"><select aria-label="Select a student" value={student.id} onChange={(event) => setSelectedStudentId(Number(event.target.value))}>{data.students.map((item) => <option key={item.id} value={item.id}>{item.firstName} {item.lastName} · {classNameFor(classById.get(item.classId ?? -1))}</option>)}</select><ChevronDown size={14} /></label>}<button className="button button-secondary" onClick={() => window.print()}><Printer size={16} /> Print report</button></div></div>
      <article className="report-paper"><div className="report-school-heading"><div className="report-brand"><BrandMark compact /><span><strong>BURAQ PUBLIC SCHOOL</strong><small>LEARNING WITH PURPOSE · EST. 2008</small></span></div><div className="report-label"><span>OFFICIAL ACADEMIC RECORD</span><strong>TERM 1 · 2025—26</strong></div></div><div className="report-title-row"><div><span className="eyebrow">STUDENT PROGRESS REPORT</span><h2>Report card</h2><p>A record of learning, effort, and achievement.</p></div><span className="report-term-badge">TERM 1</span></div>
        <div className="report-student-strip"><div><span>STUDENT NAME</span><strong>{student.firstName} {student.lastName}</strong></div><div><span>ADMISSION NUMBER</span><strong>{student.admissionNo}</strong></div><div><span>CLASS & SECTION</span><strong>{classNameFor(classById.get(student.classId ?? -1))}</strong></div><div><span>ACADEMIC YEAR</span><strong>2025 – 2026</strong></div></div>
        <div className="report-table-wrap"><table className="report-table"><thead><tr><th>SUBJECT</th><th>ASSESSMENT</th><th>MARKS OBTAINED</th><th>MAXIMUM MARKS</th><th>GRADE</th><th>RESULT</th></tr></thead><tbody>{reportExams.map((exam) => { const mark = data.marks.find((item) => item.studentId === student.id && item.examId === exam.id); const percent = mark ? Math.round((mark.score / exam.maxMarks) * 100) : 0; return <tr key={exam.id}><td><strong>{exam.subject}</strong></td><td>{exam.title}</td><td><strong>{mark?.score ?? "—"}</strong></td><td>{exam.maxMarks}</td><td><span className={`grade-pill ${percent >= 40 ? "grade-pass" : "grade-fail"}`}>{mark ? letterGrade(percent) : "—"}</span></td><td><span className={`result-label ${percent >= 40 ? "result-pass" : "result-pending"}`}><i /> {mark ? percent >= 40 ? "Pass" : "Review" : "Pending"}</span></td></tr>; })}{!reportExams.length && <tr><td colSpan={6} className="report-empty">Results will appear here after marks are entered.</td></tr>}</tbody><tfoot><tr><td colSpan={2}><strong>Overall result</strong></td><td><strong>{reportTotal}</strong></td><td><strong>{reportPossible}</strong></td><td><span className={`grade-pill ${gradePct >= 40 ? "grade-pass" : "grade-fail"}`}>{reportPossible ? letterGrade(gradePct) : "—"}</span></td><td><span className={`result-label ${gradePct >= 40 ? "result-pass" : "result-pending"}`}><i /> {reportPossible ? gradePct >= 40 ? "Promoted" : "Review" : "In progress"}</span></td></tr></tfoot></table></div>
        <div className="report-summary-grid"><div className="report-score-card"><span className="eyebrow">TERM AVERAGE</span><strong>{reportPossible ? `${gradePct}%` : "—"}</strong><small>{reportPossible ? `${reportTotal} out of ${reportPossible} marks` : "Waiting for assessment results"}</small><span className="report-progress-track"><i style={{ width: `${Math.max(reportPossible ? gradePct : 0, 0)}%` }} /></span></div><div className="report-score-card attendance-score"><span className="eyebrow">ATTENDANCE · LAST 7 DAYS</span><strong>{attendanceRate(subjectAttendance)}%</strong><small>{subjectAttendance.filter((record) => record.status !== "Absent").length} days present out of {subjectAttendance.length}</small><span className="report-attendance-icon"><CalendarCheck size={22} /></span></div><div className="report-teacher-note"><span className="eyebrow">A NOTE FROM THE SCHOOL</span><p>“Keep asking questions, showing up, and taking pride in the little things. We&apos;re proud of your progress.”</p><span>— {teacherById.get(classById.get(student.classId ?? -1)?.teacherId ?? -1)?.name ?? "Your class teacher"}</span></div></div>
        <div className="report-signatures"><div><span className="signature-line" /><small>Class teacher</small></div><div><span className="signature-line" /><small>Principal</small></div><div className="report-seal"><ShieldCheck size={19} /><span>LEARN WELL<br />DO GOOD</span></div></div><div className="report-footer"><span>{SCHOOL_NAME}, {SCHOOL_CITY} · Student progress report</span><span>Generated {shortDate(data.today)}</span></div></article></div>;
  };

  const renderAnnouncements = () => <div className="announcement-layout">{role !== "student" && <section className="panel announcement-compose"><div className="panel-heading"><div><span className="eyebrow">SAY SOMETHING</span><h3>Share an update</h3></div><span className="panel-heading-icon"><Megaphone size={17} /></span></div><p>{role === "teacher" ? "Post a note for your assigned class." : "Send one clear update to the whole school or a specific class."}</p><button className="button button-primary full-width" onClick={() => { setActionError(""); setModal("announcement"); }}><Plus size={15} /> Write an announcement</button><div className="compose-note"><ShieldCheck size={14} /> {role === "teacher" ? "Visible to your class and their families." : "Posts appear on staff and family dashboards."}</div></section>}
    <section className="announcement-feed">{data.announcements.length ? data.announcements.map((announcement, index) => <article className="panel announcement-card" key={announcement.id}><div className="announcement-card-top"><span className={`announcement-bubble announcement-tone-${index % 3}`}><Megaphone size={17} /></span><div className="announcement-meta"><span>{announcement.audience}</span><small>{shortDate(announcement.createdAt.slice(0, 10), { weekday: "short", day: "numeric", month: "short" })}</small></div>{role === "admin" && <button className="icon-button slim danger-icon" aria-label="Remove announcement" onClick={() => { if (window.confirm("Remove this announcement?")) void mutate({ action: "deleteAnnouncement", id: announcement.id }, "Announcement removed."); }}><X size={15} /></button>}</div><h3>{announcement.title}</h3><p>{announcement.body}</p><div className="announcement-author"><IconAvatar name={announcement.authorName} size="small" /><span>Posted by <strong>{announcement.authorName}</strong></span>{index === 0 && <span className="new-badge">NEW</span>}</div></article>) : <EmptyState icon={Megaphone} title="No announcements yet" text="School updates will show here as soon as they're posted." />}</section>
  </div>;

  const renderUsers = () => {
    const teacherAccess = (teacher: Teacher) => accessDraft.teachers?.[teacher.id] ?? teacher.permissions ?? DEFAULT_TEACHER_PERMISSIONS;
    const toggleIn = (list: string[], key: PermissionKey) => (list.includes(key) ? list.filter((entry) => entry !== key) : PERMISSION_KEYS.filter((entry) => list.includes(entry) || entry === key));
    const draftTeachers = accessDraft.teachers ?? {};
    const studentAccess = accessDraft.student ?? data.rolePermissions.student;

    type PersonRow = { key: string; role: SchoolRole; id: number; name: string; detail: string; email: string; phone: string; meta: string };
    const rows: PersonRow[] = [
      ...data.admins.map((person) => ({ key: `admin-${person.id}`, role: "admin" as const, id: person.id, name: person.name, detail: person.title, email: person.email, phone: person.phone, meta: "Full access" })),
      ...data.teachers.map((person) => ({ key: `teacher-${person.id}`, role: "teacher" as const, id: person.id, name: person.name, detail: person.subject, email: person.email, phone: person.phone, meta: data.classes.filter((item) => item.teacherId === person.id).map(classNameFor).join(", ") || "No class assigned" })),
      ...data.students.map((person) => ({ key: `student-${person.id}`, role: "student" as const, id: person.id, name: `${person.firstName} ${person.lastName}`, detail: classNameFor(classById.get(person.classId ?? -1)), email: person.email ?? "", phone: person.guardianPhone, meta: person.admissionNo })),
    ];
    const roleCounts = { all: rows.length, admin: rows.filter((row) => row.role === "admin").length, teacher: rows.filter((row) => row.role === "teacher").length, student: rows.filter((row) => row.role === "student").length };
    const visibleRows = rows.filter((row) => {
      const matchesRole = userRoleFilter === "all" || row.role === userRoleFilter;
      const needle = userSearch.trim().toLowerCase();
      const matchesSearch = !needle || `${row.name} ${row.email} ${row.detail} ${row.meta}`.toLowerCase().includes(needle);
      return matchesRole && matchesSearch;
    });
    const filters: { key: "all" | SchoolRole; label: string }[] = [
      { key: "all", label: "Everyone" },
      { key: "admin", label: "Office" },
      { key: "teacher", label: "Teachers" },
      { key: "student", label: "Students" },
    ];
    const canRemove = (row: PersonRow) => row.role !== "admin" || row.id !== data.identity.adminId;

    return <div className="users-content">
      <div className="users-quick-add">
        <button className="quick-action" onClick={() => { setActionError(""); setModal("teacher"); }}><span className="quick-icon quick-blue"><UserCog size={17} /></span><span><strong>Add a teacher</strong><small>Starts with no access</small></span><ChevronRight size={16} /></button>
        <button className="quick-action" onClick={() => { setActionError(""); setModal("student"); }}><span className="quick-icon quick-mint"><UserRoundPlus size={17} /></span><span><strong>Admit a student</strong><small>Add to the register</small></span><ChevronRight size={16} /></button>
        <button className="quick-action" onClick={() => { setActionError(""); setModal("admin"); }}><span className="quick-icon quick-peach"><ShieldCheck size={17} /></span><span><strong>Add an office account</strong><small>Full access to the school</small></span><ChevronRight size={16} /></button>
      </div>

      <section className="panel users-toolbar-panel">
        <div className="users-filters" role="group" aria-label="Filter users by role">
          {filters.map((filter) => <button key={filter.key} className={`filter-chip${userRoleFilter === filter.key ? " filter-chip-active" : ""}`} onClick={() => setUserRoleFilter(filter.key)}>{filter.label} <span>{roleCounts[filter.key]}</span></button>)}
        </div>
        <label className="users-search"><Search size={15} /><input value={userSearch} onChange={(event) => setUserSearch(event.target.value)} placeholder="Search a name, email, or class" aria-label="Search users" /></label>
      </section>

      <section className="panel data-panel">
        {visibleRows.length ? <div className="table-scroll"><table className="data-table users-table"><thead><tr><th>USER</th><th>ROLE</th><th>DETAIL</th><th>ACCESS</th><th>CONTACT</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>
          {visibleRows.map((row) => {
            const teacher = row.role === "teacher" ? data.teachers.find((item) => item.id === row.id) : undefined;
            const current = teacher ? teacherAccess(teacher) : [];
            const dirty = row.role === "teacher" && draftTeachers[row.id] !== undefined;
            const expanded = expandedUserId === row.id;
            const statusLabel = row.role === "admin" ? "Full access" : row.role === "student" ? `${studentAccess.length} shared modules` : current.length ? `${current.length} modules` : "No access yet";
            const statusOff = row.role === "teacher" && current.length === 0;
            return <Fragment key={row.key}>
              <tr className={expanded ? "users-row-open" : ""}>
                <td><span className="student-name-cell"><IconAvatar name={row.name} /><span><strong>{row.name}</strong><small>{row.meta}</small></span></span></td>
                <td><span className={`role-tag role-tag-${row.role}`}>{row.role === "admin" ? "Office" : row.role === "teacher" ? "Teacher" : "Student"}</span></td>
                <td>{row.detail || <span className="muted-inline">—</span>}</td>
                <td><span className={`access-status${statusOff ? " access-status-off" : " access-status-on"}`}>{statusOff ? <X size={14} /> : <CheckCircle2 size={14} />} {statusLabel}</span></td>
                <td><span className="user-contact"><span>{row.email || "No email"}</span><small>{row.phone || "—"}</small></span></td>
                <td><span className="user-row-actions">
                  {row.role === "teacher" && <button className="text-action" onClick={() => setExpandedUserId(expanded ? null : row.id)}>{expanded ? "Close" : "Access"}<ChevronRight size={13} /></button>}
                  {row.role === "student" && <button className="text-action" onClick={() => changeView("permissions")}>Shared access<ChevronRight size={13} /></button>}
                  <button className="icon-button slim" aria-label={`Edit ${row.name}`} onClick={() => { setActionError(""); if (row.role === "admin") { setEditingAdminId(row.id); setModal("editAdmin"); } else if (row.role === "teacher") { setEditingTeacherId(row.id); setModal("editTeacher"); } else { setSelectedStudentId(row.id); setModal("editStudent"); } }}><MoreHorizontal size={15} /></button>
                  {canRemove(row) && <button className="icon-button slim danger-icon" aria-label={`Remove ${row.name}`} onClick={() => void removeUser(row)}><X size={15} /></button>}
                </span></td>
              </tr>
              {expanded && teacher && <tr className="users-access-row" key={`${row.key}-access`}><td colSpan={6}>
                <div className="users-access-panel">
                  <div className="users-access-head">
                    <div><span className="eyebrow">ACCESS FOR {row.name.toUpperCase()}</span><p>New teachers start with nothing. Open only the parts {row.name.split(" ")[0]} needs.</p></div>
                    <span className="permission-secure"><ShieldCheck size={14} /> {current.length} of {PERMISSION_KEYS.length} modules</span>
                  </div>
                  <div className="permission-grid">
                    {PERMISSION_MODULES.map((module) => {
                      const locked = officeOnlyModules.includes(module.key);
                      return <PermissionToggle key={module.key} module={module} active={!locked && current.includes(module.key)} locked={locked} onToggle={() => setAccessDraft((previous) => ({ ...previous, teachers: { ...previous.teachers, [row.id]: toggleIn(current, module.key) } }))} />;
                    })}
                  </div>
                  <div className="permission-editor-foot">
                    <button className="text-action" onClick={() => setAccessDraft((previous) => ({ ...previous, teachers: { ...previous.teachers, [row.id]: PERMISSION_KEYS.filter((key) => !officeOnlyModules.includes(key)) } }))}>Grant standard access</button>
                    <button className="text-action" onClick={() => setAccessDraft((previous) => ({ ...previous, teachers: { ...previous.teachers, [row.id]: [] } }))}>Revoke all</button>
                    <span className="permission-editor-actions">
                      {dirty && <button className="text-action" onClick={() => setAccessDraft((previous) => { const next = { ...previous.teachers }; delete next[row.id]; return { ...previous, teachers: next }; })}>Discard</button>}
                      <button className="button button-primary button-small" disabled={saving || !dirty} onClick={async () => {
                        const done = await mutate({ action: "saveTeacherPermissions", teacherId: row.id, modules: current }, current.length ? `Access granted to ${row.name}.` : `Access removed from ${row.name}.`);
                        if (done) setAccessDraft((previous) => { const next = { ...previous.teachers }; delete next[row.id]; return { ...previous, teachers: next }; });
                      }}>{saving ? "Saving…" : dirty ? "Save access" : "Saved"}</button>
                    </span>
                  </div>
                  {teacher.permissions === undefined && !dirty && <p className="permission-legacy-note"><ShieldCheck size={14} /> This profile predates permissions, so it currently holds the standard set. Saving here locks it in.</p>}
                </div>
              </td></tr>}
            </Fragment>;
          })}
        </tbody></table></div> : <EmptyState icon={Users} title="No users match" text="Try another search, or clear the role filter to see everyone in the school." action={<button className="button button-secondary" onClick={() => { setUserSearch(""); setUserRoleFilter("all"); }}>Clear filters</button>} />}
        <div className="table-footer"><span>{visibleRows.length} of {rows.length} people shown.</span><span className="footer-privacy"><ShieldCheck size={14} /> Every sign-in needs an email that matches its role</span></div>
      </section>
    </div>;
  };

  const renderPermissions = () => {
    const studentAccess = accessDraft.student ?? data.rolePermissions.student;
    const dirtyStudent = accessDraft.student !== undefined;
    const toggleIn = (list: string[], key: PermissionKey) => (list.includes(key) ? list.filter((entry) => entry !== key) : PERMISSION_KEYS.filter((entry) => list.includes(entry) || entry === key));

    return <div className="permissions-content">
      <section className="panel permission-editor">
        <div className="permission-title">
          <div><span className="eyebrow">EVERY STUDENT</span><h3>Student portal</h3><p className="permission-title-sub">One setting for the whole school. It applies to every student the moment you save it.</p></div>
          <button className="button button-primary button-small" disabled={saving || !dirtyStudent} onClick={async () => {
            const done = await mutate({ action: "saveStudentPermissions", modules: studentAccess }, "Student portal access updated.");
            if (done) setAccessDraft((current) => ({ ...current, student: undefined }));
          }}>{saving ? "Saving…" : dirtyStudent ? "Save student access" : "Saved"}</button>
        </div>
        <div className="permission-grid">
          {PERMISSION_MODULES.map((module) => {
            const locked = officeOnlyModules.includes(module.key);
            return <PermissionToggle
              key={module.key}
              module={module}
              active={!locked && studentAccess.includes(module.key)}
              locked={locked}
              onToggle={() => setAccessDraft((current) => ({ ...current, student: toggleIn(studentAccess, module.key) }))}
            />;
          })}
        </div>
        <div className="permission-editor-foot">
          <button className="text-action" onClick={() => setAccessDraft((current) => ({ ...current, student: PERMISSION_KEYS.filter((key) => !officeOnlyModules.includes(key)) }))}>Turn everything on</button>
          <button className="text-action" onClick={() => setAccessDraft((current) => ({ ...current, student: [] }))}>Turn everything off</button>
          <span className="muted-inline">{studentAccess.length} of {PERMISSION_KEYS.length} modules on</span>
        </div>
      </section>

      <button className="permission-cta" onClick={() => changeView("users")}><span>Each teacher is opened up on their own.</span><strong>Control users and their access <ArrowRight size={15} /></strong></button>
    </div>;
  };

  const renderRoadmap = () => {
    const upcoming = [
      { icon: BarChart3, title: "Finance reports & ledger book", text: "Clear visibility into school income, expenses, and balances." },
      { icon: Activity, title: "Advanced reports", text: "Flexible insights across attendance, learning, and school operations." },
      { icon: ClipboardCheck, title: "Custom exam sets", text: "Build assessment schedules and subject combinations your way." },
      { icon: BookOpen, title: "Library management", text: "Catalogues, lending, and returns, all in one easy place." },
      { icon: Megaphone, title: "SMS & email notifications", text: "Reach families directly with timely school updates." },
      { icon: CalendarCheck, title: "Payment & fee collection", text: "Make fee schedules, payments, and receipts easier to manage." },
    ];
    return <div className="roadmap-content"><section className="roadmap-banner"><div><span className="eyebrow">BUILT FOR THE NEXT CHAPTER</span><h2>More time for what matters.</h2><p>The prototype focuses on the everyday school journey. These thoughtful extras are planned for the full version.</p></div><div className="roadmap-progress"><span>PROTOTYPE</span><strong>Core workflow</strong><div><i /></div><small>Admissions → Class → Attendance → Results</small></div></section><div className="roadmap-grid">{upcoming.map((item) => <article className="panel roadmap-card" key={item.title}><span className="roadmap-icon"><item.icon size={19} /></span><span className="coming-soon">FULL VERSION</span><h3>{item.title}</h3><p>{item.text}</p></article>)}</div><p className="roadmap-note"><ShieldCheck size={16} /> Nothing here is broken or hidden — these features are intentionally reserved for the full version.</p></div>;
  };

  const renderPage = () => {
    switch (activeView) {
      case "dashboard": return renderDashboard();
      case "students": return renderStudents();
      case "studentProfile": return renderStudentProfile();
      case "classes": return renderClasses();
      case "teachers": return renderTeachers();
      case "attendance": return renderAttendance();
      case "exams": return renderExams();
      case "report": return renderReport();
      case "announcements": return renderAnnouncements();
      case "permissions": return renderPermissions();
      case "users": return renderUsers();
      case "roadmap": return renderRoadmap();
      default: return renderDashboard();
    }
  };

  const renderModal = () => {
    if (!modal) return null;
    const editingStudent = modal === "editStudent" ? data.students.find((item) => item.id === selectedStudentId) : undefined;
    const editingTeacher = modal === "editTeacher" ? data.teachers.find((item) => item.id === editingTeacherId) : undefined;
    const editingAdmin = modal === "editAdmin" ? data.admins.find((item) => item.id === editingAdminId) : undefined;
    const modalContent: Record<Exclude<ModalKey, null>, ReactNode> = {
      student: <ModalFrame title="Welcome a new student" subtitle="A few details are all it takes to start their Buraq story." onClose={() => setModal(null)}><form className="modal-form" onSubmit={(event) => void submitForm(event, "addStudent", "Student admitted to the school register.")}><div className="form-grid two-columns"><FormField label="First name"><input className="form-input" name="firstName" placeholder="e.g. Amina" required maxLength={80} autoFocus /></FormField><FormField label="Last name"><input className="form-input" name="lastName" placeholder="e.g. Ahmed" required maxLength={80} /></FormField></div><div className="form-grid two-columns"><FormField label="Gender"><span className="select-wrap"><select className="form-input" name="gender" defaultValue="Girl" required><option>Girl</option><option>Boy</option></select><ChevronDown size={14} /></span></FormField><FormField label="Class & section"><span className="select-wrap"><select className="form-input" name="classId" defaultValue={data.classes[0]?.id ?? ""} required>{data.classes.map((item) => <option value={item.id} key={item.id}>{classNameFor(item)}</option>)}</select><ChevronDown size={14} /></span></FormField></div><div className="form-divider"><span>FAMILY CONTACT</span></div><FormField label="Parent / guardian name"><input className="form-input" name="guardianName" placeholder="e.g. Ayesha Ahmed" required maxLength={100} /></FormField><FormField label="Contact number"><input className="form-input" name="guardianPhone" placeholder="+92 300 000 0000" required maxLength={40} /></FormField><div className="form-divider"><span>STUDENT LOGIN</span></div><FormField label="Student email address" hint="Used to sign in to the student portal."><input className="form-input" name="email" type="email" placeholder="e.g. amina.ahmed@student.buraq.edu.pk" required maxLength={140} /></FormField>{actionError && <p className="form-error">{actionError}</p>}<div className="modal-actions"><button className="button button-secondary" type="button" onClick={() => setModal(null)}>Cancel</button><button className="button button-primary" disabled={saving}>{saving ? "Adding student…" : "Add student"}<ArrowRight size={15} /></button></div></form></ModalFrame>,
      editStudent: <ModalFrame title="Edit student profile" subtitle="Keep the student register accurate and up to date." onClose={() => setModal(null)}><form className="modal-form" onSubmit={(event) => void submitForm(event, "updateStudent", "Student profile updated.")}><input type="hidden" name="id" value={editingStudent?.id ?? ""} /><div className="form-grid two-columns"><FormField label="First name"><input className="form-input" name="firstName" defaultValue={editingStudent?.firstName} required maxLength={80} /></FormField><FormField label="Last name"><input className="form-input" name="lastName" defaultValue={editingStudent?.lastName} required maxLength={80} /></FormField></div><div className="form-grid two-columns"><FormField label="Class & section"><span className="select-wrap"><select className="form-input" name="classId" defaultValue={editingStudent?.classId ?? data.classes[0]?.id}>{data.classes.map((item) => <option value={item.id} key={item.id}>{classNameFor(item)}</option>)}</select><ChevronDown size={14} /></span></FormField><FormField label="Gender"><input className="form-input" value={editingStudent?.gender ?? ""} readOnly /></FormField></div><div className="form-divider"><span>FAMILY CONTACT</span></div><FormField label="Parent / guardian name"><input className="form-input" name="guardianName" defaultValue={editingStudent?.guardianName} required maxLength={100} /></FormField><FormField label="Contact number"><input className="form-input" name="guardianPhone" defaultValue={editingStudent?.guardianPhone} required maxLength={40} /></FormField><div className="form-divider"><span>STUDENT LOGIN</span></div><FormField label="Student email address" hint="Used to sign in to the student portal."><input className="form-input" name="email" type="email" defaultValue={editingStudent?.email} required maxLength={140} /></FormField>{actionError && <p className="form-error">{actionError}</p>}<div className="modal-actions"><button className="button button-secondary" type="button" onClick={() => setModal(null)}>Cancel</button><button className="button button-primary" disabled={saving}>{saving ? "Saving…" : "Save changes"}<ArrowRight size={15} /></button></div></form></ModalFrame>,
      teacher: <ModalFrame title="Add a teaching colleague" subtitle="Create a staff profile and assign their subject." onClose={() => setModal(null)}><form className="modal-form" onSubmit={(event) => void submitForm(event, "addTeacher", "Teacher added. Open their access from Users.")}><FormField label="Full name"><input className="form-input" name="name" placeholder="e.g. Farah Malik" required maxLength={100} autoFocus /></FormField><div className="form-grid two-columns"><FormField label="Email address"><input className="form-input" name="email" type="email" placeholder="farah@buraq.edu.pk" required /></FormField><FormField label="Phone number"><input className="form-input" name="phone" placeholder="+92 300 000 0000" required /></FormField></div><FormField label="Primary subject"><input className="form-input" name="subject" placeholder="e.g. Urdu" required maxLength={80} /></FormField><div className="compose-note"><ShieldCheck size={14} /> New teachers sign in with no access. Open the parts they need from the Users page once they are added.</div>{actionError && <p className="form-error">{actionError}</p>}<div className="modal-actions"><button className="button button-secondary" type="button" onClick={() => setModal(null)}>Cancel</button><button className="button button-primary" disabled={saving}>{saving ? "Adding teacher…" : "Add teacher"}<ArrowRight size={15} /></button></div></form></ModalFrame>,
      editTeacher: <ModalFrame title="Edit teacher profile" subtitle="Update their details. Access is managed separately on the Users page." onClose={() => setModal(null)}><form className="modal-form" onSubmit={(event) => void submitForm(event, "updateTeacher", "Teacher profile updated.")}><input type="hidden" name="id" value={editingTeacher?.id ?? ""} /><FormField label="Full name"><input className="form-input" name="name" defaultValue={editingTeacher?.name} required maxLength={100} autoFocus /></FormField><div className="form-grid two-columns"><FormField label="Email address"><input className="form-input" name="email" type="email" defaultValue={editingTeacher?.email} required /></FormField><FormField label="Phone number"><input className="form-input" name="phone" defaultValue={editingTeacher?.phone} required /></FormField></div><FormField label="Primary subject"><input className="form-input" name="subject" defaultValue={editingTeacher?.subject} required maxLength={80} /></FormField><div className="compose-note"><ShieldCheck size={14} /> Editing these details never changes what this teacher can open.</div>{actionError && <p className="form-error">{actionError}</p>}<div className="modal-actions"><button className="button button-secondary" type="button" onClick={() => setModal(null)}>Cancel</button><button className="button button-primary" disabled={saving}>{saving ? "Saving…" : "Save changes"}<ArrowRight size={15} /></button></div></form></ModalFrame>,
      admin: <ModalFrame title="Add an office account" subtitle="Office accounts have full access to everything in the school." onClose={() => setModal(null)}><form className="modal-form" onSubmit={(event) => void submitForm(event, "addAdmin", "Office account added.")}><FormField label="Full name"><input className="form-input" name="name" placeholder="e.g. Nadia Ahmed" required maxLength={100} autoFocus /></FormField><FormField label="Job title"><input className="form-input" name="title" placeholder="e.g. Vice principal" required maxLength={100} /></FormField><div className="form-grid two-columns"><FormField label="Email address" hint="Used to sign in as the school office."><input className="form-input" name="email" type="email" placeholder="nadia.ahmed@buraq.edu.pk" required /></FormField><FormField label="Phone number"><input className="form-input" name="phone" placeholder="+92 300 000 0000" required /></FormField></div><div className="compose-note"><ShieldCheck size={14} /> An office account can admit students, edit classes, and change anyone&apos;s access.</div>{actionError && <p className="form-error">{actionError}</p>}<div className="modal-actions"><button className="button button-secondary" type="button" onClick={() => setModal(null)}>Cancel</button><button className="button button-primary" disabled={saving}>{saving ? "Adding…" : "Add office account"}<ArrowRight size={15} /></button></div></form></ModalFrame>,
      editAdmin: <ModalFrame title="Edit office account" subtitle="Keep this person's details accurate." onClose={() => setModal(null)}><form className="modal-form" onSubmit={(event) => void submitForm(event, "updateAdmin", "Office account updated.")}><input type="hidden" name="id" value={editingAdmin?.id ?? ""} /><FormField label="Full name"><input className="form-input" name="name" defaultValue={editingAdmin?.name} required maxLength={100} autoFocus /></FormField><FormField label="Job title"><input className="form-input" name="title" defaultValue={editingAdmin?.title} required maxLength={100} /></FormField><div className="form-grid two-columns"><FormField label="Email address"><input className="form-input" name="email" type="email" defaultValue={editingAdmin?.email} required /></FormField><FormField label="Phone number"><input className="form-input" name="phone" defaultValue={editingAdmin?.phone} required /></FormField></div>{actionError && <p className="form-error">{actionError}</p>}<div className="modal-actions"><button className="button button-secondary" type="button" onClick={() => setModal(null)}>Cancel</button><button className="button button-primary" disabled={saving}>{saving ? "Saving…" : "Save changes"}<ArrowRight size={15} /></button></div></form></ModalFrame>,
      class: <ModalFrame title="Create a class" subtitle="Set up a new grade and section for your school." onClose={() => setModal(null)}><form className="modal-form" onSubmit={(event) => void submitForm(event, "addClass", "New class created.")}><div className="form-grid two-columns"><FormField label="Grade"><input className="form-input" name="grade" placeholder="e.g. Class 6" required maxLength={40} autoFocus /></FormField><FormField label="Section"><input className="form-input" name="section" placeholder="e.g. A" required maxLength={8} /></FormField></div><FormField label="Class teacher"><span className="select-wrap"><select className="form-input" name="teacherId" defaultValue=""><option value="">Assign later</option>{data.teachers.map((person) => <option value={person.id} key={person.id}>{person.name} · {person.subject}</option>)}</select><ChevronDown size={14} /></span><small>You can change this assignment at any time.</small></FormField>{actionError && <p className="form-error">{actionError}</p>}<div className="modal-actions"><button className="button button-secondary" type="button" onClick={() => setModal(null)}>Cancel</button><button className="button button-primary" disabled={saving}>{saving ? "Creating…" : "Create class"}<ArrowRight size={15} /></button></div></form></ModalFrame>,
      exam: <ModalFrame title="Set up an exam" subtitle="Add an assessment now. Marks can be entered when you're ready." onClose={() => setModal(null)}><form className="modal-form" onSubmit={(event) => void submitForm(event, "addExam", "Exam added to the school calendar.")}><FormField label="Exam name"><input className="form-input" name="title" placeholder="e.g. Mid-term assessment" required maxLength={100} autoFocus /></FormField><div className="form-grid two-columns"><FormField label="Subject"><input className="form-input" name="subject" placeholder="e.g. Mathematics" required maxLength={80} /></FormField><FormField label="Term"><input className="form-input" name="term" defaultValue="Term 1" maxLength={40} /></FormField></div><div className="form-grid two-columns"><FormField label="Class"><span className="select-wrap"><select className="form-input" name="classId" defaultValue={data.classes[0]?.id ?? ""} required>{data.classes.map((item) => <option value={item.id} key={item.id}>{classNameFor(item)}</option>)}</select><ChevronDown size={14} /></span></FormField><FormField label="Exam date"><input className="form-input" name="examDate" type="date" defaultValue={data.today} required /></FormField></div><FormField label="Maximum marks"><input className="form-input" name="maxMarks" type="number" min="1" max="1000" defaultValue="100" required /></FormField>{actionError && <p className="form-error">{actionError}</p>}<div className="modal-actions"><button className="button button-secondary" type="button" onClick={() => setModal(null)}>Cancel</button><button className="button button-primary" disabled={saving}>{saving ? "Creating exam…" : "Create exam"}<ArrowRight size={15} /></button></div></form></ModalFrame>,
      announcement: <ModalFrame title="Share a school update" subtitle="Keep your message clear, kind, and easy to find." onClose={() => setModal(null)}><form className="modal-form" onSubmit={(event) => void submitForm(event, "addAnnouncement", "Announcement posted successfully.")}><FormField label="Headline"><input className="form-input" name="title" placeholder="e.g. Friday sports day reminder" required maxLength={120} autoFocus /></FormField><FormField label="Message"><textarea className="form-input form-textarea" name="body" placeholder="Write a short update for your school community…" required maxLength={1000} rows={4} /></FormField><FormField label="Share with"><span className="select-wrap"><select className="form-input" name="classId" defaultValue={role === "teacher" ? data.classes[0]?.id ?? "" : ""}>{role === "admin" && <option value="">Everyone at Buraq</option>}{data.classes.map((item) => <option value={item.id} key={item.id}>{classNameFor(item)}</option>)}</select><ChevronDown size={14} /></span><small>{role === "teacher" ? "Only your assigned class is available." : "Choose a class or share with the whole school."}</small></FormField>{actionError && <p className="form-error">{actionError}</p>}<div className="modal-actions"><button className="button button-secondary" type="button" onClick={() => setModal(null)}>Cancel</button><button className="button button-primary" disabled={saving}>{saving ? "Posting…" : "Post announcement"}<ArrowRight size={15} /></button></div></form></ModalFrame>,
    };
    return modalContent[modal];
  };

  return (
    <div className="app-shell">
      {mobileOpen && <button className="mobile-scrim" aria-label="Close navigation" onClick={() => setMobileOpen(false)} />}
      <aside className={`sidebar${mobileOpen ? " sidebar-open" : ""}`}>
        <div className="sidebar-brand"><BrandMark /><span className="prototype-badge">PRO</span><button className="icon-button sidebar-close" aria-label="Close menu" onClick={() => setMobileOpen(false)}><X size={17} /></button></div>
        <button className="school-switcher" onClick={() => changeView("dashboard")}><span className="school-switcher-mark"><GraduationCap size={17} /></span><span><strong>Buraq Public</strong><small>{SCHOOL_CITY} · Campus 01</small></span><ChevronDown size={15} /></button>
        <nav className="side-nav" aria-label="Main navigation">{grantedNav.reduce<ReactNode[]>((items, item, index) => {
          const previous = grantedNav[index - 1];
          if (!previous || previous.group !== item.group) items.push(<div className="nav-group-label" key={`group-${item.group}`}>{item.group}</div>);
          const Icon = item.icon;
          items.push(<button className={`nav-link${activeView === item.key ? " nav-link-active" : ""}`} key={item.key} onClick={() => changeView(item.key)}><Icon size={17} strokeWidth={1.8} /><span>{item.label}</span>{item.key === "announcements" && data.announcements.length > 0 && <span className="nav-count">{data.announcements.length}</span>}</button>);
          return items;
        }, [])}</nav>
        <button className="sidebar-upgrade" onClick={() => changeView(shortcut.view)}><span><strong>{shortcut.title}</strong><small>{shortcut.sub}</small></span><ArrowRight size={15} /></button>
        <div className="sidebar-profile-wrap">
          <button className="sidebar-profile" aria-haspopup="menu" aria-expanded={accountMenu === "sidebar"} onClick={() => setAccountMenu(accountMenu === "sidebar" ? null : "sidebar")}><IconAvatar name={identityName} /><span><strong>{identityName}</strong><small>{roleLabel}</small></span><ChevronDown size={15} /></button>
          {accountMenu === "sidebar" && <AccountMenu name={identityName} roleLabel={roleLabel} email={data.identity.email} onSignOut={requestSignOut} onClose={() => setAccountMenu(null)} />}
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar"><div className="topbar-left"><button className="mobile-menu-button" aria-label="Open navigation" onClick={() => setMobileOpen(true)}><Menu size={20} /></button><div className="breadcrumbs"><span>Buraq</span><span className="breadcrumb-divider">/</span><strong>{activeLink?.label ?? title}</strong></div><span className={`top-role-badge role-${role}`}><span />{roleLabel}</span></div><div className="topbar-actions"><button className="topbar-date" onClick={() => changeView("dashboard")}><CalendarDays size={15} /> <span>{shortDate(data.today, { weekday: "short", day: "numeric", month: "short" })}</span></button><button className="icon-button top-notification" aria-label="View announcements" onClick={() => changeView("announcements")} disabled={!canOpenView("announcements", role, data.permissions)}><Bell size={18} /><i /></button><span className="topbar-separator" /><div className="topbar-user-wrap"><button className="topbar-user" aria-haspopup="menu" aria-expanded={accountMenu === "topbar"} onClick={() => setAccountMenu(accountMenu === "topbar" ? null : "topbar")}><IconAvatar name={identityName} size="small" /><span><strong>{identityName}</strong><small>{roleLabel}</small></span><ChevronDown size={16} /></button>{accountMenu === "topbar" && <AccountMenu name={identityName} roleLabel={roleLabel} email={data.identity.email} onSignOut={requestSignOut} onClose={() => setAccountMenu(null)} />}</div></div></header>
        <main className="main-content"><div className="page-heading"><div><div className="page-eyebrow">BURAQ <span>/</span> {roleLabel.toUpperCase()}</div><h1>{title}</h1><p>{pageMeta[activeView].description}</p></div><div className="page-heading-actions">{activeView === "dashboard" && <span className="term-status"><span /> Term 1 · 2025–26</span>}{headlineActions[activeView]}</div></div>{actionError && !modal && <div className="inline-alert"><span>{actionError}</span><button onClick={() => setActionError("")} aria-label="Dismiss"><X size={15} /></button></div>}{renderPage()}<footer className="workspace-footer"><span>© 2025 {SCHOOL_NAME} · {SCHOOL_CITY}</span><button onClick={() => changeView(role === "admin" ? "permissions" : shortcut.view)}><CircleHelp size={14} /> {role === "admin" ? "Need a hand?" : "Need help?"}</button></footer></main>
      </div>
      {renderModal()}
      {confirmingSignOut && <ConfirmSignOut onCancel={() => setConfirmingSignOut(false)} onConfirm={() => void logout()} />}
      {toast && <div className="toast-message" role="status"><CheckCircle2 size={17} /> {toast}<button aria-label="Dismiss message" onClick={() => setToast("")}><X size={14} /></button></div>}
    </div>
  );
}

const loginSlides = [
  { src: "/slide-1.png", label: "Slide 1" },
  { src: "/slide-2.png", label: "Slide 2" },
  { src: "/slide-3.png", label: "Slide 3" },
  { src: "/slide-4.png", label: "Slide 4" },
];

function LoginScreen({ selectedRole, onSelect, onSubmit, saving, error }: { selectedRole: SchoolRole; onSelect: (role: SchoolRole) => void; onSubmit: (email: string, password: string) => void; saving: boolean; error: string }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [slide, setSlide] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [dragX, setDragX] = useState(0);
  const [paused, setPaused] = useState(false);
  const dragStart = useRef(0);
  const selected = roleCategories.find((item) => item.role === selectedRole) ?? roleCategories[0];
  const SelectedIcon = selected.icon;
  const ready = email.trim().length > 3 && password.length > 0;
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!ready || saving) return;
    void onSubmit(email, password);
  };

  useEffect(() => {
    if (paused || dragging) return;
    const timer = window.setInterval(() => setSlide((current) => (current + 1) % loginSlides.length), 5200);
    return () => window.clearInterval(timer);
  }, [paused, dragging]);

  const goTo = (next: number) => setSlide((next + loginSlides.length) % loginSlides.length);
  const step = (direction: 1 | -1) => goTo(slide + direction);

  const startDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    dragStart.current = event.clientX;
    setDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const moveDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    setDragX(event.clientX - dragStart.current);
  };

  const endDrag = () => {
    if (!dragging) return;
    setDragging(false);
    if (dragX <= -60) step(1);
    else if (dragX >= 60) step(-1);
    setDragX(0);
  };

  return <main className="login-screen"><section className="login-card"><div className="login-visual"><div className="login-visual-image-wrapper"><Image className="login-hero-media" src="/slide-1.png" alt={`${SCHOOL_NAME}, ${SCHOOL_CITY} learning portal`} width={1200} height={1600} priority /></div></div>
    <div className="login-panel"><div className="login-panel-top"><span className="login-welcome">WELCOME TO {SCHOOL_NAME.toUpperCase()} · {SCHOOL_CITY.toUpperCase()}</span><span className="secure-label"><ShieldCheck size={14} /> Secure sign-in</span></div><div className="login-heading"><span className="login-symbol"><SelectedIcon size={20} /></span><div><h2>Sign in to your school</h2><p>Choose your category, then enter your school email and password.</p></div></div><div className="role-selector" role="radiogroup" aria-label="Choose your category">{roleCategories.map((option) => { const Icon = option.icon; const active = selectedRole === option.role; return <button key={option.role} type="button" role="radio" aria-checked={active} className={`role-choice${active ? " role-choice-active" : ""}`} onClick={() => onSelect(option.role)}><span className="role-choice-icon"><Icon size={18} /></span><span className="role-choice-copy"><strong>{option.label}</strong><small>{option.title}</small></span><span className="role-radio"><i /></span></button>; })}</div><form className="login-credentials" onSubmit={submit}><label className="form-field"><span>School email address</span><input className="form-input" type="email" name="email" autoComplete="username" placeholder={selected.role === "student" ? "you@student.buraq.edu.pk" : "you@buraq.edu.pk"} value={email} onChange={(event) => setEmail(event.target.value)} required /></label><label className="form-field"><span>Password</span><input className="form-input" type="password" name="password" autoComplete="current-password" placeholder="Enter your password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>{error && <div className="login-error">{error}</div>}<button className="button button-primary login-submit" type="submit" disabled={saving || !ready}>{saving ? "Signing you in…" : `Sign in as ${selected.label}`}<ArrowRight size={17} /></button></form><div className="login-separator"><span /> <small>BUILT FOR THE WHOLE SCHOOL</small> <span /></div><div className="login-feature-row"><span><GraduationCap size={15} /> Student journey</span><span><CalendarCheck size={15} /> Daily attendance</span><span><FileText size={15} /> Clear results</span></div><div className="login-legal"><span>© 2025 {SCHOOL_NAME} · {SCHOOL_CITY}</span><span>Thoughtfully made for educators</span></div></div></section></main>;
}
function LoadingScreen({ error, onRetry, onLogout }: { error?: string; onRetry?: () => void; onLogout?: () => void }) {
  return <main className="loading-screen"><div className="loading-card"><BrandMark /><span className="loading-spinner" /><h2>{error ? "We're having a little trouble." : "Opening your school day…"}</h2><p>{error ?? "Bringing your classrooms, students, and updates together."}</p>{error && <div className="loading-actions"><button className="button button-primary" onClick={onRetry}>Try again <ArrowRight size={15} /></button><button className="button button-secondary" onClick={onLogout}>Sign out</button></div>}</div></main>;
}
