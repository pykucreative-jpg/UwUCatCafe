import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { sessionKey } from '../src/session-key.js';
import { environment } from '../src/config.js';

test('klucz powstaje automatycznie i pozostaje ten sam po kolejnych startach',async t=>{
  const pg=new PGlite();t.after(()=>pg.close());
  await pg.exec('CREATE TABLE settings(key text PRIMARY KEY,value text NOT NULL)');
  const db={q:(sql,args)=>pg.query(sql,args)};
  const [first,second]=await Promise.all([sessionKey(db),sessionKey(db)]);
  assert.ok(/^[a-f0-9]{128}$/.test(first));
  assert.ok(first===second);
  assert.ok(await sessionKey(db)===first);
  assert.equal((await pg.query('SELECT count(*)::int AS count FROM settings')).rows[0].count,1);
});
test('konfiguracja nie wymaga ręcznego klucza sesji i ignoruje starą zmienną',()=>{
  const values={DISCORD_TOKEN:'test',DISCORD_CLIENT_ID:'111111111111111111',DISCORD_CLIENT_SECRET:'test',DISCORD_GUILD_ID:'222222222222222222',DATABASE_URL:'postgresql://localhost/test',PUBLIC_URL:'https://example.com',NODE_ENV:'production'};
  assert.doesNotThrow(()=>environment(values));
  assert.equal(environment({...values,SESSION_SECRET:'short'}).sessionSecret,undefined);
});
test('uszkodzony zapis klucza zatrzymuje start zamiast podpisywać słabym kluczem',async()=>{
  const db={q:async()=>({rows:[{value:'invalid'}]})};
  await assert.rejects(()=>sessionKey(db),/Nieprawidłowy zapis/);
});
