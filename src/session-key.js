import { randomBytes } from 'node:crypto';

// Keep signing keys private and persistent: never regenerate them on each restart.
export async function sessionKey(db) {
  await db.q("INSERT INTO settings(key,value) VALUES('session_signing_key',$1) ON CONFLICT(key) DO NOTHING",[randomBytes(64).toString('hex')]);
  const { rows }=await db.q("SELECT value FROM settings WHERE key='session_signing_key'");
  const key=rows[0]?.value;
  if(typeof key!=='string'||!/^[a-f0-9]{128}$/.test(key)) throw new Error('Nieprawidłowy zapis klucza sesji w bazie danych.');
  return key;
}
