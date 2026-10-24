// Notifications only: no background location tracking or offline map cache.
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('notificationclick',event=>{
  event.notification.close();
  event.waitUntil((async()=>{
    const tabs=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    const path=event.notification.data?.path==='/new/journey'?'/new/journey':'/journey.html';
    const tab=tabs.find(c=>new URL(c.url).pathname===path);
    if(tab)return tab.focus();return self.clients.openWindow(path);
  })());
});
