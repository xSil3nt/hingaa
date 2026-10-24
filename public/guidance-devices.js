// Start both permission requests within the journey-start gesture, before awaiting.
// Returning users reuse existing grants. Unsupported/denied features stay optional.
export async function enableGuidanceDevices(){
  const requests=[];
  if(typeof globalThis.DeviceOrientationEvent?.requestPermission==='function'){
    try{requests.push(Promise.resolve(DeviceOrientationEvent.requestPermission(true)));}catch{}
  }
  if(globalThis.Notification?.permission==='default'){
    try{requests.push(Promise.resolve(Notification.requestPermission()));}catch{}
  }
  // Optional browser prompts must not leave the journey-start button stuck.
  let timeout;
  await Promise.race([Promise.allSettled(requests),new Promise(resolve=>{timeout=setTimeout(resolve,5000);})]);
  clearTimeout(timeout);
}
