import { getDocs, limit, query, collection } from "firebase/firestore";
import { getFirestoreDatabase, serverProjectId } from "@/lib/firebase/server";
import { COLLECTIONS } from "@/lib/firestore/repository";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await getDocs(query(collection(getFirestoreDatabase(), COLLECTIONS.students), limit(1)));
    return Response.json({ ok: true, project: serverProjectId, database: "firestore" });
  } catch (error) {
    console.error("Firestore health check failed", error);
    return Response.json(
      { ok: false, project: serverProjectId, database: "firestore", error: "Firestore is not reachable." },
      { status: 500 },
    );
  }
}
