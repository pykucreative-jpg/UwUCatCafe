import { escapeMarkdown } from 'discord.js';
import { text,UserError } from './domain.js';

// SSN is a text identifier. Preserve leading zeroes; only normalize outer whitespace and case.
export const normalizeSsn=value=>text(value,40).normalize('NFKC').trim().toUpperCase();
export function blacklistService(db,svc) {
  async function search(ssn,page=0) {
    ssn=normalizeSsn(ssn);
    if(!Number.isSafeInteger(page)||page<0||page>100000) throw new UserError('Nieprawidłowa strona wyników.');
    const rows=(await db.q(`SELECT id,ssn,ic_name,reason,added_by,added_by_name,created_at FROM blacklist
      WHERE ssn=$1 AND removed_at IS NULL ORDER BY created_at DESC,id DESC LIMIT 5 OFFSET $2`,[ssn,page*4])).rows;
    const total=(await db.q('SELECT count(*)::int AS count FROM blacklist WHERE ssn=$1 AND removed_at IS NULL',[ssn])).rows[0].count;
    return {ssn,items:rows.slice(0,4),more:rows.length>4,total,page};
  }
  async function photo(id) {
    const entry=(await db.q('SELECT photo,photo_type FROM blacklist WHERE id=$1 AND removed_at IS NULL',[id])).rows[0];
    if(!entry) throw new UserError('Ten wpis nie jest już na czarnej liście.');
    return entry;
  }
  async function add({ssn,icName,reason,attachment,actorId,channelId,requestId}) {
    ssn=normalizeSsn(ssn);icName=text(icName,80);reason=text(reason,1000);
    return db.lock(`blacklist:${ssn}`,async()=>{
      const actor=await svc.authorize(actorId);
      const image=await svc.proof(attachment);
      return svc.audit({category:'bldodaj',actor,target:{name:icName},reason,channelId,requestId},async steps=>{
        const entry=(await db.q(`INSERT INTO blacklist(ssn,ic_name,photo,photo_type,reason,added_by,added_by_name)
          VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id`,[ssn,icName,image.bytes,image.type,reason,actor.id,actor.name])).rows[0];
        steps.push('Zapisano wpis i zdjęcie na czarnej liście');
        return {title:'🚫 Czarna lista · UwUCatCafe',description:`**${escapeMarkdown(icName)}**\n**🪪 SSN:** ${escapeMarkdown(ssn)}`,photoId:entry.id,ssn,fields:{'💬 Powód':reason,'👤 Dodano przez':`<@${actor.id}>`}};
      });
    });
  }
  async function remove({ssn,actorId,channelId,requestId}) {
    ssn=normalizeSsn(ssn);
    return db.lock(`blacklist:${ssn}`,async()=>{
      const actor=await svc.authorize(actorId);
      const entries=(await db.q('SELECT ic_name FROM blacklist WHERE ssn=$1 AND removed_at IS NULL',[ssn])).rows;
      const name=entries[0]?.ic_name || `SSN ${ssn}`;
      return svc.audit({category:'blusun',actor,target:{name},reason:'Usunięcie wszystkich aktywnych wpisów osoby z czarnej listy',channelId,requestId},async steps=>{
        if(!entries.length) return {noop:true,title:'🐾 Brak wpisów na czarnej liście',description:`Nie znaleziono aktywnych wpisów dla SSN **${escapeMarkdown(ssn)}**.`,ssn};
        await db.q('UPDATE blacklist SET removed_at=now(),removed_by=$2,removed_by_name=$3 WHERE ssn=$1 AND removed_at IS NULL',[ssn,actor.id,actor.name]);
        steps.push('Usunięto aktywne wpisy z czarnej listy');
        return {title:'🕊️ Usunięto z czarnej listy',description:`**${escapeMarkdown(name)}**\n**🪪 SSN:** ${escapeMarkdown(ssn)}`,ssn,fields:{'📋 Usunięte wpisy':String(entries.length),'👤 Usunięto przez':`<@${actor.id}>`}};
      });
    });
  }
  return {search,photo,add,remove};
}
