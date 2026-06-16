import { storage, db } from './FirebaseAuth';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import {
  collection, addDoc, getDocs, deleteDoc,
  doc, query, where, orderBy
} from 'firebase/firestore';

// ── Upload an encrypted file to Firebase Storage and record it in Firestore ──
export async function uploadEncryptedFile(userEmail, blob, fileName, action, mimeType) {
  if (!storage || !db) throw new Error('Firebase not initialized.');

  // 1. Upload the file blob to Firebase Storage under the user's folder
  const storageRef = ref(storage, `encrypted_files/${userEmail}/${Date.now()}_${fileName}`);
  const snapshot = await uploadBytes(storageRef, blob, { contentType: mimeType });
  const downloadURL = await getDownloadURL(snapshot.ref);

  // 2. Add a record to Firestore (no raw file data stored in the DB)
  const docRef = await addDoc(collection(db, 'historyRecords'), {
    email: userEmail,
    file: fileName,
    action,
    mimeType,
    storagePath: snapshot.ref.fullPath,
    downloadURL,
    date: new Date().toISOString(),
  });

  return { id: docRef.id, downloadURL };
}

// ── Fetch all history records for a user from Firestore ──
export async function getHistoryRecords(userEmail) {
  if (!db) return [];
  const q = query(
    collection(db, 'historyRecords'),
    where('email', '==', userEmail),
    orderBy('date', 'desc')
  );
  const snapshot = await getDocs(q);
  return snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
}

// ── Delete a single history record (and its file from Storage) ──
export async function deleteHistoryRecord(record) {
  if (!db) return;
  // Delete Firestore document
  await deleteDoc(doc(db, 'historyRecords', record.id));
  // Delete the file from Storage if a path exists
  if (storage && record.storagePath) {
    try {
      await deleteObject(ref(storage, record.storagePath));
    } catch (e) {
      console.warn('Could not delete file from storage:', e.message);
    }
  }
}

// ── Delete all history records for a user ──
export async function deleteAllHistoryRecords(userEmail) {
  if (!db) return;
  const q = query(collection(db, 'historyRecords'), where('email', '==', userEmail));
  const snapshot = await getDocs(q);
  for (const docSnap of snapshot.docs) {
    const data = docSnap.data();
    await deleteDoc(doc(db, 'historyRecords', docSnap.id));
    if (storage && data.storagePath) {
      try {
        await deleteObject(ref(storage, data.storagePath));
      } catch (e) {
        console.warn('Could not delete file from storage:', e.message);
      }
    }
  }
}
