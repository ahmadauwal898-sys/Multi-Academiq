import { doc, setDoc, getDoc, collection, getDocs, writeBatch, WriteBatch } from 'firebase/firestore';
import { signInAnonymously } from 'firebase/auth';
import { db, auth, handleFirestoreError, OperationType } from '../firebase';
import firebaseConfig from '../../firebase-applet-config.json';

// Ensure Firebase client session is authenticated
async function ensureFirebaseAuth(): Promise<void> {
  if (!auth.currentUser) {
    try {
      await signInAnonymously(auth);
    } catch (e) {
      console.warn('Firebase Auth note:', e);
    }
  }
}

function parseTimestampMs(ts: any): number {
  if (!ts) return 0;
  if (typeof ts === 'number') return Number.isFinite(ts) ? ts : 0;
  const s = String(ts).trim();
  if (!s) return 0;
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s)
    ? s.replace(' ', 'T') + 'Z'
    : s;
  const ms = Date.parse(normalized);
  return Number.isFinite(ms) ? ms : 0;
}

function scoreCompositeKey(sc: any): string {
  return `${sc.student_id}::${sc.subject_id}::${sc.term_id}::${sc.session_id}`;
}

function termResultCompositeKey(tr: any): string {
  return `${tr.student_id}::${tr.term_id}::${tr.session_id}`;
}

async function commitInBatches(ops: Array<(batch: WriteBatch) => void>): Promise<void> {
  const CHUNK_SIZE = 400;
  for (let i = 0; i < ops.length; i += CHUNK_SIZE) {
    const batch = writeBatch(db);
    const slice = ops.slice(i, i + CHUNK_SIZE);
    for (const op of slice) {
      op(batch);
    }
    await batch.commit();
  }
}

export interface CloudSyncResult {
  success: boolean;
  timestamp: string;
  projectId: string;
  databaseId: string;
  totalSynced: {
    students: number;
    teachers?: number;
    parents?: number;
    attendance?: number;
    fees?: number;
    scores: number;
    results: number;
    subjects: number;
  };
  error?: string;
}

export interface CloudSyncStatus {
  lastSyncTimestamp: string | null;
  totalRecords: number;
  isSynced: boolean;
  projectId: string;
  databaseId: string;
}

/**
 * Synchronizes complete school academic state, students, assessment scores,
 * and compiled report card results directly into Firebase Firestore using
 * batched atomic writes and newest-timestamp guards so old data never
 * overwrites newer edited/approved marks.
 */
export async function syncSchoolToFirestore(
  schoolId: string,
  token: string
): Promise<CloudSyncResult> {
  await ensureFirebaseAuth();
  const path = `schools/${schoolId}`;
  try {
    // 1. Fetch current school state from server (server export-data reconciles Firestore first)
    const res = await fetch(`/api/school/export-data?school_id=${encodeURIComponent(schoolId)}`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    if (!res.ok) {
      throw new Error(`Failed to load school export from server: ${res.statusText}`);
    }

    const json = await res.json();
    const data = json.data;
    if (!data || !data.school) {
      throw new Error('School data is empty or corrupted.');
    }

    const now = new Date().toISOString();

    // 2. Fetch existing remote scores, term_results, and latest backup to guarantee
    // strictly newer remote marks are never overwritten by stale local snapshots
    const [remoteScoresSnap, remoteResultsSnap, remoteBackupSnap] = await Promise.all([
      getDocs(collection(db, 'schools', schoolId, 'scores')).catch(() => null),
      getDocs(collection(db, 'schools', schoolId, 'term_results')).catch(() => null),
      getDoc(doc(db, 'schools', schoolId, 'cloud_sync', 'latest')).catch(() => null)
    ]);

    let remoteSnapshotData: any = null;
    if (remoteBackupSnap?.exists() && remoteBackupSnap.data()?.payload_json) {
      try {
        remoteSnapshotData = JSON.parse(remoteBackupSnap.data()!.payload_json);
      } catch (_) {}
    }

    const mergedScoresByKey = new Map<string, any>();
    const considerScore = (sc: any, preferEqual = false) => {
      if (!sc?.student_id || !sc?.subject_id || !sc?.term_id || !sc?.session_id) return;
      const key = scoreCompositeKey(sc);
      const prev = mergedScoresByKey.get(key);
      const incomingTs = parseTimestampMs(sc.updated_at || sc.created_at);
      const prevTs = prev ? parseTimestampMs(prev.updated_at || prev.created_at) : -1;
      if (!prev || (preferEqual ? incomingTs >= prevTs : incomingTs > prevTs)) {
        mergedScoresByKey.set(key, sc);
      }
    };

    if (Array.isArray(remoteSnapshotData?.student_scores)) {
      for (const sc of remoteSnapshotData.student_scores) considerScore(sc, false);
    }
    if (remoteScoresSnap) {
      remoteScoresSnap.docs.forEach((d) => considerScore({ id: d.id, ...d.data() }, true));
    }
    if (Array.isArray(data.student_scores)) {
      // Local export has already reconciled from Firestore; let local win only if >= remote timestamp
      for (const sc of data.student_scores) considerScore(sc, true);
    }

    const mergedResultsByKey = new Map<string, any>();
    const considerResult = (tr: any, preferEqual = false) => {
      if (!tr?.student_id || !tr?.term_id || !tr?.session_id) return;
      const key = termResultCompositeKey(tr);
      const prev = mergedResultsByKey.get(key);
      const incomingTs = parseTimestampMs(tr.updated_at || tr.created_at);
      const prevTs = prev ? parseTimestampMs(prev.updated_at || prev.created_at) : -1;
      if (!prev || (preferEqual ? incomingTs >= prevTs : incomingTs > prevTs)) {
        mergedResultsByKey.set(key, tr);
      }
    };

    if (Array.isArray(remoteSnapshotData?.term_results)) {
      for (const tr of remoteSnapshotData.term_results) considerResult(tr, false);
    }
    if (remoteResultsSnap) {
      remoteResultsSnap.docs.forEach((d) => considerResult({ id: d.id, ...d.data() }, true));
    }
    if (Array.isArray(data.term_results)) {
      for (const tr of data.term_results) considerResult(tr, true);
    }

    const mergedScores = Array.from(mergedScoresByKey.values());
    const mergedResults = Array.from(mergedResultsByKey.values());

    // Keep merged newest scores & results inside cloud_sync/latest payload_json
    data.student_scores = mergedScores;
    data.term_results = mergedResults;

    // 3. Persist main School Document in Firestore
    await setDoc(doc(db, 'schools', schoolId), {
      id: data.school.id,
      name: data.school.name,
      slug: data.school.slug,
      email: data.school.email,
      phone: data.school.phone || '',
      address: data.school.address || '',
      country: data.school.country || 'Nigeria',
      state: data.school.state || '',
      school_level: data.school.school_level,
      logo_url: data.school.logo_url || '',
      result_template_json: data.school.result_template_json || '',
      status: data.school.status || 'approved',
      updated_at: now
    }, { merge: true });

    // 4. Queue batched writes for all subcollections
    const batchOps: Array<(batch: WriteBatch) => void> = [];

    let studentCount = 0;
    const parentMap = new Map<string, any>();
    if (Array.isArray(data.students)) {
      for (const st of data.students) {
        if (!st?.id) continue;
        batchOps.push((batch) => {
          batch.set(doc(db, 'schools', schoolId, 'students', st.id), {
            id: st.id,
            school_id: schoolId,
            admission_number: st.admission_number,
            full_name: st.full_name,
            gender: st.gender || 'Male',
            class_id: st.class_id,
            arm_id: st.arm_id || '',
            parent_name: st.parent_name || '',
            parent_phone: st.parent_phone || '',
            parent_email: st.parent_email || '',
            enrollment_status: st.enrollment_status || 'active',
            created_at: st.created_at || now
          }, { merge: true });
        });
        studentCount++;

        if (st.parent_name && st.parent_name.trim()) {
          const parentKey = (st.parent_phone || st.parent_email || st.parent_name).trim().toLowerCase();
          if (!parentMap.has(parentKey)) {
            parentMap.set(parentKey, {
              id: 'parent_' + Math.abs(st.parent_name.split('').reduce((a: number, b: string) => ((a << 5) - a) + b.charCodeAt(0), 0)),
              school_id: schoolId,
              full_name: st.parent_name,
              phone: st.parent_phone || '',
              email: st.parent_email || '',
              relationship: 'Parent / Guardian',
              student_ids: st.id,
              created_at: now
            });
          }
        }
      }
    }

    let teacherCount = 0;
    if (Array.isArray(data.users)) {
      for (const u of data.users) {
        if (!u?.id) continue;
        batchOps.push((batch) => {
          batch.set(doc(db, 'schools', schoolId, 'users', u.id), {
            id: u.id,
            school_id: schoolId,
            email: u.email,
            full_name: u.full_name,
            role: u.role,
            phone: u.phone || '',
            status: 'active',
            created_at: u.created_at || now
          }, { merge: true });
        });

        if (u.role === 'teacher') {
          batchOps.push((batch) => {
            batch.set(doc(db, 'schools', schoolId, 'teachers', u.id), {
              id: u.id,
              school_id: schoolId,
              user_id: u.id,
              full_name: u.full_name,
              email: u.email,
              phone: u.phone || '',
              specialization: 'General Education',
              assigned_classes: '',
              created_at: u.created_at || now
            }, { merge: true });
          });
          teacherCount++;
        }
      }
    }

    let parentCount = 0;
    for (const p of parentMap.values()) {
      batchOps.push((batch) => {
        batch.set(doc(db, 'schools', schoolId, 'parents', p.id), p, { merge: true });
      });
      parentCount++;
    }

    let attendanceCount = 0;
    if (Array.isArray(data.attendance_records)) {
      for (const att of data.attendance_records) {
        if (!att?.id) continue;
        batchOps.push((batch) => {
          batch.set(doc(db, 'schools', schoolId, 'attendance', att.id), {
            id: att.id,
            school_id: schoolId,
            student_id: att.student_id,
            class_id: att.class_id,
            date: att.date,
            status: att.status || 'present',
            remarks: att.remarks || '',
            recorded_by_user_id: att.recorded_by_user_id || 'system',
            created_at: att.created_at || now
          }, { merge: true });
        });
        attendanceCount++;
      }
    }

    let feeCount = 0;
    if (Array.isArray(data.fee_payments)) {
      for (const fee of data.fee_payments) {
        if (!fee?.id) continue;
        batchOps.push((batch) => {
          batch.set(doc(db, 'schools', schoolId, 'fees', fee.id), {
            id: fee.id,
            school_id: schoolId,
            student_id: fee.student_id,
            category_id: fee.category_id || '',
            amount_paid: Number(fee.amount_paid) || 0,
            payment_method: fee.payment_method || 'Cash',
            receipt_number: fee.receipt_number || ('REC-' + fee.id.slice(-6)),
            recorded_by_user_id: fee.recorded_by_user_id || 'bursar',
            payment_date: fee.payment_date || now,
            notes: fee.notes || ''
          }, { merge: true });
        });
        feeCount++;
      }
    }

    // Persist Student Examination & Assessment Scores preserving each score's real updated_at
    let scoreCount = 0;
    for (const sc of mergedScores) {
      if (!sc?.id) continue;
      batchOps.push((batch) => {
        batch.set(doc(db, 'schools', schoolId, 'scores', sc.id), {
          id: sc.id,
          school_id: schoolId,
          student_id: sc.student_id,
          subject_id: sc.subject_id,
          class_id: sc.class_id || '',
          term_id: sc.term_id,
          session_id: sc.session_id,
          ca1: Number(sc.ca1) || 0,
          ca2: Number(sc.ca2) || 0,
          ca3: Number(sc.ca3) || 0,
          exam: Number(sc.exam) || 0,
          total: Number(sc.total) || 0,
          grade: sc.grade || 'F',
          remark: sc.remark || 'Fail',
          teacher_comment: sc.teacher_comment || '',
          status: sc.status || 'draft',
          entered_by_user_id: sc.entered_by_user_id || 'system',
          updated_at: sc.updated_at || sc.created_at || now
        }, { merge: true });
      });
      scoreCount++;
    }

    // Persist Term Results preserving each result's real updated_at & comments
    let resultCount = 0;
    for (const tr of mergedResults) {
      if (!tr?.id) continue;
      batchOps.push((batch) => {
        batch.set(doc(db, 'schools', schoolId, 'term_results', tr.id), {
          id: tr.id,
          school_id: schoolId,
          student_id: tr.student_id,
          class_id: tr.class_id || '',
          term_id: tr.term_id,
          session_id: tr.session_id,
          total_score: Number(tr.total_score) || 0,
          average_score: Number(tr.average_score) || 0,
          position: tr.position != null ? Number(tr.position) : null,
          class_size: Number(tr.class_size) || 0,
          status: tr.status || 'draft',
          teacher_comment: tr.teacher_comment || '',
          principal_comment: tr.principal_comment || '',
          snapshot_json: tr.snapshot_json || '',
          updated_at: tr.updated_at || tr.created_at || now
        }, { merge: true });
      });
      resultCount++;
    }

    if (batchOps.length > 0) {
      await commitInBatches(batchOps);
    }

    // 5. Persist Cloud Backup Snapshot with merged newest scores/results
    const totalRecords = studentCount + teacherCount + parentCount + attendanceCount + feeCount + scoreCount + resultCount + 1;
    await setDoc(doc(db, 'schools', schoolId, 'cloud_sync', 'latest'), {
      id: 'latest',
      school_id: schoolId,
      backup_timestamp: now,
      total_records: totalRecords,
      version: '1.0.0',
      payload_json: JSON.stringify(data)
    });

    return {
      success: true,
      timestamp: now,
      projectId: firebaseConfig.projectId,
      databaseId: firebaseConfig.firestoreDatabaseId,
      totalSynced: {
        students: studentCount,
        teachers: teacherCount,
        parents: parentCount,
        attendance: attendanceCount,
        fees: feeCount,
        scores: scoreCount,
        results: resultCount,
        subjects: Array.isArray(data.subjects) ? data.subjects.length : 0
      }
    };
  } catch (err: unknown) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

/**
 * Checks Firestore to see if this school has an active cloud backup
 */
export async function getFirebaseSyncStatus(schoolId: string): Promise<CloudSyncStatus> {
  await ensureFirebaseAuth();
  const path = `schools/${schoolId}/cloud_sync/latest`;
  try {
    const snap = await getDoc(doc(db, 'schools', schoolId, 'cloud_sync', 'latest'));
    if (snap.exists()) {
      const data = snap.data();
      return {
        lastSyncTimestamp: data.backup_timestamp || null,
        totalRecords: Number(data.total_records) || 0,
        isSynced: true,
        projectId: firebaseConfig.projectId,
        databaseId: firebaseConfig.firestoreDatabaseId
      };
    }
    return {
      lastSyncTimestamp: null,
      totalRecords: 0,
      isSynced: false,
      projectId: firebaseConfig.projectId,
      databaseId: firebaseConfig.firestoreDatabaseId
    };
  } catch (err) {
    return {
      lastSyncTimestamp: null,
      totalRecords: 0,
      isSynced: false,
      projectId: firebaseConfig.projectId,
      databaseId: firebaseConfig.firestoreDatabaseId
    };
  }
}

/**
 * Restores school state from Firestore Cloud snapshot + latest scores/term_results subcollections
 */
export async function restoreSchoolFromFirestore(
  schoolId: string,
  token: string
): Promise<{ success: boolean; message: string }> {
  await ensureFirebaseAuth();
  const path = `schools/${schoolId}/cloud_sync/latest`;
  try {
    const [snap, scoresSnap, resultsSnap] = await Promise.all([
      getDoc(doc(db, 'schools', schoolId, 'cloud_sync', 'latest')),
      getDocs(collection(db, 'schools', schoolId, 'scores')).catch(() => null),
      getDocs(collection(db, 'schools', schoolId, 'term_results')).catch(() => null)
    ]);

    let parsedData: any = null;
    let backupTime = new Date().toISOString();

    if (snap.exists() && snap.data()?.payload_json) {
      const cloudData = snap.data();
      parsedData = JSON.parse(cloudData.payload_json);
      backupTime = cloudData.backup_timestamp || backupTime;
    } else {
      const rootSnap = await getDoc(doc(db, 'schools', schoolId));
      if (!rootSnap.exists()) {
        throw new Error('No school record found in Firestore for ID ' + schoolId);
      }
      const schoolData = rootSnap.data();
      parsedData = {
        school: {
          id: schoolId,
          name: schoolData.name || 'Recovered School',
          slug: schoolData.slug || ((schoolData.name || 'school').toLowerCase().replace(/[^a-z0-9]/g, '-') + '-' + schoolId.slice(-4)),
          email: schoolData.email || '',
          phone: schoolData.phone || '',
          address: schoolData.address || '',
          country: schoolData.country || 'Nigeria',
          state: schoolData.state || 'Lagos',
          school_level: schoolData.school_level || 'Senior Secondary',
          status: 'approved',
          is_payment_verified: 1
        },
        users: [
          {
            id: 'usr_rec_' + schoolId.slice(4),
            school_id: schoolId,
            email: schoolData.email,
            full_name: (schoolData.name || 'School') + ' Administrator',
            role: 'school_admin'
          }
        ],
        classes: [],
        students: []
      };
    }

    // Merge individual scores subcollection into restored payload so newest marks always win
    const scoreMap = new Map<string, any>();
    if (Array.isArray(parsedData.student_scores)) {
      for (const sc of parsedData.student_scores) {
        if (sc?.student_id && sc?.subject_id) scoreMap.set(scoreCompositeKey(sc), sc);
      }
    }
    if (scoresSnap) {
      scoresSnap.docs.forEach((d) => {
        const sc: any = { id: d.id, ...(d.data() as Record<string, any>) };
        if (!sc.student_id || !sc.subject_id) return;
        const k = scoreCompositeKey(sc);
        const prev = scoreMap.get(k);
        if (!prev || parseTimestampMs(sc.updated_at) >= parseTimestampMs(prev.updated_at || prev.created_at)) {
          scoreMap.set(k, sc);
        }
      });
    }
    parsedData.student_scores = Array.from(scoreMap.values());

    // Merge individual term_results subcollection into restored payload
    const resultMap = new Map<string, any>();
    if (Array.isArray(parsedData.term_results)) {
      for (const tr of parsedData.term_results) {
        if (tr?.student_id && tr?.term_id) resultMap.set(termResultCompositeKey(tr), tr);
      }
    }
    if (resultsSnap) {
      resultsSnap.docs.forEach((d) => {
        const tr: any = { id: d.id, ...(d.data() as Record<string, any>) };
        if (!tr.student_id || !tr.term_id) return;
        const k = termResultCompositeKey(tr);
        const prev = resultMap.get(k);
        if (!prev || parseTimestampMs(tr.updated_at) >= parseTimestampMs(prev.updated_at || prev.created_at)) {
          resultMap.set(k, tr);
        }
      });
    }
    parsedData.term_results = Array.from(resultMap.values());

    const res = await fetch('/api/school/import-cloud-data', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ schoolData: parsedData })
    });

    const json = await res.json();
    if (!res.ok) {
      throw new Error(json.error || 'Failed to restore cloud data to server.');
    }

    return {
      success: true,
      message: `Restored successfully from Firestore backup dated ${new Date(backupTime).toLocaleString()}.`
    };
  } catch (err: unknown) {
    handleFirestoreError(err, OperationType.GET, path);
  }
}

/**
 * Fetches all school documents present in Cloud Firestore
 */
export async function fetchAllFirestoreSchools(): Promise<any[]> {
  await ensureFirebaseAuth();
  const path = 'schools';
  try {
    const snapshot = await getDocs(collection(db, 'schools'));
    return snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (err) {
    console.warn('Could not query Firestore schools:', err);
    return [];
  }
}
