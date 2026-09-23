export const config = {
  staff: '1552233307713044520', employee: '1552233392131539004',
  ranks: [
    { id: '1552034486076702862', name: 'Praktykant' },
    { id: '1552034486076702863', name: 'Kelner' },
    { id: '1552034486076702864', name: 'Młodszy kucharz' },
    { id: '1552034486076702865', name: 'Kucharz' },
    { id: '1552034486076702866', name: 'Szef kuchni' }
  ],
  plus: ['1552034486064128128','1552034486064128127','1552034486064128126','1552034486064128125','1552034486064128124'],
  minus: ['1552034486076702860','1552034486064128129'],
  leave: '1552034486064128122', logs: '1552034487641178142',
  panel: '1552236701324148746', contactCategory: '1552240703168454707', leaveCategory: '1552240890062315531'
};
export const labels = { job:'🎀 Zatrudnienie', plus:'🌟 Plus', minus:'⚠️ Minus', awans:'✨ Awans', degrad:'↘️ Degradacja', zwolnij:'📋 Zwolnienie', urlop:'🌴 Urlop', zdejmijurlop:'☀️ Zakończenie urlopu', ticket:'💌 Zgłoszenie' };
export function environment(env = process.env) {
  for (const key of ['DISCORD_TOKEN','DISCORD_CLIENT_ID','DISCORD_CLIENT_SECRET','DISCORD_GUILD_ID','DATABASE_URL','PUBLIC_URL']) {
    if (!env[key]) throw new Error(`Uzupełnij zmienną ${key}.`);
  }
  for (const key of ['DISCORD_CLIENT_ID','DISCORD_GUILD_ID']) if (!/^\d{17,20}$/.test(env[key])) throw new Error(`Nieprawidłowe ${key}.`);
  const url = new URL(env.PUBLIC_URL);
  if (env.NODE_ENV === 'production' && url.protocol !== 'https:') throw new Error('PUBLIC_URL musi używać HTTPS.');
  return { token:env.DISCORD_TOKEN, clientId:env.DISCORD_CLIENT_ID, clientSecret:env.DISCORD_CLIENT_SECRET, guildId:env.DISCORD_GUILD_ID, databaseUrl:env.DATABASE_URL, publicUrl:url.origin, port:Number(env.PORT || 3000), production:env.NODE_ENV === 'production' };
}
