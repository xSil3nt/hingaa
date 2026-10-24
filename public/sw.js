// Notifications only: no background location tracking or offline map cache.
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('notificationclick',event=>{
  event.notification.close();
  event.waitUntil((async()=>{
    const tabs=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    const tab=tabs.find(c=>new URL(c.url).pathname==='/journey.html');
    if(tab)return tab.focus();return self.clients.openWindow('/journey.html');
  })());
});
