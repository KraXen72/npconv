// Utility helpers

// HTML escape function to prevent XSS
export function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
    '/': '&#x2F;'
  };
  return text.replace(/[&<>"'/]/g, (char) => map[char]);
}

export function getTimestamp(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
}

export function downloadFile(blob: Blob, filename: string, timestamp: string | null = null) {
  let finalFilename = filename;
  if (timestamp) {
    if (filename.endsWith('.zip')) {
      finalFilename = filename.replace('.zip', `-${timestamp}.zip`);
    } else if (filename.endsWith('.json')) {
      finalFilename = filename.replace('.json', `-${timestamp}.json`);
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = finalFilename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
// Extract YouTube video id from common URL forms (v=, youtu.be, /shorts/, /embed/)
export function extractVideoIdFromUrl(url: unknown): string {
	if (!url) return "";
	const s = String(url);
	let m = s.match(/[?&]v=([^&]+)/);
	if (m && m[1]) return m[1];
	m = s.match(/youtu\.be\/([^?&/]+)/);
	if (m && m[1]) return m[1];
	m = s.match(/\/shorts\/([^?&/]+)/);
	if (m && m[1]) return m[1];
	m = s.match(/\/embed\/([^?&/]+)/);
	if (m && m[1]) return m[1];
	return "";
}// Clamp numeric values to JS safe integer range so Kotlin Long deserialization
// won't fail when LibreTube parses the exported JSON.
const MAX_SAFE_NUM = Number.MAX_SAFE_INTEGER; // 9007199254740991

export function clampToSafeInt(value: unknown): number {
	const n = Number(value || 0);
	if (!Number.isFinite(n) || isNaN(n)) return 0;
	if (n > MAX_SAFE_NUM) return MAX_SAFE_NUM;
	if (n < -MAX_SAFE_NUM) return -MAX_SAFE_NUM;
	return Math.trunc(n);
}
// Robust upload date formatter. Handles seconds, milliseconds, YYYYMMDD, and ISO-like strings.
export function formatUploadDate(raw: unknown): string {
	if (!raw && raw !== 0) return "1970-01-01";
	const s = String(raw).trim();
	// Already ISO-like date string
	if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.split('T')[0];
	const n = Number(s);
	if (!Number.isFinite(n)) return "1970-01-01";
	const abs = Math.abs(n);
	// YYYYMMDD (e.g. 20230424)
	if (abs >= 10000000 && abs <= 99999999) {
		const str = String(Math.trunc(n));
		const y = str.slice(0, 4);
		const m = str.slice(4, 6);
		const d = str.slice(6, 8);
		return `${y}-${m}-${d}`;
	}
	// Milliseconds timestamp (13+ digits)
	if (abs > 1e12) return new Date(n).toISOString().split('T')[0];
	// Seconds timestamp (10 digits)
	if (abs >= 1e9) return new Date(n * 1000).toISOString().split('T')[0];
	// Fallback: treat as milliseconds
	return new Date(n).toISOString().split('T')[0];
}
// Parse various access date fields into milliseconds since epoch.
export function parseAccessDateToMs(raw: unknown): number {
	if (raw === undefined || raw === null) return 0;
	if (typeof raw === 'number') {
		// If already milliseconds (large), keep; if seconds, convert to ms
		return raw > 1e12 ? Math.floor(raw) : Math.floor(raw * 1000);
	}
	const s = String(raw).trim();
	if (!s) return 0;
	const parsed = Date.parse(s);
	if (!isNaN(parsed)) return parsed;
	// fallback numeric parse
	const n = Number(s);
	if (!Number.isFinite(n)) return 0;
	return n > 1e12 ? Math.floor(n) : Math.floor(n * 1000);
}

