// Local-only, read-only visual preview. Never included in the production Docker image.
import express from 'express';
import { labels } from '../src/config.js';
const app=express();const now=new Date().toISOString();
const staff=[['Jan Kowalski','jan.k','Kucharz',2,1,'Anna Nowak'],['Julia Wiśniewska','julia.uwu','Kelner',3,0,'Anna Nowak'],['Michał Zieliński','michal.z','Szef kuchni',1,0,'Ola Mazur'],['Zofia Wójcik','zosia','Młodszy kucharz',0,0,'Anna Nowak'],['Oliwier Nowak','oliwier.n','Praktykant',1,0,'Ola Mazur']].map((r,i)=>({user_id:String(222222222222222220n+BigInt(i)),ic_name:r[0],username:r[1],rank:r[2],plus_count:r[3],minus_count:r[4],hired_by_name:r[5],hired_by:'111111111111111111',hired_at:now,status:'active',leave_status:i===2?'active':null,ssn:'IC-1024',has_proof:false}));
const activity=['awans','plus','urlop','job','minus'].map((category,i)=>({id:i+1,category,actor_id:'111111111111111111',actor_name:i%2?'Ola Mazur':'Anna Nowak',target_id:staff[i].user_id,target_name:staff[i].ic_name,reason:['Samodzielność i świetna organizacja pracy.','Pomoc przy obsłudze wieczornego wydarzenia.','Wyjazd rodzinny.','Witamy w naszym zespole!','Spóźnienie na zmianę bez zgłoszenia.'][i],created_at:now,status:'success',details:{fields:category==='awans'?{'☕ Stanowisko':'Młodszy kucharz → Kucharz'}:{}}}));
const leaves=[{id:1,user_id:staff[0].user_id,ic_name:'Jan Kowalski',starts_at:'2026-09-25T08:00:00Z',ends_at:'2026-09-30T16:00:00Z',reason:'Wyjazd rodzinny — kilka dni poza miastem.',status:'pending'},{id:2,user_id:staff[2].user_id,ic_name:'Michał Zieliński',starts_at:now,ends_at:'2026-09-29T16:00:00Z',reason:'Krótki odpoczynek.',status:'active',approved_by_name:'Anna Nowak'}];
app.use((req,res,next)=>{res.set('Cache-Control','no-store');if(req.method!=='GET')return res.status(403).json({error:'To lokalny podgląd z przykładowymi danymi. Zmiany są wyłączone.'});next();});
app.get('/api/me',(req,res)=>res.json({user:{name:'Anna Nowak',id:'111111111111111111'},csrf:'preview',labels,demo:true}));
app.get('/api/overview',(req,res)=>res.json({employees:24,leaves:3,tickets:5,activity,requests:[leaves[0]]}));
app.get('/api/employees',(req,res)=>res.json({items:req.query.status==='dismissed'?[]:staff.filter(e=>JSON.stringify(e).toLowerCase().includes(String(req.query.q||'').toLowerCase())),more:false}));
app.get('/api/employees/:id',(req,res)=>res.json({employee:staff.find(e=>e.user_id===req.params.id)||staff[0],leave:leaves.find(l=>l.user_id===req.params.id)||null,history:activity.filter(l=>l.target_id===req.params.id)}));
app.get('/api/logs',(req,res)=>res.json({items:activity.filter(l=>(!req.query.category||l.category===req.query.category)&&JSON.stringify(l).toLowerCase().includes(String(req.query.q||'').toLowerCase())),more:false}));
app.get('/api/leaves',(req,res)=>res.json({items:leaves.filter(l=>!req.query.status||l.status===req.query.status)}));
app.get('/api/tickets',(req,res)=>res.json({items:[]}));
app.use(express.static('public'));
app.listen(3000,'127.0.0.1',()=>console.log('Podgląd: http://127.0.0.1:3000 — dane przykładowe, zapis wyłączony.'));
