import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type DocumentData,
} from "firebase/firestore";
import { getFirestoreDatabase } from "@/lib/firebase/server";
import {
  COLLECTIONS,
  attendanceDocId,
  marksDocId,
  nextRecordId,
  type AdminRecord,
  type AnnouncementRecord,
  type AttendanceRecord,
  type ClassRecord,
  type ExamRecord,
  type MarkRecord,
  type RolePermissionRecord,
  type StudentRecord,
  type TeacherRecord,
} from "./schema";

const db = () => getFirestoreDatabase();

/**
 * Reads a whole collection. The schema's integer id always wins over the stored
 * field so a hand-edited document can never break the id references.
 */
export async function listAll<T extends { id: number }>(collectionName: string): Promise<T[]> {
  const snapshot = await getDocs(collection(db(), collectionName));
  return snapshot.docs.map((entry) => toRecord<T>(entry.id, entry.data()));
}

export async function findOne<T extends { id: number }>(
  collectionName: string,
  field: string,
  value: unknown,
): Promise<T | null> {
  const snapshot = await getDocs(query(collection(db(), collectionName), where(field, "==", value), limit(1)));
  const entry = snapshot.docs[0];
  return entry ? toRecord<T>(entry.id, entry.data()) : null;
}

function toRecord<T extends { id: number }>(documentId: string, data: DocumentData | undefined): T {
  const numericId = Number(documentId);
  const id = Number.isInteger(numericId) ? numericId : Number(data?.id);
  return { ...(data as T), id } as T;
}

export async function isEmpty(collectionName: string): Promise<boolean> {
  const snapshot = await getDocs(query(collection(db(), collectionName), limit(1)));
  return snapshot.empty;
}

export async function createRecord<T extends { id: number }>(
  collectionName: string,
  data: Omit<T, "id"> & { id?: number },
  documentId?: string,
): Promise<T> {
  const id = data.id ?? nextRecordId();
  const payload = { ...data, id };
  await setDoc(doc(db(), collectionName, documentId ?? String(id)), payload);
  return payload as T;
}

export async function updateRecord(collectionName: string, id: number, data: Record<string, unknown>): Promise<void> {
  await updateDoc(doc(db(), collectionName, String(id)), data);
}

export async function deleteRecord(collectionName: string, id: number): Promise<void> {
  await deleteDoc(doc(db(), collectionName, String(id)));
}

/** Reads a document that is addressed by a readable id instead of a row number. */
export async function getDocument<T>(collectionName: string, documentId: string): Promise<T | null> {
  const snapshot = await getDoc(doc(db(), collectionName, documentId));
  return snapshot.exists() ? (snapshot.data() as T) : null;
}

/** Writes (or replaces) a document addressed by a readable id. */
export async function setDocument(collectionName: string, documentId: string, data: Record<string, unknown>): Promise<void> {
  await setDoc(doc(db(), collectionName, documentId), data);
}

/** Upserts the rows the SQL schema protected with a composite unique index. */
export async function upsertByDocumentId(
  collectionName: string,
  documentId: string,
  data: Record<string, unknown>,
): Promise<void> {
  const reference = doc(db(), collectionName, documentId);
  const snapshot = await getDoc(reference);
  // An existing row keeps the id it was created with, so list ordering stays stable.
  if (snapshot.exists()) {
    await updateDoc(reference, data);
    return;
  }
  await setDoc(reference, { id: nextRecordId(), ...data });
}

export async function deleteWhere(collectionName: string, field: string, value: unknown): Promise<number> {
  const snapshot = await getDocs(query(collection(db(), collectionName), where(field, "==", value)));
  if (snapshot.empty) return 0;
  const batch = writeBatch(db());
  snapshot.docs.forEach((entry) => batch.delete(entry.ref));
  await batch.commit();
  return snapshot.size;
}

export async function seedCollection(
  collectionName: string,
  rows: Record<string, unknown>[],
  documentIdFor: (row: Record<string, unknown>) => string,
): Promise<void> {
  const chunks: Record<string, unknown>[][] = [];
  rows.forEach((row) => {
    const last = chunks[chunks.length - 1];
    if (last && last.length < 400) last.push(row);
    else chunks.push([row]);
  });
  for (const chunk of chunks) {
    const batch = writeBatch(db());
    chunk.forEach((row) => batch.set(doc(db(), collectionName, documentIdFor(row)), row));
    await batch.commit();
  }
}

export {
  COLLECTIONS,
  attendanceDocId,
  marksDocId,
  nextRecordId,
  type AdminRecord,
  type AnnouncementRecord,
  type AttendanceRecord,
  type ClassRecord,
  type ExamRecord,
  type MarkRecord,
  type RolePermissionRecord,
  type StudentRecord,
  type TeacherRecord,
};
