import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { Collection,Events } from 'discord.js';
import { blacklistService,normalizeSsn } from '../src/blacklist.js';
import { service } from '../src/service.js';
import { bot } from '../src/bot.js';
import { config } from '../src/config.js';

test('czarna lista: dodanie, pełne powody, wyszukiwanie, zdjęcia, usuwanie i kontrola dostępu',async t=>{
  const pg=new PGlite();await pg.exec(await readFile(new URL('../src/schema.sql',import.meta.url),'utf8'));t.after(()=>pg.close());
  const q=async(sql,params=[])=>{const r=await pg.query(sql,params);return {...r,rowCount:r.affectedRows??r.rows.length};};
  const db={q,lock:async(key,fn)=>fn()};
  const actorId='111111111111111111',guildId='222222222222222222';
  const actor={id:actorId,displayName:'Anna Nowak',roles:{cache:new Collection([[config.staff,{}]])}};
  const client=new EventEmitter();client.user={id:'333333333333333333'};client.guilds={fetch:async()=>({members:{fetch:async()=>actor}})};
  const svc=service(db,client,{guildId});const bl=blacklistService(db,svc);let serial=0;
  const args=(ssn='00123',reason='Powód')=>({ssn,icName:'Jan Kowalski',reason,attachment:{buffer:Buffer.from([255,216,255,1])},actorId,channelId:config.logs,requestId:'bl-'+serial++});
  let first;
  await t.test('wiele powodów dla jednego SSN i zachowanie zer',async()=>{
    assert.equal(normalizeSsn(' 00123 '),'00123');
    first=await bl.add(args());await bl.add(args('00123','Drugi powód'));
    const found=await bl.search(' 00123 ');assert.equal(found.total,2);assert.equal(found.items[0].reason,'Drugi powód');assert.equal(found.items[0].added_by,actorId);
    assert.equal((await bl.search('123')).total,0);assert.equal((await bl.photo(first.photoId)).photo.length,4);
    assert.equal((await db.q("SELECT * FROM logs WHERE category='bldodaj'")).rows.length,2);
  });
  await t.test('kolejny request nie duplikuje wpisu',async()=>{
    const input=args('00999');await bl.add(input);await assert.rejects(()=>bl.add(input),/już obsłużone/);assert.equal((await bl.search('00999')).total,1);
  });
  await t.test('paginacja nie gubi wpisów ani długich powodów',async()=>{
    for(let i=0;i<6;i++)await bl.add(args('00777',String(i)+'x'.repeat(999)));
    const a=await bl.search('00777'),b=await bl.search('00777',1);assert.equal(a.items.length,4);assert.equal(b.items.length,2);assert.equal(a.more,true);assert.equal(b.more,false);assert.equal(a.items[0].reason.length,1000);assert.equal(new Set([...a.items,...b.items].map(x=>x.id)).size,6);
  });
  await t.test('usunięcie obejmuje wszystkie wpisy tylko wybranego SSN i zostawia logi',async()=>{
    const result=await bl.remove({ssn:'00123',actorId,requestId:'remove',channelId:config.logs});assert.equal(result.fields['📋 Usunięte wpisy'],'2');assert.equal((await bl.search('00123')).total,0);assert.equal((await bl.search('00999')).total,1);await assert.rejects(()=>bl.photo(first.photoId));
    assert.equal((await db.q("SELECT * FROM blacklist WHERE ssn='00123' AND removed_by=$1",[actorId])).rows.length,2);
    assert.equal((await db.q("SELECT * FROM logs WHERE category='blusun' AND status='success'")).rows.length,1);
    assert.equal((await bl.remove({ssn:'00123',actorId,requestId:'again'})).noop,true);
  });
  await t.test('brak rangi blokuje dodawanie i usuwanie',async()=>{
    actor.roles.cache.clear();await assert.rejects(()=>bl.add(args()),/uprawnionej kadry/);await assert.rejects(()=>bl.remove({ssn:'00999',actorId}),/uprawnionej kadry/);actor.roles.cache.set(config.staff,{});
  });
  await t.test('komenda publikuje dane, zdjęcie i powód w odpowiedniej kolejności',async()=>{
    bot(db,client,svc,{guildId});const sent=[];
    const interaction=(commandName,ssn)=>{const i={id:'interaction-'+serial++,commandName,guildId,channelId:config.logs,user:{id:actorId},inGuild:()=>true,isChatInputCommand:()=>true,
      options:{getString:key=>({ssn,imie_i_nazwisko:'Jan Kowalski',powod:'Testowy powód'})[key],getAttachment:()=>({buffer:Buffer.from([255,216,255,1])}),getUser:()=>{throw new Error('BL nie potrzebuje konta Discord osoby');}},
      deferReply:async()=>{i.deferred=true;},editReply:async payload=>{i.result=payload;},channel:{send:async payload=>{sent.push(payload);}}};return i;};
    const handler=client.listeners(Events.InteractionCreate)[0];
    await handler(interaction('bldodaj','00444'));assert.equal(sent.length,1);assert.match(sent[0].embeds[0].data.description,/Jan Kowalski/);assert.equal(sent[0].embeds[0].data.image.url,'attachment://zdjecie.jpg');assert.equal(sent[0].embeds[1].data.fields[0].value,'Testowy powód');assert.equal(sent[0].embeds[1].data.footer.text,'🐾 UwUCatCafe');assert.equal(sent[0].files[0].attachment.length,4);
    const search=interaction('blszukaj','00777');await handler(search);assert.equal(search.result.embeds.length,5);assert.equal(search.result.embeds[1].data.fields[0].value.length,1000);assert.equal(search.result.components[0].components[1].data.disabled,false);
    const denied=interaction('blszukaj','00777');actor.roles.cache.clear();await handler(denied);assert.match(denied.result.embeds[0].data.description,/uprawnionej kadry/);actor.roles.cache.set(config.staff,{});
    await handler(interaction('blusun','00444'));assert.equal((await bl.search('00444')).total,0);
  });
});
