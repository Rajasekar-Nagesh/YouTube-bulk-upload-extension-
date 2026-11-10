import * as XLSX from 'xlsx';
import mammoth from 'mammoth';
import type { VideoJob } from './types';

const norm = (s: string) => s.toLowerCase().replace(/[ _-]/g, '').trim();

function excelDate(value: unknown): Date | null {
  if (value instanceof Date && !isNaN(value.getTime())) return value;
  if (typeof value === 'number') {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) return new Date(parsed.y, parsed.m - 1, parsed.d, parsed.H || 0, parsed.M || 0, parsed.S || 0);
  }
  if (typeof value === 'string' && value.trim()) {
    const s = value.trim();
    const match = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
    if (match) return new Date(Number(match[3]), Number(match[2]) - 1, Number(match[1]));
    const date = new Date(s);
    if (!isNaN(date.getTime())) return date;
  }
  return null;
}

function excelTime(value: unknown): { h: number; m: number; s: number } | null {
  if (typeof value === 'number') {
    const minutes = Math.round(value * 24 * 60);
    return { h: Math.floor(minutes / 60) % 24, m: minutes % 60, s: 0 };
  }
  if (value instanceof Date) return { h: value.getHours(), m: value.getMinutes(), s: value.getSeconds() };
  if (typeof value === 'string') {
    const match = value.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i);
    if (match) {
      let h = Number(match[1]);
      const ap = match[4]?.toUpperCase();
      if (ap === 'PM' && h < 12) h += 12;
      if (ap === 'AM' && h === 12) h = 0;
      return { h, m: Number(match[2]), s: Number(match[3] || 0) };
    }
  }
  return null;
}

export async function parseSchedule(file: File): Promise<Array<{ filename: string; publishAt: string }>> {
  const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) throw new Error('Excel file has no worksheet.');
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '', raw: true });
  if (!rows.length) throw new Error('Excel worksheet has no data rows.');

  return rows.map((row, index) => {
    const entries = Object.entries(row);
    const get = (names: string[]) => entries.find(([key]) => names.includes(norm(key)))?.[1];
    const filename = String(get(['filename', 'videofilename', 'video', 'videoname', 'file']) || '').trim();
    const date = excelDate(get(['uploaddate', 'publishdate', 'scheduleddate', 'date']));
    const time = excelTime(get(['uploadtime', 'publishtime', 'scheduledtime', 'time']));
    if (!filename) throw new Error(`Row ${index + 2}: missing Video Filename.`);
    if (!date) throw new Error(`Row ${index + 2}: invalid/missing Upload Date for ${filename}.`);
    if (!time) throw new Error(`Row ${index + 2}: invalid/missing Upload Time for ${filename}.`);

    const local = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}T${String(time.h).padStart(2, '0')}:${String(time.m).padStart(2, '0')}:${String(time.s).padStart(2, '0')}+05:30`;
    const parsed = new Date(local);
    if (isNaN(parsed.getTime())) throw new Error(`Row ${index + 2}: invalid schedule for ${filename}.`);
    if (parsed.getTime() <= Date.now()) throw new Error(`Row ${index + 2}: scheduled time for ${filename} must be in the future.`);
    return { filename, publishAt: parsed.toISOString() };
  });
}

export async function parseMetadata(file: File): Promise<Map<string, { title: string; description: string; tags: string[] }>> {
  const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
  const text = result.value.replace(/\r/g, '');
  const blocks = text.split(/(?=^\s*(?:VIDEO|FILE|FILENAME)\s*:\s*)/im).map(x => x.trim()).filter(Boolean);
  const map = new Map<string, { title: string; description: string; tags: string[] }>();

  for (const block of blocks) {
    const head = block.match(/^(?:VIDEO|FILE|FILENAME)\s*:\s*(.+)$/im);
    if (!head) continue;
    const filename = head[1].trim();
    const field = (name: string) => {
      const re = new RegExp(`(?:^|\\n)\\s*${name}\\s*:\\s*([\\s\\S]*?)(?=\\n\\s*(?:TITLE|DESCRIPTION|TAGS|VIDEO|FILE|FILENAME)\\s*:|$)`, 'i');
      return (block.match(re)?.[1] || '').trim();
    };
    const title = field('TITLE');
    const description = field('DESCRIPTION');
        const tags = field('TAGS').split(/[,\n]/).map(tag => tag.trim()).filter(Boolean);
    if (!title) throw new Error(`Word document: missing TITLE for ${filename}.`);
    map.set(filename.toLowerCase(), { title, description, tags });
  }

  if (!map.size) throw new Error('Could not find metadata blocks. Use VIDEO: filename.mp4 followed by TITLE:, DESCRIPTION: and TAGS:.');
  return map;
}

export async function buildJobs(
  schedule: Awaited<ReturnType<typeof parseSchedule>>,
  metadata: Map<string, { title: string; description: string; tags: string[] }>,
  dir: FileSystemDirectoryHandle
): Promise<VideoJob[]> {
  const files = new Map<string, File>();
  for await (const [name, entry] of dir.entries()) {
    if (entry.kind === 'file') files.set(name.toLowerCase(), await (entry as FileSystemFileHandle).getFile());
  }

  const seen = new Set<string>();
  return schedule.map(row => {
    const key = row.filename.toLowerCase();
    if (seen.has(key)) throw new Error(`Duplicate filename in Excel: ${row.filename}`);
    seen.add(key);
    const meta = metadata.get(key);
    if (!meta) throw new Error(`Word document has no metadata block for ${row.filename}.`);
    if (!files.has(key)) throw new Error(`File not found in selected folder: ${row.filename}`);
    return {
      key: crypto.randomUUID(),
      filename: files.get(key)!.name,
      title: meta.title,
      description: meta.description,
      tags: meta.tags,
      publishAt: row.publishAt,
      status: 'queued',
      progress: 0
    };
  });
}