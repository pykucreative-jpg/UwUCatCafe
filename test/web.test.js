import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { createHmac } from 'node:crypto';
import { web } from '../src/web.js';
test('panel wymaga sesji, aktualnej rangi i CSRF; filtry działają na PostgreSQL',async t=>{
 const pg=new PGlite();await pg.exec(await readFile(new URL('../src/schema.sql',import.meta.url),'utf8'));await pg.exec(await readFile(new URL('../node_modules/connect-pg-simple/table.sql',import.meta.url),'utf8'));
 const q=async(sql,params=[])=>{const r=await pg.query(sql,params);return {...r,rowCount:r.affectedRows??r.rows.length};};
 const db={q,pool:{query:q}};let allowed=true,decisions=0;
 const svc={authorize:async()=>{if(!allowed)throw new Error('revoked');},decideLeave:async()=>{decisions++;return {title:'OK'};}};
 const secret='testing-only-secret-32-characters-long';
 const env={sessionSecret:secret,publicUrl:'http://127.0.0.1',production:false,clientId:'test',guildId:'test'};
 const app=web(db,svc,{},env,()=>true);
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 t.after(async()=>{await new Promise(resolve=>server.close(resolve));await pg.close();});
 const base='http://127.0.0.1:'+server.address().port;env.publicUrl=base;
 const sid='test-session';const csrf='known-csrf';
 const signature=createHmac('sha256',secret).update(sid).digest('base64').replace(/=+$/,'');
 const cookie='uwu.sid='+encodeURIComponent('s:'+sid+'.'+signature);
 await q('INSERT INTO session(sid,sess,expire) VALUES($1,$2,now()+interval \'1 hour\')',[sid,JSON.stringify({cookie:{maxAge:3600000,httpOnly:true,secure:false,sameSite:'lax'},user:{id:'123',name:'Anna'},csrf})]);
 assert.equal((await fetch(base+'/api/me')).status,401);
 assert.equal((await fetch(base+'/api/employees/123/proof')).status,401);
 const me=await fetch(base+'/api/me',{headers:{cookie}});assert.equal(me.status,200);assert.equal((await me.json()).csrf,csrf);
 await q("INSERT INTO employees(user_id,username,ic_name,hired_by_name,hired_at) VALUES('333','jan.k','Jan Kowalski','Anna',now())");
 await q("INSERT INTO logs(category,actor_id,actor_name,target_id,target_name,reason,status) VALUES('plus','123','Anna','333','Jan Kowalski','Pomoc','success')");
 for(const url of ['/api/overview','/api/employees?q=Jan','/api/logs?category=plus&actor=Anna&target=jan.k','/api/leaves','/api/tickets']){
  const r=await fetch(base+url,{headers:{cookie}});assert.equal(r.status,200,url);const data=await r.json();if(url.startsWith('/api/logs'))assert.equal(data.items.length,1);
 }
 const bad=await fetch(base+'/api/leaves/1/approve',{method:'POST',headers:{cookie,'Content-Type':'application/json',Origin:base},body:'{}'});assert.equal(bad.status,403);assert.equal(decisions,0);
 const good=await fetch(base+'/api/leaves/1/approve',{method:'POST',headers:{cookie,'Content-Type':'application/json',Origin:base,'X-CSRF-Token':csrf},body:'{}'});assert.equal(good.status,200);assert.equal(decisions,1);
 const wrongOrigin=await fetch(base+'/api/leaves/1/approve',{method:'POST',headers:{cookie,'Content-Type':'application/json',Origin:'https://evil.example','X-CSRF-Token':csrf},body:'{}'});assert.equal(wrongOrigin.status,403);
 allowed=false;assert.equal((await fetch(base+'/api/me',{headers:{cookie}})).status,403);
 const state=await fetch(base+'/auth/callback?state=wrong&code=invalid',{redirect:'manual',headers:{cookie}});assert.equal(state.headers.get('location'),'/?error=login');
});
