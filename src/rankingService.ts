export interface RankRecord {
  key: string;
  name: string;
  timeMs: number;
  timeText: string;
  timestamp: number;
}

interface FirebaseSnapshot {
  val: () => Record<string, Partial<RankRecord>> | null;
}

interface FirebaseRef {
  push: () => { key: string | null; set: (data: Omit<RankRecord, 'key'>) => Promise<void> };
  on: (
    eventType: 'value',
    callback: (snapshot: FirebaseSnapshot) => void,
    cancelCallback?: (error: unknown) => void
  ) => void;
  off: (eventType: 'value', callback?: (snapshot: FirebaseSnapshot) => void) => void;
}

interface FirebaseDatabase {
  ref: (path: string) => FirebaseRef;
}

interface FirebaseCompat {
  apps: unknown[];
  initializeApp: (config: Record<string, string>) => unknown;
  database: () => FirebaseDatabase;
}

const LOCAL_RANK_KEY = 'cyberdef_local_rankings_v1';

const firebaseConfig = {
  apiKey: 'AIzaSyCaGuOpomcpg3Fi_D3PlLOZMy8Iq4cYznU',
  authDomain: 'cyber-def-efb13.firebaseapp.com',
  databaseURL: 'https://cyber-def-efb13-default-rtdb.firebaseio.com',
  projectId: 'cyber-def-efb13',
  storageBucket: 'cyber-def-efb13.firebasestorage.app',
  messagingSenderId: '270815136981',
  appId: '1:270815136981:web:a63c93cfacc6008bbca65c',
  measurementId: 'G-PBZHZ62BK6',
};

let dbInstance: FirebaseDatabase | null = null;
let initAttempted = false;

function getFirebaseDb(): FirebaseDatabase | null {
  if (initAttempted) return dbInstance;
  initAttempted = true;
  try {
    const fb = (window as unknown as { firebase?: FirebaseCompat }).firebase;
    if (!fb || typeof fb.initializeApp !== 'function' || typeof fb.database !== 'function') {
      return null;
    }
    if (!fb.apps || fb.apps.length === 0) {
      fb.initializeApp(firebaseConfig);
    }
    dbInstance = fb.database();
    return dbInstance;
  } catch {
    dbInstance = null;
    return null;
  }
}

export function formatPlayTime(ms: number): string {
  const safeMs = Math.max(0, Math.round(ms));
  const totalSeconds = Math.floor(safeMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const centis = Math.floor((safeMs % 1000) / 10);

  const mm = String(minutes).padStart(2, '0');
  const ss = String(seconds).padStart(2, '0');
  const cc = String(centis).padStart(2, '0');

  if (hours > 0) {
    return `${String(hours).padStart(2, '0')}:${mm}:${ss}.${cc}`;
  }
  return `${mm}:${ss}.${cc}`;
}

function loadLocalRankings(): RankRecord[] {
  try {
    const raw = localStorage.getItem(LOCAL_RANK_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (item): item is RankRecord =>
          Boolean(item) &&
          typeof item.name === 'string' &&
          typeof item.timeMs === 'number' &&
          Number.isFinite(item.timeMs)
      )
      .sort((a, b) => a.timeMs - b.timeMs || a.timestamp - b.timestamp);
  } catch {
    return [];
  }
}

function saveLocalRanking(record: RankRecord): void {
  try {
    const list = loadLocalRankings().filter((r) => r.key !== record.key);
    list.push(record);
    list.sort((a, b) => a.timeMs - b.timeMs || a.timestamp - b.timestamp);
    localStorage.setItem(LOCAL_RANK_KEY, JSON.stringify(list));
  } catch {
    // ignore localStorage quota errors
  }
}

export async function submitClearRecord(
  playerName: string,
  timeMs: number
): Promise<{ key: string; source: 'firebase' | 'local'; record: RankRecord }> {
  const cleanName = playerName.trim().slice(0, 20) || 'ANONYMOUS';
  const safeMs = Math.max(100, Math.round(timeMs));
  const payload = {
    name: cleanName,
    timeMs: safeMs,
    timeText: formatPlayTime(safeMs),
    timestamp: Date.now(),
  };

  const db = getFirebaseDb();
  if (db) {
    try {
      const newRef = db.ref('rankings').push();
      const key = newRef.key || `fb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const record: RankRecord = { key, ...payload };

      // Write to Firebase Realtime Database (with timeout safeguard so UI never hangs offline)
      await Promise.race([
        newRef.set(payload),
        new Promise<never>((_, reject) =>
          window.setTimeout(() => reject(new Error('Firebase write timeout')), 4500)
        ),
      ]);
      saveLocalRanking(record);
      return { key, source: 'firebase', record };
    } catch {
      // Network error or offline -> seamless localStorage fallback
    }
  }

  const localKey = `local_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const localRecord: RankRecord = { key: localKey, ...payload };
  saveLocalRanking(localRecord);
  return { key: localKey, source: 'local', record: localRecord };
}

export function subscribeGlobalRankings(
  onUpdate: (records: RankRecord[], source: 'firebase' | 'local') => void
): () => void {
  const db = getFirebaseDb();
  if (!db) {
    onUpdate(loadLocalRankings(), 'local');
    return () => {};
  }

  let settled = false;
  let unsubscribed = false;
  const ref = db.ref('rankings');

  const fallbackTimer = window.setTimeout(() => {
    if (!settled && !unsubscribed) {
      onUpdate(loadLocalRankings(), 'local');
    }
  }, 4500);

  const handleSnapshot = (snapshot: FirebaseSnapshot) => {
    if (unsubscribed) return;
    settled = true;
    window.clearTimeout(fallbackTimer);

    const raw = snapshot.val();
    const list: RankRecord[] = [];
    if (raw && typeof raw === 'object') {
      Object.entries(raw).forEach(([key, val]) => {
        if (!val || typeof val !== 'object') return;
        const timeMs = Number(val.timeMs);
        if (!Number.isFinite(timeMs) || timeMs < 0) return;
        const name = typeof val.name === 'string' && val.name.trim() ? val.name.trim() : 'PLAYER';
        const timeText = typeof val.timeText === 'string' && val.timeText ? val.timeText : formatPlayTime(timeMs);
        const timestamp = typeof val.timestamp === 'number' ? val.timestamp : 0;
        list.push({ key, name, timeMs, timeText, timestamp });
      });
    }
    list.sort((a, b) => a.timeMs - b.timeMs || a.timestamp - b.timestamp);
    onUpdate(list, 'firebase');
  };

  const handleError = () => {
    if (unsubscribed) return;
    settled = true;
    window.clearTimeout(fallbackTimer);
    onUpdate(loadLocalRankings(), 'local');
  };

  try {
    ref.on('value', handleSnapshot, handleError);
  } catch {
    handleError();
    return () => {};
  }

  return () => {
    unsubscribed = true;
    window.clearTimeout(fallbackTimer);
    try {
      ref.off('value', handleSnapshot);
    } catch {
      // ignore cleanup error
    }
  };
}
