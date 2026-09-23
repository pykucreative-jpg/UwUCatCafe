import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { Collection } from 'discord.js';
import { service } from '../src/service.js';
import { config } from '../src/config.js';
const actorId='111111111111111111',targetId='222222222222222222';
async function setup(t){
 const pg=new PGlite();await pg.exec(await readFile(new URL('../src/schema.sql',import.meta.url),'utf8'));t.after(()=>pg.close());
 const q=async(sql,params=[])=>{const r=await pg.query(sql,params);return {...r,rowCount:r.affectedRows ?? r.rows.length};};
 const db={q,lock:async(key,fn)=>fn(),transaction:async fn=>pg.transaction(tx=>fn({query:async(sql,params=[])=>{const r=await tx.query(sql,params);return {...r,rowCount:r.affectedRows??r.rows.length};}}))};
 const roles=new Collection([...config.ranks.map(r=>r.id),config.employee,config.staff,config.leave,...config.plus,...config.minus].map(id=>[id,{id,editable:true,managed:false}]));
 const members=new Map();
 function member(id,ids){const cache=new Collection(ids.map(x=>[x,roles.get(x)]));const m={id,user:{id,username:id===actorId?'Anna':'Jan',bot:false},displayName:id===actorId?'Anna Nowak':'Jan Kowalski',nickname:null,manageable:true,kickable:true,guild:{id:'333333333333333333'},roles:{cache,add:async id=>{for(const x of [].concat(id))cache.set(x,roles.get(x));},remove:async ids=>{for(const x of [].concat(ids))cache.delete(x);}},setNickname:async n=>{m.nickname=n;m.displayName=n||m.user.username;},kick:async()=>{members.delete(id);}};members.set(id,m);return m;}
 const actor=member(actorId,[config.staff]);const target=member(targetId,[config.ranks[0].id,config.employee]);
 const guild={members:{fetch:async({user})=>{if(!members.has(user))throw Object.assign(new Error('not member'),{code:10007});return members.get(user);}},roles:{fetch:async()=>roles,cache:roles}};
 const client={guilds:{fetch:async()=>guild},user:{id:'444444444444444444'}};
 const svc=service(db,client,{guildId:'333333333333333333'});
 let seq=0;const run=(kind,extra={})=>svc.run({kind,actorId,targetId,reason:'Powód testowy',channelId:config.logs,requestId:'test-'+seq++,...extra});
 return {db,svc,target,actor,roles,members,run};
}
test('pełny cykl plusów usuwa stare rangi i zachowuje 5 logów',async t=>{
 const {run,target,db}=await setup(t);
 for(let i=1;i<=5;i++){await run('plus');assert.equal(target.roles.cache.has(config.plus[(i%5)-1]),i!==5);assert.equal(config.plus.filter(r=>target.roles.cache.has(r)).length,i===5?0:1);}
 const logs=(await db.q("SELECT * FROM logs WHERE category='plus' AND status='success' ORDER BY id")).rows;
 assert.equal(logs.length,5);assert.equal(logs[4].details.after,0);
 assert.equal((await db.q('SELECT plus_count FROM employees')).rows[0].plus_count,0);
});
test('drugi minus odbiera rangi, wyrzuca i zachowuje historię',async t=>{
 const {run,target,members,db}=await setup(t);await run('minus');assert.ok(target.roles.cache.has(config.minus[0]));await run('minus');assert.equal(members.has(targetId),false);assert.equal(target.roles.cache.size,0);
 const e=(await db.q('SELECT * FROM employees')).rows[0];assert.equal(e.status,'dismissed');assert.equal(e.minus_count,2);assert.equal((await db.q("SELECT * FROM logs WHERE category='minus'")).rows.length,2);
});
test('brak rangi zarządu blokuje działanie i nie zmienia danych',async t=>{
 const {run,target,actor,db}=await setup(t);actor.roles.cache.clear();await assert.rejects(()=>run('plus'),/uprawnionej kadry/);assert.equal(target.roles.cache.has(config.plus[0]),false);assert.equal((await db.q('SELECT * FROM logs')).rows.length,0);
});
test('ten sam request nie nalicza dwóch plusów',async t=>{
 const {run,target}=await setup(t);await run('plus',{requestId:'same'});await assert.rejects(()=>run('plus',{requestId:'same'}),/już obsłużone/);assert.ok(target.roles.cache.has(config.plus[0]));
});
test('awans zachowuje rangi spoza hierarchii i usuwa stare stanowisko',async t=>{
 const {run,target}=await setup(t);await run('awans');assert.ok(target.roles.cache.has(config.employee));assert.ok(target.roles.cache.has(config.ranks[1].id));assert.equal(target.roles.cache.has(config.ranks[0].id),false);await run('degrad');assert.ok(target.roles.cache.has(config.ranks[0].id));
});
test('zatrudnienie przechowuje dowód, osobę zatrudniającą i pseudonim',async t=>{
 const {run,target,db}=await setup(t);const result=await run('job',{icName:'Jan Testowy',ssn:'12345',attachment:{buffer:Buffer.from([255,216,255,1])}});const e=(await db.q('SELECT * FROM employees')).rows[0];assert.equal(e.hired_by,actorId);assert.equal(e.hired_by_name,'Anna Nowak');assert.equal(e.ssn,'12345');assert.equal(e.proof.length,4);assert.equal(target.nickname,'Jan Testowy');assert.equal(JSON.stringify(result).includes('12345'),false);
 await assert.rejects(()=>run('job',{icName:'Ponownie',ssn:'12',attachment:{buffer:Buffer.from([255,216,255])}}),/już zatrudniona/);
});
test('urlop kończy się po restarcie i przywraca oryginalny pseudonim',async t=>{
 const {run,target,db,svc}=await setup(t);target.nickname='Jan Kowalski';await run('urlop',{endsAt:new Date(Date.now()+3600000)});assert.equal(target.nickname,'Jan Kowalski [urlop]');assert.ok(target.roles.cache.has(config.leave));
 await db.q("UPDATE leaves SET starts_at=now()-interval '2 hours',ends_at=now()-interval '1 hour'");await svc.tickLeaves();assert.equal(target.nickname,'Jan Kowalski');assert.equal(target.roles.cache.has(config.leave),false);assert.equal((await db.q('SELECT status FROM leaves')).rows[0].status,'ended');assert.equal((await db.q('SELECT * FROM notifications')).rows.length,1);await svc.tickLeaves();assert.equal((await db.q('SELECT * FROM notifications')).rows.length,1);
});
test('zaplanowany urlop nie rozpoczyna się przed czasem; dwie decyzje są blokowane',async t=>{
 const {db,svc,target}=await setup(t);const l=(await db.q("INSERT INTO leaves(user_id,ic_name,starts_at,ends_at,channel_id) VALUES($1,'Jan',now()+interval '1 day',now()+interval '2 days',$2) RETURNING id",[targetId,config.logs])).rows[0];await svc.decideLeave(l.id,'approve',actorId);assert.equal(target.roles.cache.has(config.leave),false);await assert.rejects(()=>svc.decideLeave(l.id,'approve',actorId),/już rozpatrzony/);await svc.tickLeaves();assert.equal(target.roles.cache.has(config.leave),false);
});
test('błąd po nadaniu roli urlopowej jest widoczny i daje się wznowić',async t=>{
 const {run,target,db,svc}=await setup(t);const set=target.setNickname;target.setNickname=async()=>{throw Object.assign(new Error('Missing permissions'),{code:50013});};await assert.rejects(()=>run('urlop',{endsAt:new Date(Date.now()+3600000)}));assert.equal((await db.q('SELECT status FROM logs')).rows[0].status,'partial');assert.equal((await db.q('SELECT status FROM leaves')).rows[0].status,'starting');target.setNickname=set;await svc.tickLeaves();assert.equal((await db.q('SELECT status FROM leaves')).rows[0].status,'active');
});
test('zdjęcie HTML jest odrzucane przed modyfikacją Discord',async t=>{
 const {run,target}=await setup(t);await assert.rejects(()=>run('job',{icName:'Jan',ssn:'12',attachment:{buffer:Buffer.from('<html>')}}),/PNG/);assert.equal(target.nickname,null);
});
