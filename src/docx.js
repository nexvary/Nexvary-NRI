import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../scripts/inspect-docx.py', import.meta.url));
let active = 0;

export async function inspectDocx(bytes) {
  if (active >= 2) return { status: 429, error: 'uploadBusy' };
  active++;
  try {
    return await new Promise((resolve) => {
      const worker = execFile(process.env.NRI_DOCX_PYTHON || 'python3', ['-I', script], {
        timeout: 5000, maxBuffer: 256 * 1024, windowsHide: true,
      }, (error, stdout) => {
        if (!error) resolve({ text: stdout });
        else if (error.code === 2) resolve({ status: 422, error: 'invalidDocx' });
        else resolve({ status: 503, error: 'docxUnavailable' });
      });
      worker.stdin.on('error', () => {});
      worker.stdin.end(bytes);
    });
  } finally {
    active--;
  }
}
