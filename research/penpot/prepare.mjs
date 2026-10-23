// Creates an untracked local Penpot server key without printing it.
import { randomBytes } from 'node:crypto';
import { writeFile, access } from 'node:fs/promises';
const destination = new URL('.env', import.meta.url);
try {
  await access(destination);
  console.log('Existing Penpot local configuration preserved.');
} catch {
  await writeFile(destination, `PENPOT_SECRET_KEY=${randomBytes(64).toString('base64url')}\n`, { flag: 'wx', mode: 0o600 });
  console.log('Created local Penpot configuration.');
}
