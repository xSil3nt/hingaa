// Notifications only: no background location tracking or offline map cache.
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('notificationclick',event=>{
  event.notification.close();
  event.waitUntil((async()=>{
    const tabs=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    const path='/journey.html';
    const tab=tabs.find(c=>['/journey.html','/new/journey','/new/journey/'].includes(new URL(c.url).pathname));
    if(tab)return tab.focus();return self.clients.openWindow(path);
  })());
});
