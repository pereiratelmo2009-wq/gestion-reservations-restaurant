const $ = (id) => document.getElementById(id);
let bookings = [];
const today = new Date();
$("serviceDate").value = new Date(today.getTime()-today.getTimezoneOffset()*60000).toISOString().slice(0,10);

async function api(url, options={}) {
  const res = await fetch(url, options);
  const data = await res.json().catch(()=>({}));
  if (!res.ok) throw new Error(data.error || "Une erreur est survenue.");
  return data;
}
function showApp(on) {
  $("loginView").classList.toggle("hidden", on);
  $("appView").classList.toggle("hidden", !on);
  $("logout").classList.toggle("hidden", !on);
}
async function checkSession() {
  try { const s = await api("/api/session"); showApp(s.authenticated); if(s.authenticated) await loadBookings(); }
  catch { showApp(false); }
}
$("loginForm").addEventListener("submit", async e => {
  e.preventDefault(); $("loginError").textContent="";
  try { await api("/api/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({password:$("password").value})}); $("password").value=""; showApp(true); await loadBookings(); }
  catch(err){ $("loginError").textContent=err.message; }
});
$("logout").onclick = async()=>{await api("/api/logout",{method:"POST"});showApp(false);};
$("serviceDate").addEventListener("change",loadBookings);
$("addBooking").onclick=()=>{bookings.push({id:"new-"+crypto.randomUUID(),name:"",table:"",arrival:"",covers:1,present:false,_new:true});render();};
$("printBtn").onclick=()=>window.print();

async function loadBookings(){
  try { bookings=await api(`/api/bookings?date=${$("serviceDate").value}`); render(); }
  catch(e){status(e.message,true);}
}
function status(message,error=false){$("scanStatus").textContent=message;$("scanStatus").classList.toggle("error",error);}
function esc(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function sorted(){return [...bookings].sort((a,b)=>{const an=Number(a.table),bn=Number(b.table);if(a.table!==""&&b.table!==""&&Number.isFinite(an)&&Number.isFinite(bn))return an-bn;return String(a.table).localeCompare(String(b.table),"fr",{numeric:true})||String(a.arrival).localeCompare(String(b.arrival));});}
function render(){
  const rows=sorted(); const total=rows.reduce((s,b)=>s+(Number(b.covers)||0),0);
  $("bookingCount").textContent=rows.length;$("coverCount").textContent=total;$("presentCount").textContent=rows.filter(b=>b.present).length;
  $("footTotal").textContent=`${rows.length} réservation${rows.length>1?"s":""} · ${total} couvert${total>1?"s":""}`;
  $("emptyState").classList.toggle("hidden",rows.length>0);
  $("bookingRows").innerHTML=rows.map(b=>`<tr data-id="${esc(b.id)}">
    <td><input class="present-check" type="checkbox" data-field="present" ${b.present?"checked":""} aria-label="Présent"></td>
    <td><input class="cell-input name-input" data-field="name" value="${esc(b.name)}" placeholder="Nom"></td>
    <td><input class="cell-input" data-field="table" value="${esc(b.table)}" placeholder="—"></td>
    <td><input class="cell-input" data-field="arrival" value="${esc(b.arrival)}" placeholder="12h00"></td>
    <td><input class="cell-input" data-field="covers" type="number" min="1" max="99" value="${esc(b.covers)}"></td>
    <td><button class="delete" title="Supprimer" aria-label="Supprimer">×</button></td></tr>`).join("");
  $("bookingRows").querySelectorAll("input").forEach(input=>input.addEventListener("change",async e=>{
    const tr=e.target.closest("tr"), item=bookings.find(x=>x.id===tr.dataset.id);if(!item)return;
    const field=e.target.dataset.field;item[field]=field==="present"?e.target.checked:field==="covers"?Math.max(1,Number(e.target.value)||1):e.target.value;
    await save(item);
  }));
  $("bookingRows").querySelectorAll(".delete").forEach(btn=>btn.onclick=async e=>{
    const id=e.target.closest("tr").dataset.id;const item=bookings.find(x=>x.id===id);
    if(item?._new){bookings=bookings.filter(x=>x.id!==id);render();return;}
    if(!confirm("Supprimer cette réservation ?"))return;
    try{await api(`/api/bookings/${id}`,{method:"DELETE"});bookings=bookings.filter(x=>x.id!==id);render();}catch(err){status(err.message,true);}
  });
}
async function save(item){
  try{
    const body={...item,date:$("serviceDate").value};
    if(item._new){const saved=await api("/api/bookings",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});bookings=bookings.map(x=>x.id===item.id?saved:x);item._new=false;}
    else await api(`/api/bookings/${item.id}`,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
    status("Modifications enregistrées et partagées avec l'équipe.");render();
  }catch(e){status(e.message,true);}
}
$("photo").addEventListener("change",async e=>{
  const file=e.target.files[0];if(!file)return;
  status("Lecture de la photo en cours…");
  const form=new FormData();form.append("photo",file);
  try{
    const result=await api("/api/scan",{method:"POST",body:form});
    if(!result.bookings.length){status("Aucune réservation détectée. Essaie une photo plus nette.",true);return;}
    const proposed=result.bookings.map(b=>({...b,id:"new-"+crypto.randomUUID(),present:false,_new:true}));
    if(bookings.length&&!confirm(`${proposed.length} réservation(s) détectée(s). Les ajouter à la liste existante ?`)){status("Import annulé.");return;}
    bookings.push(...proposed);render();status(`${proposed.length} réservation(s) détectée(s). Vérifie les lignes : elles seront enregistrées dès que tu les modifies ou les valides.`);
    // Save imported entries immediately so the team can see them.
    for(const item of proposed){const body={...item,date:$("serviceDate").value};const saved=await api("/api/bookings",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});bookings=bookings.map(x=>x.id===item.id?saved:x);}
    render();status(`${proposed.length} réservation(s) importée(s). Vérifie les noms, tables et horaires avant impression.`);
  }catch(err){status(err.message,true);}
  finally{$("photo").value="";}
});
checkSession();
