const button=document.getElementById('menu-toggle'),menu=document.getElementById('new-menu');
function close(){menu.hidden=true;button.setAttribute('aria-expanded','false');}
button.addEventListener('click',()=>{const open=menu.hidden;menu.hidden=!open;button.setAttribute('aria-expanded',String(open));});
document.addEventListener('keydown',e=>{if(e.key==='Escape'){close();button.focus();}});
document.addEventListener('click',e=>{if(!menu.hidden&&!menu.contains(e.target)&&!button.contains(e.target))close();});
document.getElementById('header-locate')?.addEventListener('click',()=>document.getElementById('locate')?.click());
