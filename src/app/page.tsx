import { cookies } from "next/headers";
import SchoolApp from "@/components/school-app";
import { SESSION_COOKIE, decodeSession } from "@/lib/session";
import { isSchoolRole, type SchoolRole } from "@/lib/roles";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const session = decodeSession((await cookies()).get(SESSION_COOKIE)?.value);
  const initialRole: SchoolRole | null = isSchoolRole(session?.role) ? session.role : null;

  return <SchoolApp initialRole={initialRole} />;
}
