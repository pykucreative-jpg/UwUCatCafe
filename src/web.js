import express from 'express';
import helmet from 'helmet';
import session from 'express-session';
import connectPg from 'connect-pg-simple';
import { rateLimit } from 'express-rate-limit';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { config, labels } from './config.js';
import { UserError, parseDate } from './domain.js';
const nonce=()=>randomBytes(32).toString('hex');
const equal=(a,b)=>typeof a==='string'&&typeof b==='string'&&Buffer.byteLength(a)===Buffer.byteLength(b)&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
const pageOf=value=>Math.max(0,Math.min(100000,parseInt(value,10)||0));
export function web(db,svc,bot,env,ready) {
  const app=express(); app.set('trust proxy',1); app.disable('x-powered-by');
  app.use(helmet({contentSecurityPolicy:{directives:{defaultSrc:["'self'"],scriptSrc:["'self'"],styleSrc:["'self'"],imgSrc:["'self'",'data:','https://cdn.discordapp.com'],connectSrc:["'self'"],formAction:["'self'"],upgradeInsecureRequests:env.production?[]:null}}}));
  app.get('/healthz',async(req,res)=>{try{await db.q('SELECT 1');res.status(ready()?200:503).json({ready:ready()});}catch{res.status(503).json({ready:false});}});
  app.use(express.json({limit:'12mb'}));
  const Store=connectPg(session);
  app.use(session({store:new Store({pool:db.pool,createTableIfMissing:true}),name:'uwu.sid',secret:env.sessionSecret,resave:false,saveUninitialized:false,cookie:{httpOnly:true,secure:env.production,sameSite:'lax',maxAge:8*60*60*1000}}));
  const authLimit=rateLimit({windowMs:15*60*1000,limit:30,standardHeaders:'draft-8',legacyHeaders:false});
  const save=req=>new Promise((resolve,reject)=>req.session.save(e=>e?reject(e):resolve()));
  const regenerate=req=>new Promise((resolve,reject)=>req.session.regenerate(e=>e?reject(e):resolve()));
  app.get('/auth/discord',authLimit,async(req,res)=>{
    req.session.oauthState=nonce(); req.session.oauthStarted=Date.now(); await save(req);
    res.redirect(`https://discord.com/oauth2/authorize?${new URLSearchParams({client_id:env.clientId,redirect_uri:env.publicUrl+'/auth/callback',response_type:'code',scope:'identify',state:req.session.oauthState,prompt:'consent'})}`);
  });
  app.get('/auth/callback',authLimit,async(req,res)=>{
    const valid=equal(req.query.state,req.session.oauthState)&&Date.now()-req.session.oauthStarted<10*60*1000;
    delete req.session.oauthState; delete req.session.oauthStarted; await save(req);
    if(!valid||typeof req.query.code!=='string') return res.redirect('/?error=login');
    try {
      const tokenResponse=await fetch('https://discord.com/api/v10/oauth2/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:env.clientId,client_secret:env.clientSecret,grant_type:'authorization_code',code:req.query.code,redirect_uri:env.publicUrl+'/auth/callback'}),signal:AbortSignal.timeout(15000)});
      if(!tokenResponse.ok) throw new Error('oauth');
      const token=await tokenResponse.json();
      const response=await fetch('https://discord.com/api/v10/users/@me',{headers:{Authorization:`Bearer ${token.access_token}`},signal:AbortSignal.timeout(15000)});
      if(!response.ok) throw new Error('profile');
      const user=await response.json(); await svc.authorize(user.id);
      await regenerate(req); req.session.user={id:user.id,name:user.global_name||user.username}; req.session.csrf=nonce(); await save(req);
      res.redirect('/');
    }catch{res.redirect('/?error=access');}
  });
  app.use('/api',rateLimit({windowMs:60000,limit:120,standardHeaders:'draft-8',legacyHeaders:false}),async(req,res,next)=>{
    res.set('Cache-Control','no-store');
    if(!req.session.user) return res.status(401).json({error:'Zaloguj się przez Discord.'});
    try {await svc.authorize(req.session.user.id);}catch{return res.status(403).json({error:'Brak rangi uprawniającej do panelu lub Discord jest niedostępny.'});}
    if(!['GET','HEAD'].includes(req.method) && (!equal(req.get('X-CSRF-Token'),req.session.csrf)||req.get('Origin')!==env.publicUrl)) return res.status(403).json({error:'Odśwież stronę i spróbuj ponownie.'});
    next();
  });
  app.get('/api/me',(req,res)=>res.json({user:req.session.user,csrf:req.session.csrf,labels,ranks:config.ranks.map(r=>r.name)}));
  app.post('/api/logout',(req,res)=>req.session.destroy(()=>{res.clearCookie('uwu.sid');res.json({ok:true});}));
  app.get('/api/overview',async(req,res)=>{
    const [employees,leaves,tickets,activity,requests]=await Promise.all([
      db.q("SELECT count(*)::int AS count FROM employees WHERE status='active' AND hired_at IS NOT NULL"),
      db.q("SELECT count(*)::int AS count FROM leaves WHERE status='active'"),
      db.q("SELECT count(*)::int AS count FROM tickets WHERE status='open'"),
      db.q('SELECT * FROM logs ORDER BY created_at DESC LIMIT 8'),
      db.q("SELECT * FROM leaves WHERE status='pending' ORDER BY created_at LIMIT 6")
    ]);
    res.json({employees:employees.rows[0].count,leaves:leaves.rows[0].count,tickets:tickets.rows[0].count,activity:activity.rows,requests:requests.rows});
  });
  app.get('/api/employees',async(req,res)=>{
    const q=String(req.query.q||'').slice(0,100),status=req.query.status==='dismissed'?'dismissed':'active';
    const result=await db.q(`SELECT e.user_id,e.username,e.ic_name,e.rank,e.plus_count,e.minus_count,e.status,e.hired_by,e.hired_by_name,e.hired_at,
      l.status AS leave_status,l.starts_at,l.ends_at FROM employees e LEFT JOIN leaves l ON l.user_id=e.user_id AND l.status IN ('active','pending','scheduled','starting','ending')
      WHERE e.status=$1 AND (e.ic_name ILIKE $2 OR e.username ILIKE $2 OR e.user_id=$3 OR e.hired_by_name ILIKE $2) ORDER BY e.ic_name LIMIT 51 OFFSET $4`,[status,'%'+q+'%',q,pageOf(req.query.page)*50]);
    res.json({items:result.rows.slice(0,50),more:result.rows.length>50});
  });
  app.get('/api/employees/:id',async(req,res)=>res.json(await svc.profile(req.params.id)));
  app.get('/api/employees/:id/proof',async(req,res)=>{
    const e=(await db.q('SELECT proof,proof_type FROM employees WHERE user_id=$1',[req.params.id])).rows[0];
    if(!e?.proof) return res.status(404).json({error:'Brak zdjęcia dowodu.'});
    res.set({'Content-Type':e.proof_type,'Content-Disposition':'inline; filename="dowod-ic"','Cache-Control':'no-store'}).send(e.proof);
  });
  app.get('/api/logs',async(req,res)=>{
    const filters=[String(req.query.q||'').slice(0,100),String(req.query.actor||'').slice(0,100),String(req.query.target||'').slice(0,100)];
    const category=Object.hasOwn(labels,String(req.query.category))?req.query.category:'';
    const date=String(req.query.date||''); if(date&&!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new UserError('Nieprawidłowa data.');
    const result=await db.q(`SELECT l.* FROM logs l LEFT JOIN employees e ON e.user_id=l.target_id LEFT JOIN employees a ON a.user_id=l.actor_id
      WHERE ($1='' OR l.category=$1)
      AND (concat_ws(' ',l.actor_id,l.actor_name,l.target_id,l.target_name,l.reason,e.username,e.ic_name,a.username,a.ic_name) ILIKE $2)
      AND (concat_ws(' ',l.actor_id,l.actor_name,a.username,a.ic_name) ILIKE $3)
      AND (concat_ws(' ',l.target_id,l.target_name,e.username,e.ic_name) ILIKE $4)
      AND ($5='' OR to_char(l.created_at AT TIME ZONE 'Europe/Warsaw','YYYY-MM-DD')=$5)
      ORDER BY l.created_at DESC LIMIT 51 OFFSET $6`,[category,...filters.map(x=>'%'+x+'%'),date,pageOf(req.query.page)*50]);
    res.json({items:result.rows.slice(0,50),more:result.rows.length>50});
  });
  app.get('/api/leaves',async(req,res)=>{
    const result=await db.q(`SELECT * FROM leaves WHERE ($1='' OR status=$1) ORDER BY created_at DESC LIMIT 51 OFFSET $2`,[['pending','active','scheduled','ended','rejected','cancelled'].includes(req.query.status)?req.query.status:'',pageOf(req.query.page)*50]);
    res.json({items:result.rows.slice(0,50),more:result.rows.length>50});
  });
  app.post('/api/leaves/:id/:decision',async(req,res)=>{
    if(!['approve','reject'].includes(req.params.decision)) throw new UserError('Nieznana decyzja.');
    res.json(await svc.decideLeave(req.params.id,req.params.decision,req.session.user.id,req.body.reason));
  });
  app.get('/api/tickets',async(req,res)=>{
    const result=await db.q("SELECT * FROM tickets WHERE ($1='' OR status=$1) ORDER BY created_at DESC LIMIT 51 OFFSET $2",[['open','closed'].includes(req.query.status)?req.query.status:'',pageOf(req.query.page)*50]);
    res.json({items:result.rows.slice(0,50),more:result.rows.length>50});
  });
  app.get('/api/tickets/:id',async(req,res)=>{
    const t=(await db.q('SELECT * FROM tickets WHERE id=$1',[req.params.id])).rows[0];
    if(!t) return res.status(404).json({error:'Nie znaleziono zgłoszenia.'});
    const messages=(await db.q('SELECT * FROM ticket_messages WHERE ticket_id=$1 ORDER BY created_at DESC LIMIT 100 OFFSET $2',[t.id,pageOf(req.query.page)*100])).rows.reverse();
    res.json({ticket:t,messages,url:`https://discord.com/channels/${env.guildId}/${t.channel_id}`,page:pageOf(req.query.page)});
  });
  app.post('/api/tickets/:id/close',async(req,res)=>res.json(await bot.closeTicket(req.params.id,req.session.user.id,req.body.reason)));
  app.post('/api/actions',rateLimit({windowMs:60000,limit:20}),async(req,res)=>{
    const {kind,targetId,reason,endsAt,icName,ssn,proofBase64}=req.body;
    if(!['job','plus','minus','awans','degrad','zwolnij','urlop','zdejmijurlop'].includes(kind)||!/^\d{17,20}$/.test(targetId)) throw new UserError('Wybierz działanie i poprawne ID użytkownika Discord.');
    let attachment;
    if(kind==='job') {
      if(typeof proofBase64!=='string'||proofBase64.length>12*1024*1024) throw new UserError('Dodaj zdjęcie dowodu do 8 MB.');
      attachment={buffer:Buffer.from(proofBase64,'base64')};
    }
    const result=await svc.run({kind,actorId:req.session.user.id,targetId,reason,channelId:config.logs,requestId:'web:'+nonce(),icName,ssn,attachment,endsAt:kind==='urlop'?parseDate(endsAt):undefined});
    res.json(result);
  });
  app.use(express.static(fileURLToPath(new URL('../public',import.meta.url)),{index:'index.html'}));
  app.use((err,req,res,next)=>{
    console.error('Żądanie WWW',err.code||err.name);
    res.status(err instanceof UserError?400:500).json({error:err instanceof UserError?err.message:'Nie udało się wykonać działania. Spróbuj ponownie lub sprawdź logi.'});
  });
  return app;
}
