const CACHE='oberliga-c573e54bd59c';
const ASSETS=["/_expo/static/js/web/AppEntry-cf97aad100c89e201adbe7fda8ea54c3.js","/_headers","/datenschutz.html","/favicon.ico","/icons/icon-192.png","/icons/icon-512.png","/impressum.html","/index.html","/manifest.json","/metadata.json","/quickstart.html"];
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
