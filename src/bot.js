import { Client, GatewayIntentBits, Partials, Events, SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, ChannelType, PermissionFlagsBits, MessageFlags, escapeMarkdown } from 'discord.js';
import { config, labels } from './config.js';
import { UserError, parseDate, formatDate, text } from './domain.js';
import { blacklistService } from './blacklist.js';

export const makeClient = () => new Client({intents:[GatewayIntentBits.Guilds,GatewayIntentBits.GuildMembers,GatewayIntentBits.GuildMessages,GatewayIntentBits.MessageContent],partials:[Partials.Message],allowedMentions:{parse:[]}});
export function card(result) {
  const embed=new EmbedBuilder().setColor(result.title?.includes('⚠️')?0xD5A45E:0xD98CA2).setTitle(result.title||'🐾 UwUCatCafe').setFooter({text:'🐾 UwUCatCafe'});
  if(result.description) embed.setDescription(result.description.slice(0,4000));
  if(result.fields) embed.addFields(Object.entries(result.fields).map(([name,value])=>({name,value:String(value||'—').slice(0,1024),inline:false})));
  return embed;
}
const btn=(id,label,style=ButtonStyle.Secondary)=>new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style);
const row=(...buttons)=>new ActionRowBuilder().addComponents(...buttons);
const input=(id,label,max=1000,paragraph=false)=>new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId(id).setLabel(label).setMaxLength(max).setRequired(true).setStyle(paragraph?TextInputStyle.Paragraph:TextInputStyle.Short));
export function commands() {
  const basic=(name,description)=>new SlashCommandBuilder().setName(name).setDescription(description).setDMPermission(false);
  const who=c=>c.addUserOption(o=>o.setName('osoba').setDescription('Pracownik').setRequired(true));
  const why=c=>c.addStringOption(o=>o.setName('powod').setDescription('Powód').setMaxLength(1000).setRequired(true));
  return [
    who(basic('job','🎀 Zatrudnij pracownika')).addAttachmentOption(o=>o.setName('zdjecie_dowodu').setDescription('Zdjęcie dowodu postaci IC, do 8 MB').setRequired(true)).addStringOption(o=>o.setName('imie_i_nazwisko_ic').setDescription('Imię i nazwisko postaci').setMaxLength(32).setRequired(true)).addStringOption(o=>o.setName('ssn').setDescription('SSN postaci IC').setMaxLength(40).setRequired(true)),
    ...[['plus','🌟 Przyznaj plus'],['minus','⚠️ Wystaw minus'],['awans','✨ Awansuj o jeden stopień'],['degrad','↘️ Degraduj o jeden stopień'],['zwolnij','📋 Zwolnij i usuń z serwera'],['zdejmijurlop','☀️ Zakończ urlop ręcznie']].map(([name,description])=>why(who(basic(name,description)))),
    who(basic('urlop','🌴 Przyznaj urlop od teraz')).addStringOption(o=>o.setName('do_kiedy').setDescription('DD.MM.RRRR GG:MM — czas polski').setRequired(true)),
    who(basic('szukaj','🐱 Profil i historia pracownika')),
    basic('bldodaj','🚫 Dodaj osobę na czarną listę')
      .addStringOption(o=>o.setName('imie_i_nazwisko').setDescription('Imię i nazwisko postaci IC').setMaxLength(80).setRequired(true))
      .addAttachmentOption(o=>o.setName('zdjecie').setDescription('Zdjęcie PNG, JPG lub WebP, do 8 MB').setRequired(true))
      .addStringOption(o=>o.setName('powod').setDescription('Powód wpisu').setMaxLength(1000).setRequired(true))
      .addStringOption(o=>o.setName('ssn').setDescription('SSN postaci IC').setMaxLength(40).setRequired(true)),
    ...[['blszukaj','🔎 Wyszukaj powody wpisów po SSN'],['blusun','🕊️ Usuń osobę z czarnej listy']].map(([name,description])=>basic(name,description).addStringOption(o=>o.setName('ssn').setDescription('SSN postaci IC').setMaxLength(40).setRequired(true)))
  ].map(c=>c.toJSON());
}
export function bot(db,client,svc,env) {
  const bl=blacklistService(db,svc);
  async function blacklistPayload(result) {
    if(!result.photoId) return {embeds:[card(result)]};
    const image=await bl.photo(result.photoId);
    const ext={'image/png':'png','image/jpeg':'jpg','image/webp':'webp'}[image.photo_type];
    const file=`zdjecie.${ext}`;
    const person=card(result).setImage(`attachment://${file}`);
    return {files:[{attachment:Buffer.from(image.photo),name:file}],embeds:[person]};
  }
  async function blacklistResults(ssn,page=0) {
    const result=await bl.search(ssn,page);
    if(!result.total) return {embeds:[card({title:'🔎 Czarna lista',description:`Brak aktywnych wpisów dla SSN **${escapeMarkdown(result.ssn)}**.`})],components:[]};
    const description=`**${escapeMarkdown(result.items[0]?.ic_name||'')}**\n**🪪 SSN:** ${escapeMarkdown(result.ssn)} · **Wpisy:** ${result.total}`;
    // Store only a database reference in custom IDs, so arbitrary SSNs cannot break pagination.
    const ref=result.items[0]?.id;
    const fields=Object.fromEntries(result.items.map((e,index)=>[`${page*4+index+1}. Powód · 📅 ${formatDate(e.created_at)}`,e.reason]));
    return {embeds:[card({title:'🚫 Czarna lista',description,fields})],components:ref&&(page>0||result.more)?[row(btn(`blpage:${ref}:${Math.max(0,page-1)}`,'← Poprzednia').setDisabled(page===0),btn(`blpage:${ref}:${page+1}`,'Następna →').setDisabled(!result.more))]:[]};
  }
  const profileButtons=id=>row(...[['plus','🌟 Plusy'],['minus','⚠️ Minusy'],['awans','↗️ Awanse'],['degrad','↘️ Degradacje'],['all','📋 Historia']].map(([category,label])=>btn(`history:${id}:${category}:0`,label)));
  const ticketButtons=t=>t.kind==='leave'?row(btn(`approve:${t.leave_id}`,'✅ Zatwierdź',ButtonStyle.Success),btn(`reject:${t.leave_id}`,'❌ Odrzuć',ButtonStyle.Danger),btn(`close:${t.id}`,'🔒 Zamknij zgłoszenie')):row(btn(`close:${t.id}`,'🔒 Zamknij zgłoszenie'));
  async function showProfile(id) {
    const p=await svc.profile(id), e=p.employee, l=p.leave;
    const latest=category=>p.latest.find(x=>x.category===category);
    const describe=log=>log?`${formatDate(log.created_at)}\n${escapeMarkdown(log.reason || log.details.description || '—')}\nWykonano przez <@${log.actor_id}>${log.details.fields?.['☕ Stanowisko']?'\n'+log.details.fields['☕ Stanowisko']:''}`:'Brak wpisów.';
    const status=e.status==='dismissed'?'Zwolniony/a':l?.status==='active'?'Tak':l?'Zaplanowany / oczekujący':'Nie · W pracy';
    return {embeds:[card({title:'🐱 Profil pracownika',description:`**${escapeMarkdown(e.ic_name)}** · <@${id}>`,fields:{'☕ Stanowisko':e.rank||'—','🎀 Zatrudniony przez':e.hired_by?`<@${e.hired_by}> · ${formatDate(e.hired_at)}`:'Brak danych o zatrudnieniu','🌴 Urlop':`${status}${l?'\n'+formatDate(l.starts_at)+' → '+formatDate(l.ends_at):''}${l?.approved_by?'\nZatwierdził(a): <@'+l.approved_by+'>':''}`,'🌟 Plusy / ⚠️ Minusy':`${e.plus_count}/5 · ${e.minus_count}/2`,'✨ Ostatni plus':describe(latest('plus')),'↗️ Ostatni awans':describe(latest('awans')),'⚠️ Ostatni minus':describe(latest('minus')),'↘️ Ostatnia degradacja':describe(latest('degrad')),...(e.status==='dismissed'?{'📋 Zakończenie współpracy':describe(latest('zwolnij')||latest('minus'))}:{})}})],components:[profileButtons(id)]};
  }
  async function history(id,category,page) {
    if(!/^\d{17,20}$/.test(id)||!['all','plus','minus','awans','degrad'].includes(category)||!Number.isSafeInteger(page)||page<0||page>10000) throw new UserError('Nieprawidłowa strona historii.');
    const logs=(await db.q("SELECT * FROM logs WHERE target_id=$1 AND ($2='all' OR category=$2) ORDER BY created_at DESC LIMIT 6 OFFSET $3",[id,category,page*5])).rows;
    const body=logs.slice(0,5).map(l=>`**${labels[l.category]||l.category} · ${formatDate(l.created_at)}**\n${escapeMarkdown(l.reason||l.details.description||'—').slice(0,350)}\nWykonano przez <@${l.actor_id}> · ${l.status==='success'?'Wykonano':l.status==='noop'?'Bez zmian':'Sprawdź wynik w panelu'}`).join('\n\n') || 'Brak wpisów w tej kategorii.';
    return {embeds:[card({title:'📋 Historia pracownika',description:body})],components:[profileButtons(id),row(btn(`history:${id}:${category}:${Math.max(0,page-1)}`,'← Poprzednia').setDisabled(page===0),btn(`history:${id}:${category}:${page+1}`,'Następna →').setDisabled(logs.length<=5))]};
  }
  async function createTicket(i,kind) {
    return db.lock(`user:${i.user.id}`,async()=>{
      const existing=(await db.q("SELECT * FROM tickets WHERE user_id=$1 AND kind=$2 AND status='open'",[i.user.id,kind])).rows[0];
      if(existing) throw new UserError(`Masz już otwarte zgłoszenie${existing.channel_id?' na <#'+existing.channel_id+'>':''}.`);
      const name=text(i.fields.getTextInputValue('name'),80);
      const body=text(i.fields.getTextInputValue('body'),1000);
      let starts,ends;
      if(kind==='leave') {
        starts=parseDate(i.fields.getTextInputValue('from')); ends=parseDate(i.fields.getTextInputValue('to'));
        if(ends<=starts||ends<=new Date()) throw new UserError('Koniec urlopu musi wypadać po rozpoczęciu i w przyszłości.');
        if((await db.q("SELECT id FROM leaves WHERE user_id=$1 AND status IN ('pending','scheduled','active','starting','ending')",[i.user.id])).rowCount) throw new UserError('Masz już urlop lub wniosek oczekujący na decyzję.');
      }
      const subject=kind==='leave'?'Wniosek urlopowy':text(i.fields.getTextInputValue('subject'),100);
      const actor={id:i.user.id,name:i.user.username};
      return svc.audit({category:'ticket',actor,target:{id:i.user.id,name},reason:subject,channelId:i.channelId,requestId:i.id},async steps=>{
        const g=await svc.guild();
        const channel=await g.channels.create({name:`${kind==='leave'?'urlop':'kontakt'}-${name.toLowerCase().replace(/[^a-z0-9ąćęłńóśźż]+/g,'-').slice(0,65)}`,type:ChannelType.GuildText,parent:kind==='leave'?config.leaveCategory:config.contactCategory,
          permissionOverwrites:[{id:g.id,deny:[PermissionFlagsBits.ViewChannel]},{id:i.user.id,allow:[PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages,PermissionFlagsBits.ReadMessageHistory,PermissionFlagsBits.AttachFiles]},{id:config.staff,allow:[PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages,PermissionFlagsBits.ReadMessageHistory]},{id:client.user.id,allow:[PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages,PermissionFlagsBits.ReadMessageHistory,PermissionFlagsBits.ManageChannels,PermissionFlagsBits.EmbedLinks]}]});
        let t;
        try {
          t=await db.transaction(async tx=>{
            let leave=null;
            if(kind==='leave') leave=(await tx.query('INSERT INTO leaves(user_id,ic_name,starts_at,ends_at,reason,channel_id) VALUES($1,$2,$3,$4,$5,$6) RETURNING id',[i.user.id,name,starts,ends,body,channel.id])).rows[0];
            return (await tx.query('INSERT INTO tickets(user_id,ic_name,kind,subject,body,channel_id,leave_id) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',[i.user.id,name,kind,subject,body,channel.id,leave?.id])).rows[0];
          });
        } catch(err) { await channel.delete('Nie udało się zapisać zgłoszenia').catch(()=>{}); throw err; }
        steps.push('Utworzono prywatny kanał zgłoszenia');
        const message=await channel.send({embeds:[card({title:kind==='leave'?'🌴 Wniosek o chwilę odpoczynku':'💌 Porozmawiajmy!',description:`<@${i.user.id}>, Twoja sprawa czeka na zarząd. 🤍`,fields:{'🐱 Imię i nazwisko IC':escapeMarkdown(name),...(kind==='leave'?{'📅 Od':formatDate(starts),'📅 Do':formatDate(ends)}:{'📝 Temat':escapeMarkdown(subject)}),'💬 Treść':escapeMarkdown(body),'🕓 Status':'Oczekuje na rozpatrzenie'}})],components:[ticketButtons(t)]});
        await db.q('UPDATE tickets SET message_id=$2 WHERE id=$1',[t.id,message.id]);
        return {title:'💌 Zgłoszenie utworzone',description:`Przejdź do <#${channel.id}>. Czekamy na Ciebie! ☕`};
      });
    });
  }
  async function saveMessage(m) {
    if(!m.guildId||m.guildId!==env.guildId||m.author?.bot) return;
    const t=(await db.q('SELECT id FROM tickets WHERE channel_id=$1',[m.channelId])).rows[0];
    if(!t) return;
    await db.q(`INSERT INTO ticket_messages(message_id,ticket_id,author_id,author_name,body,attachments,created_at,edited_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)
      ON CONFLICT(message_id) DO UPDATE SET body=$5,attachments=$6,edited_at=$8`,[m.id,t.id,m.author.id,m.author.username,m.content,JSON.stringify([...m.attachments.values()].map(a=>({name:a.name,url:a.url}))),m.createdAt,m.editedAt]);
  }
  async function closeTicket(id,actorId,reason) {
    const actor=await svc.authorize(actorId);
    return db.lock(`ticket:${id}`,async()=>{
      const t=(await db.q('SELECT * FROM tickets WHERE id=$1',[id])).rows[0];
      if(!t||t.status==='closed') throw new UserError('Zgłoszenie jest już zamknięte lub nie istnieje.');
      if(t.leave_id) {
        const l=(await db.q('SELECT status FROM leaves WHERE id=$1',[t.leave_id])).rows[0];
        if(l?.status==='pending') throw new UserError('Najpierw zatwierdź albo odrzuć wniosek urlopowy.');
      }
      return svc.audit({category:'ticket',actor,target:{id:t.user_id,name:t.ic_name},reason:text(reason),channelId:t.channel_id},async steps=>{
        const channel=await client.channels.fetch(t.channel_id);
        if(!channel) throw new UserError('Nie znaleziono kanału zgłoszenia.');
        // Backfill missed messages after downtime before locking the channel; keep the channel as an archive.
        let before;
        for(;;) {
          const messages=await channel.messages.fetch({limit:100,...(before?{before}:{})});
          for(const m of messages.values()) await saveMessage(m);
          if(messages.size<100) break;
          before=messages.last().id;
        }
        await channel.permissionOverwrites.edit(t.user_id,{SendMessages:false}); steps.push('Zamknięto możliwość pisania');
        await channel.send({embeds:[card({title:'🔒 Zgłoszenie zamknięte',description:`Dziękujemy za kontakt! ☕\n**Powód:** ${escapeMarkdown(reason)}\n**Zamknięto przez:** <@${actorId}>`})]});
        await db.q("UPDATE tickets SET status='closed',closed_at=now() WHERE id=$1",[id]);
        if(t.message_id) await channel.messages.edit(t.message_id,{components:[]}).catch(()=>{});
        return {title:'🔒 Zgłoszenie zamknięte',description:'Rozmowa została zachowana w panelu.'};
      });
    });
  }
  async function panel() {
    const channel=await client.channels.fetch(config.panel);
    const payload={embeds:[card({title:'🐱 UwUCatCafe · Kącik pracownika',description:'Potrzebujesz porozmawiać z zarządem albo zaplanować chwilę odpoczynku? Jesteś w dobrym miejscu. 🤍\n\n**💌 Kontakt z zarządem**\nMasz pytanie, pomysł lub sprawę do wyjaśnienia? Napisz do nas.\n\n**🌴 Wniosek urlopowy**\nPodaj termin nieobecności i powód, a zarząd rozpatrzy Twój wniosek.\n\nWybierz przycisk i wypełnij krótki formularz. Zgłoszenie zobaczysz Ty i uprawniona kadra.'})],components:[row(btn('open:contact','💌 Kontakt z zarządem'),btn('open:leave','🌴 Wniosek urlopowy'))]};
    const old=(await db.q("SELECT value FROM settings WHERE key='ticket_panel'")).rows[0]?.value;
    if(old) { try {await channel.messages.edit(old,payload); return;} catch(err) {if(err.code!==10008) throw err;} }
    const m=await channel.send(payload);
    await db.q("INSERT INTO settings(key,value) VALUES('ticket_panel',$1) ON CONFLICT(key) DO UPDATE SET value=$1",[m.id]);
  }
  async function deliveries() {
    const decisions=(await db.q(`SELECT t.*,l.status AS leave_status,l.approved_by_name FROM tickets t JOIN leaves l ON l.id=t.leave_id
      WHERE t.message_id IS NOT NULL AND t.displayed_leave_status IS DISTINCT FROM l.status LIMIT 25`)).rows;
    for(const t of decisions) {
      try {
        const channel=await client.channels.fetch(t.channel_id);
        const message=await channel.messages.fetch(t.message_id);
        const statuses={pending:'Oczekuje na decyzję',scheduled:'Zatwierdzony · zaplanowany',active:'Zatwierdzony · w trakcie',starting:'Rozpoczynanie urlopu',ending:'Kończenie urlopu',ended:'Urlop zakończony',rejected:'Wniosek odrzucony',cancelled:'Urlop anulowany'};
        const embed=EmbedBuilder.from(message.embeds[0]);
        embed.setFields(...embed.data.fields.filter(f=>!['🕓 Status','🎀 Decyzja'].includes(f.name)),{name:'🕓 Status',value:statuses[t.leave_status]||t.leave_status},...(t.approved_by_name?[{name:'🎀 Decyzja',value:escapeMarkdown(t.approved_by_name)}]:[]));
        await message.edit({embeds:[embed],components:t.status==='closed'?[]:[t.leave_status==='pending'?ticketButtons(t):row(btn(`close:${t.id}`,'🔒 Zamknij zgłoszenie'))]});
        await db.q('UPDATE tickets SET displayed_leave_status=$2 WHERE id=$1',[t.id,t.leave_status]);
      } catch(err) {console.error('Aktualizacja wniosku',t.id,err.code||err.name);}
    }
    const logs=(await db.q("SELECT * FROM logs WHERE delivered=false AND status!='pending' ORDER BY id LIMIT 25")).rows;
    for(const l of logs) {
      try {
        const ch=await client.channels.fetch(config.logs);
        const result=l.details;
        await ch.send({embeds:[card({title:labels[l.category]||'📋 Historia',fields:{'🐱 Osoba':l.target_id?`<@${l.target_id}> · ${escapeMarkdown(l.target_name||'')}`:escapeMarkdown(l.target_name||'—'),'👤 Wykonano przez':`<@${l.actor_id}> · ${escapeMarkdown(l.actor_name)}`,'💬 Powód':escapeMarkdown(l.reason||'—'),'📋 Wynik':l.status==='success'?'Wykonano':l.status==='noop'?'Bez zmian':result.error||'Nie ukończono','☕ Szczegóły':result.fields?.['☕ Stanowisko'] || result.description || result.steps?.join(' · ') || '—','🕒 Data':formatDate(l.created_at)}})]});
        await db.q('UPDATE logs SET delivered=true WHERE id=$1',[l.id]);
      } catch(err) { console.error('Nie wysłano logu',l.id,err.code||err.name); break; }
    }
    const pending=(await db.q('SELECT * FROM notifications WHERE delivered=false ORDER BY id LIMIT 25')).rows;
    for(const n of pending) {
      try {
        const channel=await client.channels.fetch(n.channel_id);
        await channel.send({content:n.user_id?`<@${n.user_id}>`:undefined,allowedMentions:{users:n.user_id?[n.user_id]:[],parse:[]},embeds:[card({title:n.title,description:n.body})]});
        await db.q('UPDATE notifications SET delivered=true WHERE id=$1',[n.id]);
      } catch(err) {console.error('Nie wysłano powiadomienia',n.id,err.code||err.name);}
    }
  }
  client.on(Events.MessageCreate,m=>saveMessage(m).catch(e=>console.error('Zapis rozmowy',e.code||e.name)));
  client.on(Events.MessageUpdate,(_,m)=>{if(!m.partial) saveMessage(m).catch(e=>console.error('Edycja rozmowy',e.code||e.name));});
  client.on(Events.MessageDelete,m=>db.q('UPDATE ticket_messages SET deleted=true WHERE message_id=$1',[m.id]).catch(e=>console.error('Usunięcie wiadomości',e.code||e.name)));
  client.on(Events.InteractionCreate,async i=>{
    if(!i.inGuild()||i.guildId!==env.guildId) return;
    try {
      if(i.isChatInputCommand()) {
        await i.deferReply({flags:MessageFlags.Ephemeral});
        await svc.authorize(i.user.id);
        if(['bldodaj','blszukaj','blusun'].includes(i.commandName)) {
          const ssn=i.options.getString('ssn',true);
          if(i.commandName==='blszukaj') {await i.editReply(await blacklistResults(ssn));return;}
          const args={ssn,actorId:i.user.id,channelId:i.channelId,requestId:i.id};
          const result=i.commandName==='blusun'?await bl.remove(args):await bl.add({...args,icName:i.options.getString('imie_i_nazwisko',true),reason:i.options.getString('powod',true),attachment:i.options.getAttachment('zdjecie',true)});
          const payload=await blacklistPayload(result);
          try {await i.channel.send(payload);await i.editReply({content:'🐾 Gotowe — wiadomość pojawiła się na kanale.'});}
          catch {await i.editReply({content:'Wpis zapisano, ale nie udało się wysłać wiadomości na kanał.',...payload});}
          return;
        }
        const target=i.options.getUser('osoba',true);
        if(i.commandName==='szukaj') { await i.editReply(await showProfile(target.id)); return; }
        const result=await svc.run({kind:i.commandName,actorId:i.user.id,targetId:target.id,reason:i.options.getString('powod')||'',channelId:i.channelId,requestId:i.id,icName:i.options.getString('imie_i_nazwisko_ic'),ssn:i.options.getString('ssn'),attachment:i.options.getAttachment('zdjecie_dowodu'),endsAt:i.commandName==='urlop'?parseDate(i.options.getString('do_kiedy')):undefined});
        // /job's attachment and SSN remain in the ephemeral command; only the sanitized card is public.
        try {await i.channel.send({embeds:[card(result)]}); await i.editReply({content:'🐾 Gotowe — wiadomość pojawiła się na kanale.'});}
        catch {await i.editReply({content:'Działanie zapisano, ale nie udało się wysłać wiadomości na ten kanał.',embeds:[card(result)]});}
      } else if(i.isButton()) {
        const [action,id,category,page]=i.customId.split(':');
        if(action==='open') {
          const modal=new ModalBuilder().setCustomId(`form:${id}`).setTitle(id==='leave'?'🌴 Wniosek urlopowy':'💌 Kontakt z zarządem');
          modal.addComponents(input('name','Imię i nazwisko IC',80));
          if(id==='leave') modal.addComponents(input('from','Od kiedy? DD.MM.RRRR GG:MM',16),input('to','Do kiedy? DD.MM.RRRR GG:MM',16),input('body','Powód urlopu',1000,true));
          else modal.addComponents(input('subject','Temat sprawy',100),input('body','W czym możemy pomóc?',1000,true));
          await i.showModal(modal); return;
        }
        if(['reject','close'].includes(action)) {
          await svc.authorize(i.user.id);
          await i.showModal(new ModalBuilder().setCustomId(`${action}form:${id}`).setTitle(action==='reject'?'Odrzucenie urlopu':'Zamknięcie zgłoszenia').addComponents(input('reason','Powód',1000,true))); return;
        }
        if(action==='blpage') {await svc.authorize(i.user.id);await i.deferUpdate();}
        else {await i.deferReply({flags:MessageFlags.Ephemeral}); await svc.authorize(i.user.id);}
        if(action==='history') await i.editReply(await history(id,category,Number(page)));
        else if(action==='blpage') {
          const entry=(await db.q('SELECT ssn FROM blacklist WHERE id=$1 AND removed_at IS NULL',[id])).rows[0];
          if(!entry) throw new UserError('Ten wpis został usunięty. Wyszukaj SSN ponownie.');
          await i.editReply(await blacklistResults(entry.ssn,Number(category)));
        }
        else if(action==='approve') {
          const result=await svc.decideLeave(id,'approve',i.user.id); await i.editReply({embeds:[card(result)]});
        }
      } else if(i.isModalSubmit()) {
        await i.deferReply({flags:MessageFlags.Ephemeral});
        const [action,id]=i.customId.split(':'); let result;
        if(action==='form'&&['leave','contact'].includes(id)) result=await createTicket(i,id);
        else if(action==='rejectform') result=await svc.decideLeave(id,'reject',i.user.id,i.fields.getTextInputValue('reason'));
        else if(action==='closeform') result=await closeTicket(id,i.user.id,i.fields.getTextInputValue('reason'));
        else throw new UserError('Nieznany formularz.');
        await i.editReply({embeds:[card(result)]});
      }
    } catch(err) {
      console.error('Obsługa Discord',err.code||err.name);
      const payload={embeds:[card({title:'🐾 Nie udało się wykonać działania',description:err instanceof UserError?err.message:'Sprawdź konfigurację i uprawnienia bota. Szczegóły zapisano w historii, jeśli działanie zostało rozpoczęte.'})],components:[]};
      try {if(i.deferred||i.replied) await i.editReply(payload); else await i.reply({...payload,flags:MessageFlags.Ephemeral});} catch {}
    }
  });
  return {panel,deliveries,closeTicket,commands};
}
