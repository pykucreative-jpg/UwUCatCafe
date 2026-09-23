import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
for(const folder of ['src','public','scripts','test']) for(const file of readdirSync(folder)) if(/\.(m?js)$/.test(file)) {
 const r=spawnSync(process.execPath,['--check',`${folder}/${file}`],{stdio:'inherit'}); if(r.status) process.exit(r.status);
}
console.log('Składnia wszystkich plików jest poprawna.');
