import test from 'node:test';
import assert from 'node:assert/strict';
import { nextPlus,rankChange,parseDate,parseLeaveDate,leaveNickname,clearLeaveNickname,imageType } from '../src/domain.js';
import { config,environment } from '../src/config.js';
import { commands } from '../src/bot.js';
test('piąty plus zeruje licznik; następny zaczyna nowy cykl',()=>{
 assert.deepEqual(nextPlus([config.plus[3]]),{before:4,after:0,reset:true});
 assert.equal(nextPlus([]).after,1);
 assert.equal(nextPlus([config.plus[4]]).after,0);
 assert.equal(nextPlus([config.plus[0],config.plus[2]]).after,4);
});
test('awanse i degradacje zatrzymują się na końcach hierarchii',()=>{
 assert.equal(rankChange([config.ranks[4].id],1).after,4);
 assert.equal(rankChange([config.ranks[0].id],-1).after,0);
 assert.equal(rankChange([config.ranks[2].id],-1).after,1);
 assert.equal(rankChange([config.ranks[1].id],1).after,2);
 assert.throws(()=>rankChange([config.staff],1));
});
test('daty są polskie, odrzucają nieistniejące i niejednoznaczne godziny DST',()=>{
 assert.equal(parseDate('30.09.2026 18:00').toISOString(),'2026-09-30T16:00:00.000Z');
 assert.equal(parseDate('30.12.2026 18:00').toISOString(),'2026-12-30T17:00:00.000Z');
 for(const bad of ['31.02.2026 10:00','29.03.2026 02:30','25.10.2026 02:30','2026-09-30','jutro'])assert.throws(()=>parseDate(bad));
});
test('dopisek urlop nie powiela się i mieści się w limicie Discord',()=>{
 assert.equal(leaveNickname('Jan Kowalski [urlop]'),'Jan Kowalski [urlop]');
 assert.ok(leaveNickname('a'.repeat(32)).length<=32);
 assert.equal(clearLeaveNickname('Jan [urlop]'),'Jan');
});
test('dowód nie przyjmuje SVG ani HTML',()=>{
 assert.throws(()=>imageType(Buffer.from('<svg onload="alert(1)">')));
 assert.throws(()=>imageType(Buffer.from('<html>')));
 assert.equal(imageType(Buffer.from([255,216,255,0])),'image/jpeg');
});
test('wszystkie uzgodnione komendy są zarejestrowane',()=>{
 assert.deepEqual(commands().map(c=>c.name).sort(),['job','plus','minus','awans','degrad','zwolnij','urlop','zdejmijurlop','szukaj','bldodaj','blszukaj','blusun'].sort());
 assert.equal(commands().find(c=>c.name==='job').options.find(o=>o.name==='zdjecie_dowodu').type,11);
});
test('konfiguracja nie uruchamia się bez sekretów',()=>assert.throws(()=>environment({}),/DISCORD_TOKEN/));

test('urlop DD.MM używa bieżącego roku i końca dnia w Polsce',()=>{
 const reference=new Date('2026-09-23T12:00:00Z');
 assert.equal(parseLeaveDate('25.09',{reference}).toISOString(),'2026-09-24T22:00:00.000Z');
 assert.equal(parseLeaveDate('25.09',{reference,end:true}).toISOString(),'2026-09-25T21:59:59.999Z');
 for(const value of ['31.02','29.02','25.09.2026','25.09 10:00']) assert.throws(()=>parseLeaveDate(value,{reference}));
});
