import { DateTime } from 'luxon';
import { config } from './config.js';
export class UserError extends Error {}
export const text = (value, max=1000) => {
  const s = String(value ?? '').trim();
  if (!s || s.length > max) throw new UserError(`Pole musi mieć od 1 do ${max} znaków.`);
  return s;
};
export function parseLeaveDate(value,{end=false,reference=new Date()}={}) {
  const raw=text(value,5);
  const year=DateTime.fromJSDate(reference,{zone:'Europe/Warsaw'}).year;
  const dt=DateTime.fromFormat(`${raw}.${year}`,'dd.MM.yyyy',{zone:'Europe/Warsaw'});
  if(!/^\d{2}\.\d{2}$/.test(raw)||!dt.isValid||dt.toFormat('dd.MM')!==raw) throw new UserError('Podaj prawidłową datę DD.MM, np. 25.09. Rok jest uzupełniany automatycznie.');
  return (end?dt.endOf('day'):dt.startOf('day')).toJSDate();
}
export function parseDate(value) {
  const raw = text(value, 16);
  const dt = DateTime.fromFormat(raw, 'dd.MM.yyyy HH:mm', { zone:'Europe/Warsaw', locale:'pl' });
  if (!dt.isValid || dt.toFormat('dd.MM.yyyy HH:mm') !== raw || dt.getPossibleOffsets().length > 1) throw new UserError('Podaj jednoznaczną datę DD.MM.RRRR GG:MM, według czasu polskiego.');
  return dt.toJSDate();
}
export const formatDate = value => value ? DateTime.fromJSDate(new Date(value), { zone:'Europe/Warsaw' }).toFormat('dd.MM.yyyy HH:mm') : '—';
export const highest = (ids, roleIds) => ids.reduce((result,id,i) => roleIds.includes(id) ? i+1 : result, 0);
export function nextPlus(roleIds) {
  const before = highest(config.plus, roleIds);
  return { before, after:before >= 4 ? 0 : before+1, reset:before >= 4 };
}
export function rankChange(roleIds, direction) {
  const index = highest(config.ranks.map(r=>r.id), roleIds)-1;
  if (index < 0) throw new UserError('Ta osoba nie ma stanowiska pracowniczego.');
  return { before:index, after:Math.max(0, Math.min(config.ranks.length-1, index+direction)) };
}
export const leaveNickname = nick => `${nick.replace(/\s*\[urlop\]/gi,'').trim().slice(0,24)} [urlop]`;
export const clearLeaveNickname = nick => nick?.replace(/\s*\[urlop\]/gi,'').trim() || null;
export function imageType(buffer) {
  if (buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'image/png';
  if (buffer[0]===255 && buffer[1]===216 && buffer[2]===255) return 'image/jpeg';
  if (buffer.subarray(0,4).toString()==='RIFF' && buffer.subarray(8,12).toString()==='WEBP') return 'image/webp';
  throw new UserError('Dowód musi być zdjęciem PNG, JPG albo WebP.');
}
