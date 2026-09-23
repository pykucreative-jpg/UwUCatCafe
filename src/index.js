import { Events } from 'discord.js';
import { environment } from './config.js';
import { database } from './db.js';
import { service } from './service.js';
import { makeClient,bot } from './bot.js';
import { web } from './web.js';
import { sessionKey } from './session-key.js';
const env=environment();
const db=database(env.databaseUrl); await db.init();
env.sessionSecret=await sessionKey(db);
const client=makeClient();
const svc=service(db,client,env);
const discord=bot(db,client,svc,env);
let initialized=false,working=false;
const server=web(db,svc,discord,env,()=>initialized&&client.isReady()).listen(env.port,'0.0.0.0',()=>console.log('Panel UwUCatCafe uruchomiony.'));
client.once(Events.ClientReady,async()=>{
  try {
    const guild=await svc.guild(); await guild.commands.set(discord.commands());
    await discord.panel(); initialized=true;
    console.log('Bot UwUCatCafe gotowy.');
  }catch(err){console.error('Nie udało się uruchomić bota',err.code||err.name);await shutdown(1);}
});
const timer=setInterval(async()=>{
  if(!initialized||!client.isReady()||working) return;
  working=true;
  try{await svc.tickLeaves();await discord.deliveries();}catch(err){console.error('Zadania cykliczne',err.code||err.name);}finally{working=false;}
},15000);
async function shutdown(code=0){clearInterval(timer);initialized=false;client.destroy();server.close();await db.pool.end();process.exit(code);}
process.on('SIGTERM',()=>shutdown()); process.on('SIGINT',()=>shutdown());
client.on(Events.Error,err=>console.error('Discord',err.code||err.name));
await client.login(env.token).catch(async err=>{console.error('Logowanie bota nie powiodło się',err.code||err.name);await shutdown(1);});
