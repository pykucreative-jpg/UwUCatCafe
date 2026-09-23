import { config } from './config.js';
import { UserError, text, nextPlus, highest, rankChange, leaveNickname, clearLeaveNickname, formatDate, imageType } from './domain.js';

export function service(db, client, env) {
  const guild = () => client.guilds.fetch(env.guildId);
  async function member(id) { return (await guild()).members.fetch({ user:id, force:true }); }
  async function authorize(id) {
    const m = await member(id);
    if (!m.roles.cache.has(config.staff)) throw new UserError('Ta funkcja jest dostępna tylko dla uprawnionej kadry.');
    return { id:m.id, name:m.displayName };
  }
  async function employee(m) {
    const ids = [...m.roles.cache.keys()];
    const rank = config.ranks[highest(config.ranks.map(r=>r.id), ids)-1]?.name || null;
    await db.q(`INSERT INTO employees(user_id,username,ic_name,rank,plus_count,minus_count)
      VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(user_id) DO UPDATE SET username=$2,rank=$4,plus_count=$5,minus_count=$6,updated_at=now()`,
    [m.id,m.user.username,m.displayName,rank,highest(config.plus,ids),highest(config.minus,ids)]);
    return (await db.q('SELECT user_id,username,ic_name,rank,plus_count,minus_count,status,hired_by,hired_by_name,hired_at FROM employees WHERE user_id=$1',[m.id])).rows[0];
  }
  async function checkRoles(m, ids) {
    if (!m.manageable) throw new UserError('Ranga bota musi być ponad rangami tej osoby. Nie można zmienić właściciela serwera.');
    const g=await guild(); await g.roles.fetch();
    for (const id of ids) if (!g.roles.cache.get(id)?.editable) throw new UserError(`Bot nie może zarządzać rangą ${id}. Sprawdź uprawnienia i hierarchię.`);
  }
  async function replaceRoles(m, family, selected, reason, steps=[]) {
    const old = family.filter(id=>m.roles.cache.has(id));
    await checkRoles(m,[...old,...(selected?[selected]:[])]);
    if (selected && !old.includes(selected)) {await m.roles.add(selected,reason);steps.push('Nadano nową rangę');}
    const remove=old.filter(id=>id!==selected);
    if (remove.length) {await m.roles.remove(remove,reason);steps.push('Zdjęto poprzednie rangi z tej kategorii');}
  }
  async function audit({ category, actor, target, reason='', channelId, requestId }, fn) {
    if (requestId) {
      const existing=(await db.q('SELECT id FROM logs WHERE request_id=$1',[requestId])).rows[0];
      if (existing) throw new UserError('To działanie zostało już obsłużone. Sprawdź historię.');
    }
    const log=(await db.q(`INSERT INTO logs(category,actor_id,actor_name,target_id,target_name,reason,channel_id,request_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,[category,actor.id,actor.name,target?.id,target?.name,reason,channelId,requestId])).rows[0];
    const steps=[];
    try {
      const result=await fn(steps);
      await db.q('UPDATE logs SET status=$2,details=$3 WHERE id=$1',[log.id,result.noop?'noop':'success',JSON.stringify({...result,steps})]);
      return result;
    } catch (err) {
      const message = err instanceof UserError ? err.message : `Operacja nie została ukończona (kod ${String(err.code || 'błąd usługi')}). Sprawdź uprawnienia bota i logi.`;
      await db.q('UPDATE logs SET status=$2,details=$3 WHERE id=$1',[log.id,steps.length?'partial':'failed',JSON.stringify({error:message,steps})]);
      console.error('Operacja nieudana',log.id,err.code || err.name);
      throw new UserError(`${message}${steps.length ? ' Wykonano: '+steps.join(', ')+'.' : ''}`);
    }
  }
  async function proof(attachment) {
    if(Buffer.isBuffer(attachment?.buffer)) {
      if(attachment.buffer.length>8*1024*1024) throw new UserError('Zdjęcie przekracza 8 MB.');
      return {bytes:attachment.buffer,type:imageType(attachment.buffer)};
    }
    if (!attachment || attachment.size > 8*1024*1024) throw new UserError('Dodaj zdjęcie dowodu IC do 8 MB.');
    const url=new URL(attachment.url);
    if (url.protocol!=='https:' || !['cdn.discordapp.com','media.discordapp.net'].includes(url.hostname)) throw new UserError('Nieprawidłowy załącznik Discord.');
    const res=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(15000)});
    if (!res.ok) throw new UserError('Nie udało się pobrać zdjęcia dowodu.');
    const chunks=[]; let length=0;
    for await(const chunk of res.body) { length+=chunk.length; if(length>8*1024*1024) { await res.body.cancel().catch(()=>{}); throw new UserError('Zdjęcie przekracza 8 MB.'); } chunks.push(chunk); }
    const bytes=Buffer.concat(chunks);
    return {bytes,type:imageType(bytes)};
  }
  async function dismiss(m, steps, reason) {
    if(!m.kickable) throw new UserError('Bot nie może usunąć tej osoby. Sprawdź hierarchię rang i uprawnienie Wyrzucanie członków.');
    const removable=m.roles.cache.filter(r=>r.id!==m.guild.id&&!r.managed).map(r=>r.id);
    await checkRoles(m,removable);
    if(removable.length) await m.roles.remove(removable,reason);
    steps.push('Odebrano rangi możliwe do zarządzania');
    await m.kick(reason); steps.push('Usunięto z serwera');
    await db.transaction(async tx=>{
      await tx.query("UPDATE employees SET status='dismissed',rank=NULL,plus_count=0,updated_at=now() WHERE user_id=$1",[m.id]);
      await tx.query("UPDATE leaves SET status='cancelled' WHERE user_id=$1 AND status IN ('pending','scheduled','active','starting','ending')",[m.id]);
    });
  }
  async function run({kind,actorId,targetId,reason='',channelId,requestId,icName,ssn,attachment,endsAt}) {
    return db.lock(`user:${targetId}`,async()=>{
      const actor=await authorize(actorId);
      const m=await member(targetId);
      if(m.user.bot) throw new UserError('Wybierz osobę, a nie bota.');
      if(!['job','urlop','szukaj'].includes(kind)) reason=text(reason);
      const e=await employee(m);
      return audit({category:kind,actor,target:{id:m.id,name:kind==='job'?text(icName,32):e.ic_name},reason,channelId,requestId},async steps=>{
        const ids=[...m.roles.cache.keys()];
        if(kind==='job') {
          const name=text(icName,32); const serial=text(ssn,40); const doc=await proof(attachment);
          if(e.hired_at&&e.status==='active') throw new UserError('Ta osoba jest już zatrudniona. Użyj awansu lub degradacji.');
          await checkRoles(m,[config.employee,...config.ranks.filter(r=>ids.includes(r.id)).map(r=>r.id),config.ranks[0].id]);
          // Save the original evidence before changing Discord; the pending audit remains visible after a crash.
          await db.q('UPDATE employees SET proof=$2,proof_type=$3,ssn=$4 WHERE user_id=$1',[m.id,doc.bytes,doc.type,serial]);
          await m.setNickname(name,'UwUCatCafe: zatrudnienie'); steps.push('Ustawiono pseudonim');
          await replaceRoles(m,config.ranks.map(r=>r.id),config.ranks[0].id,'UwUCatCafe: zatrudnienie',steps);
          await m.roles.add(config.employee); steps.push('Nadano rangi pracownicze');
          await db.q(`UPDATE employees SET ic_name=$2,hired_by=$3,hired_by_name=$4,hired_at=now(),rank=$5,status='active' WHERE user_id=$1`,[m.id,name,actor.id,actor.name,config.ranks[0].name]);
          return {title:'🎀 Witamy w UwUCatCafe!',description:`<@${m.id}> dołącza do naszego zespołu. Miło Cię widzieć! ☕`,fields:{'🐱 Imię i nazwisko IC':name,'🧁 Stanowisko':'Praktykant','🎀 Przyjęcie zatwierdził(a)':`<@${actor.id}>`}};
        }
        if(kind==='plus') {
          const state=nextPlus(ids);
          await replaceRoles(m,config.plus,state.after?config.plus[state.after-1]:null,reason,steps); steps.push('Zaktualizowano rangi plusów');
          await db.q('UPDATE employees SET plus_count=$2 WHERE user_id=$1',[m.id,state.after]);
          return {title:state.reset?'🌟 Pięć plusów na koncie!':'🌟 Dobra robota!',description:`<@${m.id}>, dziękujemy za zaangażowanie! 🤍${state.reset?' Ukończono cykl wyróżnień. Plusy wyczyszczono — zaczynasz od 0/5.':''}`,before:state.before,after:state.after,fields:{'💬 Powód':reason,'✨ Plusy':`${state.after}/5`,'🎀 Przyznał(a)':`<@${actor.id}>`}};
        }
        if(kind==='minus') {
          const count=Math.min(2,highest(config.minus,ids)+1);
          if(count===2&&!m.kickable) throw new UserError('Drugi minus wymaga możliwości usunięcia tej osoby. Sprawdź rangę bota.');
          if(count===2) await checkRoles(m,m.roles.cache.filter(r=>r.id!==m.guild.id&&!r.managed).map(r=>r.id));
          await replaceRoles(m,config.minus,config.minus[count-1],reason,steps); steps.push('Nadano minus');
          await db.q('UPDATE employees SET minus_count=$2 WHERE user_id=$1',[m.id,count]);
          if(count===2) await dismiss(await member(m.id),steps,reason);
          return {title:count===2?'📋 Zakończenie współpracy':'⚠️ Ostrzeżenie pracownicze',description:count===2?`${e.ic_name} otrzymał(a) drugi minus. Odebrano rangi i usunięto osobę z serwera.`:`<@${m.id}> otrzymuje minus. Drugi minus oznacza zwolnienie i usunięcie z serwera.`,fields:{'💬 Powód':reason,'📋 Minusy':`${count}/2`,'👤 Wystawił(a)':`<@${actor.id}>`}};
        }
        if(['awans','degrad'].includes(kind)) {
          const change=rankChange(ids,kind==='awans'?1:-1);
          if(change.before===change.after) return {noop:true,title:'☕ Stanowisko bez zmian',description:`<@${m.id}> ma już ${kind==='awans'?'najwyższe':'najniższe'} stanowisko. Rangi zarządu są nadawane ręcznie.`};
          await replaceRoles(m,config.ranks.map(r=>r.id),config.ranks[change.after].id,reason,steps); steps.push('Zmieniono stanowisko');
          await db.q('UPDATE employees SET rank=$2 WHERE user_id=$1',[m.id,config.ranks[change.after].name]);
          return {title:kind==='awans'?'✨ Pora na kolejny krok!':'📋 Zmiana stanowiska',description:`<@${m.id}> ${kind==='awans'?'awansuje. Gratulujemy! 🐱':'przechodzi na niższe stanowisko.'}`,fields:{'☕ Stanowisko':`${config.ranks[change.before].name} → ${config.ranks[change.after].name}`,'💬 Powód':reason,'🎀 Decyzję podjął/podjęła':`<@${actor.id}>`}};
        }
        if(kind==='zwolnij') {
          await dismiss(m,steps,reason);
          return {title:'📋 Zakończenie współpracy',description:`${e.ic_name} został(a) zwolniony/a. Odebrano rangi i usunięto osobę z serwera.`,fields:{'💬 Powód':reason,'👤 Decyzję podjął/podjęła':`<@${actor.id}>`}};
        }
        if(kind==='urlop') {
          if(!endsAt||new Date(endsAt)<=new Date()) throw new UserError('Koniec urlopu musi wypadać w przyszłości.');
          if((await db.q("SELECT id FROM leaves WHERE user_id=$1 AND status IN ('pending','scheduled','active','starting','ending')",[m.id])).rowCount) throw new UserError('Ta osoba ma już urlop lub oczekujący wniosek.');
          const l=(await db.q(`INSERT INTO leaves(user_id,ic_name,starts_at,ends_at,status,channel_id,approved_by,approved_by_name) VALUES($1,$2,now(),$3,'scheduled',$4,$5,$6) RETURNING *`,[m.id,e.ic_name,endsAt,channelId,actor.id,actor.name])).rows[0];
          steps.push('Zapisano urlop'); await activate(l,m,steps);
          return {title:'🌴 Czas na odpoczynek!',description:`<@${m.id}>, Twój urlop został zatwierdzony. Odpocznij i wracaj z nową energią! ☀️`,fields:{'📅 Do kiedy':formatDate(endsAt),'🎀 Zatwierdził(a)':`<@${actor.id}>`}};
        }
        if(kind==='zdejmijurlop') {
          const l=(await db.q("SELECT * FROM leaves WHERE user_id=$1 AND status IN ('active','scheduled','starting','ending')",[m.id])).rows[0];
          if(!l) return {noop:true,title:'☕ Brak urlopu',description:`<@${m.id}> nie ma aktywnego ani zaplanowanego urlopu.`};
          await endLeave(l,m,steps);
          return {title:'🌸 Witamy z powrotem!',description:`<@${m.id}>, Twój urlop został zakończony ręcznie. Zapraszamy do pracy! ☕`,fields:{'💬 Powód':reason,'🎀 Urlop zakończył(a)':`<@${actor.id}>`}};
        }
        throw new UserError('Nieznana komenda.');
      });
    });
  }
  async function activate(l,m,steps=[]) {
    await checkRoles(m,[config.leave]);
    const nick=l.applied_nick || leaveNickname(m.displayName);
    if(l.status!=='starting') await db.q("UPDATE leaves SET status='starting',old_nick=$2,applied_nick=$3 WHERE id=$1",[l.id,m.nickname,nick]);
    await m.roles.add(config.leave,'UwUCatCafe: urlop'); steps.push('Nadano rangę urlopową');
    await m.setNickname(nick); steps.push('Ustawiono dopisek urlop');
    await db.q("UPDATE leaves SET status='active',error=NULL,retry_at=NULL WHERE id=$1",[l.id]);
  }
  async function endLeave(l,m,steps=[]) {
    await checkRoles(m,[config.leave]);
    await db.q("UPDATE leaves SET status='ending' WHERE id=$1",[l.id]);
    await m.roles.remove(config.leave); steps.push('Zdjęto rangę urlopową');
    if(m.nickname?.toLowerCase().includes('[urlop]')) {
      const nick=m.nickname===l.applied_nick?l.old_nick:clearLeaveNickname(m.nickname);
      await m.setNickname(nick); steps.push('Usunięto dopisek urlop');
    }
    await db.q("UPDATE leaves SET status='ended',error=NULL,retry_at=NULL WHERE id=$1",[l.id]);
  }
  async function decideLeave(id,decision,actorId,reason='') {
    const initial=(await db.q('SELECT * FROM leaves WHERE id=$1',[id])).rows[0];
    if(!initial) throw new UserError('Nie znaleziono wniosku.');
    return db.lock(`user:${initial.user_id}`,async()=>{
      const actor=await authorize(actorId);
      const l=(await db.q('SELECT * FROM leaves WHERE id=$1',[id])).rows[0];
      if(l.status!=='pending') throw new UserError('Ten wniosek został już rozpatrzony.');
      return audit({category:'urlop',actor,target:{id:l.user_id,name:l.ic_name},reason:decision==='reject'?text(reason):l.reason,channelId:l.channel_id},async steps=>{
        if(decision==='reject') {
          await db.q("UPDATE leaves SET status='rejected',approved_by=$2,approved_by_name=$3 WHERE id=$1",[id,actor.id,actor.name]);
          await notify(l.channel_id,l.user_id,'💌 Decyzja w sprawie urlopu',`Wniosek został odrzucony.\n**Powód:** ${reason}\n**Decyzję podjął/podjęła:** <@${actor.id}>`);
          return {title:'💌 Wniosek odrzucony',description:reason};
        }
        if(new Date(l.ends_at)<=new Date()) throw new UserError('Termin wniosku już upłynął. Odrzuć go z odpowiednim powodem.');
        await member(l.user_id);
        await db.q("UPDATE leaves SET status='scheduled',approved_by=$2,approved_by_name=$3 WHERE id=$1",[id,actor.id,actor.name]); steps.push('Zatwierdzono wniosek');
        if(new Date(l.starts_at)<=new Date()) await activate({...l,status:'scheduled'},await member(l.user_id),steps);
        await notify(l.channel_id,l.user_id,'✅ Urlop zatwierdzony!',`Możesz planować odpoczynek! 🌴\n**Termin:** ${formatDate(l.starts_at)} → ${formatDate(l.ends_at)}\n**Zatwierdził(a):** <@${actor.id}>`);
        return {title:'✅ Urlop zatwierdzony!',description:`${formatDate(l.starts_at)} → ${formatDate(l.ends_at)}`};
      });
    });
  }
  async function notify(channel,user,title,body) { await db.q('INSERT INTO notifications(channel_id,user_id,title,body) VALUES($1,$2,$3,$4)',[channel,user,title,body]); }
  async function tickLeaves() {
    const due=(await db.q("SELECT * FROM leaves WHERE status IN ('scheduled','active','starting','ending') AND (retry_at IS NULL OR retry_at<=now()) AND (starts_at<=now() OR status='ending')")).rows;
    for(const candidate of due) await db.lock(`user:${candidate.user_id}`,async()=>{
      const l=(await db.q('SELECT * FROM leaves WHERE id=$1',[candidate.id])).rows[0];
      if(!['scheduled','active','starting','ending'].includes(l.status)) return;
      const ending=new Date(l.ends_at)<=new Date() || l.status==='ending';
      if(l.status==='active'&&!ending) return;
      try {
        await audit({category:ending?'zdejmijurlop':'urlop',actor:{id:client.user.id,name:'Automatycznie'},target:{id:l.user_id,name:l.ic_name},reason:ending?'Upłynął termin urlopu':'Rozpoczęcie zaplanowanego urlopu',channelId:l.channel_id},async steps=>{
          let m;
          try { m=await member(l.user_id); } catch(err) {
            if(err.code!==10007) throw err;
            await db.q("UPDATE leaves SET status='cancelled',error='Osoba opuściła serwer' WHERE id=$1",[l.id]);
            return {title:'🌴 Urlop anulowany',description:'Osoba nie należy już do serwera.'};
          }
          if(ending) { await endLeave(l,m,steps); await notify(l.channel_id,l.user_id,'☕ Twoja zmiana znów na Ciebie czeka!','Twój urlop dobiegł końca. Witamy z powrotem i zapraszamy do pracy! 🐱'); }
          else { await activate(l,m,steps); await notify(l.channel_id,l.user_id,'🌴 Czas na odpoczynek!',`Twój urlop właśnie się rozpoczął. Odpoczywaj do ${formatDate(l.ends_at)}!`); }
          return {title:ending?'☀️ Urlop zakończony automatycznie':'🌴 Urlop rozpoczęty',description:l.ic_name};
        });
      } catch(err) { await db.q("UPDATE leaves SET error=$2,retry_at=now()+interval '5 minutes' WHERE id=$1",[l.id,err.message]); }
    });
  }
  async function profile(id) {
    try { await employee(await member(id)); } catch(err) { if(err.code!==10007) throw err; }
    const e=(await db.q('SELECT user_id,username,ic_name,ssn,rank,plus_count,minus_count,status,hired_by,hired_by_name,hired_at,(proof IS NOT NULL) AS has_proof FROM employees WHERE user_id=$1',[id])).rows[0];
    if(!e) throw new UserError('Nie znaleziono pracownika.');
    const leave=(await db.q("SELECT * FROM leaves WHERE user_id=$1 AND status IN ('pending','scheduled','active','starting','ending') ORDER BY id DESC LIMIT 1",[id])).rows[0] || null;
    const history=(await db.q('SELECT * FROM logs WHERE target_id=$1 ORDER BY created_at DESC LIMIT 100',[id])).rows;
    const latest=(await db.q("SELECT DISTINCT ON (category) * FROM logs WHERE target_id=$1 AND status='success' ORDER BY category,created_at DESC",[id])).rows;
    return {employee:e,leave,history,latest};
  }
  return {guild,member,authorize,employee,run,audit,profile,decideLeave,tickLeaves,notify,proof};
}
