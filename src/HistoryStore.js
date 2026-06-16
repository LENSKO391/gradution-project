import { auth, db } from './FirebaseAuth';
import { collection, addDoc, getDocs, deleteDoc, query, where, serverTimestamp, doc } from "firebase/firestore";

// No Firebase Storage import — Storage requires a paid plan.
// History records are saved as metadata-only logs in Firestore.
// The file itself is still downloaded to the user's device as normal;
// it just won't be re-downloadable from the history panel.

export class HistoryStore {
    static normalizeDate(value) {
        if (!value) return new Date().toISOString();
        if (typeof value === 'string') return value;
        if (value?.toDate && typeof value.toDate === 'function') return value.toDate().toISOString();
        return new Date().toISOString();
    }

    // Wait for Firebase Auth to finish hydrating before reading currentUser.
    // auth.currentUser is null during the async initialization window on page
    // load — reading it directly caused addRecord to silently fail every time.
    static waitForAuth(timeoutMs = 5000) {
        return new Promise((resolve, reject) => {
            if (auth?.currentUser) return resolve(auth.currentUser);

            const timer = setTimeout(() => {
                unsubscribe();
                reject(new Error("Auth timeout — please sign in again."));
            }, timeoutMs);

            const unsubscribe = auth.onAuthStateChanged((user) => {
                clearTimeout(timer);
                unsubscribe();
                if (user) resolve(user);
                else reject(new Error("You must be signed in to save history."));
            });
        });
    }

    static async addRecord(email, record) {
        if (!db) throw new Error("Firebase DB not initialized.");

        let currentUser;
        try {
            currentUser = await HistoryStore.waitForAuth();
        } catch (authErr) {
            console.warn("HistoryStore.addRecord: skipped (not authenticated):", authErr.message);
            return null;
        }

        const normalizedEmail = (currentUser.email || email || '').trim().toLowerCase();

        // Save metadata only — no file bytes in Firestore, no Storage upload
        try {
            const docData = {
                userId: currentUser.uid,
                email: currentUser.email || email,
                emailLower: normalizedEmail,
                file: record.file,
                action: record.action,
                mimeType: record.mimeType || 'application/octet-stream',
                date: serverTimestamp(),
                downloadURL: null,   // no Storage — file was already downloaded to device
                storagePath: null
            };

            const docRef = await addDoc(collection(db, "historyRecords"), docData);
            console.log("History record saved:", docRef.id);
            return docRef.id;
        } catch (err) {
            console.error("HistoryStore: Firestore write failed:", err.message);
            throw err;
        }
    }

    static async getRecords() {
        if (!db) return [];

        let currentUser;
        try {
            currentUser = await HistoryStore.waitForAuth();
        } catch {
            return [];
        }

        try {
            const q = query(
                collection(db, "historyRecords"),
                where("userId", "==", currentUser.uid)
            );
            const snapshot = await getDocs(q);
            return snapshot.docs
                .map(docSnap => {
                    const data = docSnap.data();
                    return { id: docSnap.id, ...data, date: HistoryStore.normalizeDate(data.date) };
                })
                .sort((a, b) => new Date(b.date) - new Date(a.date));
        } catch (err) {
            console.error("HistoryStore.getRecords failed:", err.message);
            return [];
        }
    }

    static async deleteRecord(id, storagePath = null) {
        if (!db) return;
        // storagePath is always null now but kept for API compatibility with HistoryPanel
        await deleteDoc(doc(db, "historyRecords", id));
    }

    static async deleteAllRecords() {
        if (!db) return;

        let currentUser;
        try { currentUser = await HistoryStore.waitForAuth(); }
        catch { return; }

        const snapshot = await getDocs(
            query(collection(db, "historyRecords"), where("userId", "==", currentUser.uid))
        );
        for (const docSnap of snapshot.docs) {
            await deleteDoc(doc(db, "historyRecords", docSnap.id));
        }
    }
}