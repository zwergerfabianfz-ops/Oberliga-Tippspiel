import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve('dist');
const files = await walk(root);
const publicFiles = files
  .map(file => `/${path.relative(root, file).split(path.sep).join('/')}`)
  .filter(file => file !== '/sw.js' && !file.endsWith('.map'));
const digest = createHash('sha256');
for (const file of files.filter(file => !file.endsWith('sw.js') && !file.endsWith('.map'))) {
  digest.update(path.relative(root, file));
  digest.update(await readFile(file));
}
const hash = digest.digest('hex').slice(0, 12);
const source = `const CACHE='oberliga-${hash}';
const ASSETS=${JSON.stringify(publicFiles)};
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS)).then(()=>self.skipWaiting()))});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET'||new URL(event.request.url).origin!==self.location.origin)return;
  if(event.request.mode==='navigate'){
    event.respondWith(fetch(event.request).catch(()=>caches.match('/index.html')));
    return;
  }
  event.respondWith(caches.match(event.request).then(cached=>cached||fetch(event.request)));
});
self.addEventListener('push',event=>{
  const data=event.data?.json()||{};
  event.waitUntil(self.registration.showNotification(data.title||'Oberliga Tippspiel',{
    body:data.body||'Ein Spiel beginnt bald und dein Tipp fehlt noch.',
    icon:'/icons/icon-192.png',badge:'/icons/icon-192.png',data:{url:data.url||'/'},tag:'tip-reminder'
  }));
});
self.addEventListener('notificationclick',event=>{
  event.notification.close();
  const target=new URL(event.notification.data?.url||'/',self.location.origin).href;
  event.waitUntil(clients.matchAll({type:'window',includeUncontrolled:true}).then(windows=>{
    const existing=windows.find(client=>client.url.startsWith(self.location.origin));
    return existing?existing.focus().then(()=>existing.navigate(target)):clients.openWindow(target);
  }));
});
`;
await writeFile(path.join(root, 'sw.js'), source);
console.log(`Generated dist/sw.js with ${publicFiles.length} cached files.`);

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(entry => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(target) : target;
  }));
  return nested.flat();
}
