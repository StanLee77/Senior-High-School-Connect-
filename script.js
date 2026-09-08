import { initializeApp } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-app.js";
import {
  getAuth,onAuthStateChanged,createUserWithEmailAndPassword,
  signInWithEmailAndPassword,signOut,updateProfile,deleteUser
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js";
import {
  getFirestore,collection,doc,getDoc,getDocs,setDoc,addDoc,updateDoc,deleteDoc,
  query,orderBy,limit,onSnapshot,serverTimestamp,where,arrayUnion
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";
/* Your existing Firebase project configuration is kept here. */
const firebaseConfig={
  apiKey:"AIzaSyCklTWsAmJsOof64Scs4GcovhWqMMnKYCA",
  authDomain:"shs-connect.firebaseapp.com",
  projectId:"shs-connect",
  storageBucket:"shs-connect.firebasestorage.app",
  messagingSenderId:"117946142411",
  appId:"1:117946142411:web:e76b6058b7eeec09b7154e"
};

const app=initializeApp(firebaseConfig);
const auth=getAuth(app);
const db=getFirestore(app);

const $=id=>document.getElementById(id);
let currentUser=null,currentProfile=null;
let users=new Map(), selectedUser=null;
let unsubCommunity=null,unsubUsers=null,unsubPrivate=null,unsubAnnouncements=null;
let communityCache=[];

const emojis=["😀","😂","🤣","😊","😍","🥰","😘","😎","🤔","😮","😢","😭","😡","🤝","👏","👍","👎","🙏","❤️","💚","💙","🩵","💔","🔥","🎉","✨","⭐","💯","😂","😅","😇","🤩","🥳","😴","🤗","😐","🙄","😏","🤦","🤷","👀","💪","🫶","✌️","👌","☀️","🌟","📚","🎓","📢","💬","🔒","🏫","⚽","🎮"];

const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));
const normalizeUsername=v=>String(v||"").trim().toLowerCase().replace(/^@/,"");
const initials=n=>(String(n||"?").trim().split(/\s+/).slice(0,2).map(x=>x[0]).join("").toUpperCase()||"?");
const toast=msg=>{const t=$("toast");t.textContent=msg;t.classList.add("show");clearTimeout(window.__toast);window.__toast=setTimeout(()=>t.classList.remove("show"),2500)};
const timeOf=ts=>ts?.toDate?ts.toDate().toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"}):"now";
const dateKey=ts=>ts?.toDate?ts.toDate().toDateString():"";
const friendly=e=>{
 const m={"auth/invalid-credential":"Email or password is incorrect.","auth/email-already-in-use":"An account already exists with this email.","auth/weak-password":"Password must be at least 6 characters.","auth/invalid-email":"Enter a valid email address.","auth/too-many-requests":"Too many attempts. Please try again later.","auth/network-request-failed":"Network error. Check your connection."};
 return m[e.code]||e.message||"Something went wrong.";
};

function setAuthTab(tab){
 document.querySelectorAll(".auth-tab").forEach(b=>b.classList.toggle("active",b.dataset.auth===tab));
 $("loginForm").classList.toggle("hidden",tab!=="login");
 $("registerForm").classList.toggle("hidden",tab!=="register");
 $("authError").textContent="";
}
document.querySelectorAll(".auth-tab").forEach(b=>b.onclick=()=>setAuthTab(b.dataset.auth));

$("loginForm").onsubmit=async e=>{
 e.preventDefault();
 try{await signInWithEmailAndPassword(auth,$("loginEmail").value.trim(),$("loginPassword").value)}
 catch(err){$("authError").textContent=friendly(err)}
};

$("registerForm").onsubmit=async e=>{
 e.preventDefault();
 const name=$("regName").value.trim(),username=normalizeUsername($("regUsername").value),school=$("regSchool").value.trim(),gender=$("regGender").value,phone=$("regPhone").value.trim(),course=$("regCourse").value,email=$("regEmail").value.trim().toLowerCase(),password=$("regPassword").value;
 if(!/^[a-z0-9_.-]{3,20}$/.test(username)) return $("authError").textContent="Username must be 3–20 letters, numbers, dots, dashes or underscores.";
 try{
   // Reserve the username after authentication. This avoids the pre-login
   // Firestore query that caused "Missing or insufficient permissions".
   const cred=await createUserWithEmailAndPassword(auth,email,password);
   try{
     await setDoc(doc(db,"usernames",username),{uid:cred.user.uid,username,name,createdAt:serverTimestamp()});
   }catch(err){
     await deleteUser(cred.user).catch(()=>{});
     if(err.code==="permission-denied") throw new Error("Signup permissions are not published yet. Publish the included Firestore rules.");
     if(err.code==="already-exists") return $("authError").textContent="That username is already taken.";
     throw err;
   }
   await updateProfile(cred.user,{displayName:name});
   await setDoc(doc(db,"users",cred.user.uid),{uid:cred.user.uid,name,username,school,gender,phone,course,email,bio:"",createdAt:serverTimestamp(),updatedAt:serverTimestamp()});
   $("registerForm").reset();
   showPage("communityPage");
 }catch(err){console.error(err);$("authError").textContent=friendly(err)}
};

$("logoutBtn").onclick=()=>signOut(auth);

onAuthStateChanged(auth,async user=>{
  cleanupListeners();
  if(!user){
    currentUser=null;currentProfile=null;
    $("appView").classList.add("hidden");$("authView").classList.remove("hidden");return;
  }
  currentUser=user;
  await ensureProfile();
  $("authView").classList.add("hidden");$("appView").classList.remove("hidden");
  updateIdentityUI();
  startUsers();
  startCommunity();
  startAnnouncements();
  showPage("communityPage");
});

async function ensureProfile(){
 const ref=doc(db,"users",currentUser.uid),snap=await getDoc(ref);
 if(snap.exists()){
   currentProfile=snap.data();
   if(!currentProfile.username){
     const generated=normalizeUsername(currentProfile.name||currentUser.email?.split("@")[0]||"student").slice(0,20)||"student";
     currentProfile={...currentProfile,username:generated};
     await setDoc(ref,{username:generated,updatedAt:serverTimestamp()},{merge:true});
   }
 }else{
   const name=currentUser.displayName||currentUser.email?.split("@")[0]||"Student";
   const username=normalizeUsername(name).slice(0,20)||"student";
   currentProfile={uid:currentUser.uid,name,username,school:"",email:currentUser.email,bio:""};
   await setDoc(ref,{...currentProfile,createdAt:serverTimestamp(),updatedAt:serverTimestamp()},{merge:true});
 }
}
function updateIdentityUI(){
 const p=currentProfile||{};
 $("drawerName").textContent=p.name||"Student";$("drawerUsername").textContent="@"+(p.username||"student");$("drawerSchool").textContent=p.school||"School not set";$("drawerAvatar").textContent=initials(p.name);
 $("profileAvatar").textContent=initials(p.name);$("profilePreviewName").textContent=p.name||"Student";$("profilePreviewUsername").textContent="@"+(p.username||"student");$("profilePreviewSchool").textContent=p.school||"School not set";
 $("profileName").value=p.name||"";$("profileUsername").value=p.username||"";$("profileSchool").value=p.school||"";$("profileEmail").value=p.email||currentUser.email||"";$("profileBio").value=p.bio||"";
 $("communitySubtitle").textContent=(p.school? p.school+" · ":"")+"Community group";
}

function cleanupListeners(){unsubCommunity?.();unsubUsers?.();unsubPrivate?.();unsubAnnouncements?.();unsubCommunity=unsubUsers=unsubPrivate=unsubAnnouncements=null}
function showPage(id){
 document.querySelectorAll(".page").forEach(p=>p.classList.add("hidden"));
 $(id).classList.remove("hidden");
 document.querySelectorAll(".drawer-item[data-page]").forEach(b=>b.classList.toggle("active",b.dataset.page===id));
 $("drawer").classList.remove("open");$("drawerShade").classList.remove("show");
 if(id==="privatePage") renderPrivateUsers();
 if(id==="studentsPage") renderStudents();
}
document.querySelectorAll(".drawer-item[data-page]").forEach(b=>b.onclick=()=>showPage(b.dataset.page));
$("menuBtn").onclick=()=>{$("drawer").classList.add("open");$("drawerShade").classList.add("show")};
$("drawerShade").onclick=()=>{$("drawer").classList.remove("open");$("drawerShade").classList.remove("show")};
$("drawerSettingsBtn").onclick=()=>showPage("profilePage");

$("profileForm").onsubmit=async e=>{
 e.preventDefault();
 const name=$("profileName").value.trim(),username=normalizeUsername($("profileUsername").value),school=$("profileSchool").value.trim(),bio=$("profileBio").value.trim();
 if(!/^[a-z0-9_.-]{3,20}$/.test(username)) return $("profileStatus").textContent="Invalid username.";
 try{
   const q=await getDocs(query(collection(db,"users"),where("username","==",username),limit(2)));
   const taken=q.docs.some(d=>d.id!==currentUser.uid);
   if(taken) return $("profileStatus").textContent="That username is already taken.";
   await setDoc(doc(db,"users",currentUser.uid),{name,username,school,bio,email:currentUser.email,updatedAt:serverTimestamp()},{merge:true});
   await updateProfile(currentUser,{displayName:name});
   currentProfile={...currentProfile,name,username,school,bio,email:currentUser.email};
   updateIdentityUI();$("profileStatus").textContent="Profile saved.";toast("Your information was updated.");
   setTimeout(()=>$("profileStatus").textContent="",2500);
 }catch(err){console.error(err);$("profileStatus").textContent="Could not save. Check Firestore rules."}
};

function startUsers(){
 const q=query(collection(db,"users"),limit(500));
 unsubUsers=onSnapshot(q,snap=>{
   users.clear();snap.forEach(d=>users.set(d.id,{id:d.id,...d.data()}));
   renderPrivateUsers();renderStudents();
 },err=>{console.error(err);toast("Student list could not load.")});
}

function renderPrivateUsers(){
 const term=($("privateSearchInput")?.value||"").trim().toLowerCase();
 const list=[...users.values()].filter(u=>u.id!==currentUser.uid).filter(u=>!term||`${u.name} ${u.username} ${u.school}`.toLowerCase().includes(term));
 $("privateUsers").innerHTML=list.length?list.map(u=>`<div class="private-user ${selectedUser?.id===u.id?"active":""}" data-id="${esc(u.id)}"><button type="button" class="user-avatar-btn avatar" aria-label="View ${esc(u.name||"student")}'s profile">${esc(initials(u.name))}</button><div style="min-width:0"><strong>${esc(u.name||"Student")}</strong><small>@${esc(u.username||"student")} · ${esc(u.school||"School not set")}</small></div></div>`).join(""):`<div class="empty-chat" style="height:250px"><div><div class="empty-icon">🔎</div><p>No students found.</p></div></div>`;
 $("privateUsers").querySelectorAll("[data-id]").forEach(x=>x.onclick=e=>{
  if(e.target.closest(".user-avatar-btn")) openUserProfile(x.dataset.id);
  else openPrivate(x.dataset.id);
});
}
$("privateSearchInput").oninput=renderPrivateUsers;
$("privateSearchBtn").onclick=()=>$("privateSearchWrap").classList.toggle("hidden");

function privateId(a,b){return [a,b].sort().join("_")}
async function openPrivate(uid){
 selectedUser=users.get(uid);if(!selectedUser)return;
 $("privateName").textContent=selectedUser.name||"Student";
 $("privateSchool").textContent="@"+(selectedUser.username||"student")+" · "+(selectedUser.school||"School not set");
 $("privateAvatar").textContent=initials(selectedUser.name);
 $("privateAvatar").onclick=()=>openUserProfile(selectedUser.id);
 $("privateShell")?.classList.add("chat-open");
 $("privateChat").classList.remove("hidden");
 document.querySelector(".private-shell").classList.add("chat-open");
 renderPrivateUsers();
 unsubPrivate?.();
 const cid=privateId(currentUser.uid,uid);
 const ref=doc(db,"conversations",cid);
 const q=query(collection(db,"conversations",cid,"messages"),orderBy("createdAt","asc"),limit(300));
 unsubPrivate=onSnapshot(q,snap=>{
   renderMessages($("privateMessages"),snap.docs.map(d=>({id:d.id,...d.data()})),"private");
 },err=>{console.error(err);toast("Private chat could not load. Check Firestore rules.")});
}
$("privateBackBtn").onclick=()=>{selectedUser=null;unsubPrivate?.();unsubPrivate=null;document.querySelector(".private-shell").classList.remove("chat-open");$("privateChat").classList.add("hidden");renderPrivateUsers()};

/* Media is stored in Cloudinary so Firebase Storage/Blaze billing is not required.
   Create an unsigned Cloudinary upload preset and put your values below. */
const CLOUDINARY_CLOUD_NAME="wdda959x";
const CLOUDINARY_UPLOAD_PRESET="shsconnect_media";

function cloudinaryResourceType(file){
 const type=String(file.type||"").toLowerCase();
 if(type.startsWith("image/")) return "image";
 if(type.startsWith("video/")||type.startsWith("audio/")) return "video";
 return "raw";
}

async function uploadMedia(file){
 if(!file)return null;
 const max=20*1024*1024;
 if(file.size>max){toast("Media must be 20 MB or smaller.");return null;}
 if(CLOUDINARY_CLOUD_NAME.startsWith("YOUR_")||CLOUDINARY_UPLOAD_PRESET.startsWith("YOUR_")){
   toast("Set up Cloudinary in script.js before sharing media.");
   return null;
 }
 const resourceType=cloudinaryResourceType(file);
 const endpoint=`https://api.cloudinary.com/v1_1/${encodeURIComponent(CLOUDINARY_CLOUD_NAME)}/${resourceType}/upload`;
 const form=new FormData();
 form.append("file",file);
 form.append("upload_preset",CLOUDINARY_UPLOAD_PRESET);
 form.append("folder","shsconnect/chat-media");
 const res=await fetch(endpoint,{method:"POST",body:form});
 const data=await res.json().catch(()=>({}));
 if(!res.ok||!data.secure_url){
   console.error("Cloudinary upload failed",data);
   throw new Error(data.error?.message||"Cloudinary upload failed");
 }
 return {mediaUrl:data.secure_url,mediaType:file.type||"application/octet-stream",mediaName:file.name,mediaSize:file.size,mediaResourceType:resourceType,mediaPublicId:data.public_id||""};
}
async function sendPrivate(text,file=null){
 if(!selectedUser||(!text&&!file))return;
 const cid=privateId(currentUser.uid,selectedUser.id);
 try{
   const media=file?await uploadMedia(file):null;
   const messageData={senderId:currentUser.uid,receiverId:selectedUser.id,text:text||"",createdAt:serverTimestamp(),...(media||{})};
   const preview=text||`📎 ${file.name}`;
   await setDoc(doc(db,"conversations",cid),{participants:[currentUser.uid,selectedUser.id],lastMessage:preview,lastMessageAt:serverTimestamp()},{merge:true});
   await addDoc(collection(db,"conversations",cid,"messages"),messageData);
 }catch(err){console.error(err);toast("Message failed. Check your Cloudinary setup and connection.")}
}
$("privateForm").onsubmit=async e=>{e.preventDefault();const text=$("privateInput").value.trim(),file=$("privateMediaInput").files[0];if(!text&&!file)return;await sendPrivate(text,file);$("privateInput").value="";$("privateMediaInput").value="";$("privateMediaPreview").classList.add("hidden");$("privateMediaPreview").innerHTML=""};
$("privateMediaBtn").onclick=()=>$("privateMediaInput").click();

function setupMediaPreview(inputId,previewId){
 const input=$(inputId),box=$(previewId);
 let objectUrl=null;
 input.addEventListener("change",()=>{
   if(objectUrl)URL.revokeObjectURL(objectUrl);
   objectUrl=null;
   const file=input.files?.[0];
   if(!file){box.classList.add("hidden");box.innerHTML="";return;}
   objectUrl=URL.createObjectURL(file);
   const type=String(file.type||"");
   const visual=type.startsWith("image/")?`<img src="${esc(objectUrl)}" alt="Preview">`:type.startsWith("video/")?`<video src="${esc(objectUrl)}" muted></video>`:`<span>📎</span>`;
   box.innerHTML=`${visual}<span class="preview-name">${esc(file.name)}</span><button type="button" aria-label="Remove selected media">×</button>`;
   box.classList.remove("hidden");
   box.querySelector("button").onclick=()=>{
     input.value="";
     if(objectUrl)URL.revokeObjectURL(objectUrl);
     objectUrl=null;box.classList.add("hidden");box.innerHTML="";
   };
 });
}

setupMediaPreview("communityMediaInput","communityMediaPreview");
setupMediaPreview("privateMediaInput","privateMediaPreview");

function startCommunity(){
 const q=query(collection(db,"messages"),orderBy("createdAt","asc"),limit(300));
 unsubCommunity=onSnapshot(q,snap=>{
   communityCache=snap.docs.map(d=>({id:d.id,...d.data()}));
   renderMessages($("communityMessages"),communityCache,"community");
 },err=>{console.error(err);toast("Community chat could not load. Check Firestore rules.")});
}
$("communityForm").onsubmit=async e=>{
 e.preventDefault();
 const text=$("communityInput").value.trim(),file=$("communityMediaInput").files[0];
 if(!text&&!file)return;
 try{
   const media=file?await uploadMedia(file):null;
   await addDoc(collection(db,"messages"),{uid:currentUser.uid,fullName:currentProfile.name,username:currentProfile.username,school:currentProfile.school,text:text||"",createdAt:serverTimestamp(),...(media||{})});
   $("communityInput").value="";$("communityMediaInput").value="";$("communityMediaPreview").classList.add("hidden");$("communityMediaPreview").innerHTML="";
 }catch(err){console.error(err);toast("Could not send media/message. Check your Cloudinary setup.")}
};
$("communityMediaBtn").onclick=()=>$("communityMediaInput").click();

function mediaMarkup(m){
 if(!m.mediaUrl)return "";
 const type=String(m.mediaType||"");
 const name=esc(m.mediaName||"Media");
 if(type.startsWith("image/")) return `<a class="media-link" href="${esc(m.mediaUrl)}" target="_blank" rel="noopener"><img class="message-media" src="${esc(m.mediaUrl)}" alt="${name}" loading="lazy"></a>`;
 if(type.startsWith("video/")) return `<video class="message-media" controls preload="metadata" src="${esc(m.mediaUrl)}"></video>`;
 if(type.startsWith("audio/")) return `<audio class="message-audio" controls src="${esc(m.mediaUrl)}"></audio>`;
 return `<a class="message-file" href="${esc(m.mediaUrl)}" target="_blank" rel="noopener">📎 ${name}</a>`;
}

async function editMessage(type,id,oldText){
 const next=prompt("Edit message:",oldText||"");
 if(next===null)return;
 const text=next.trim();
 if(!text)return toast("Message cannot be empty.");
 try{
   if(type==="private"){
     const cid=privateId(currentUser.uid,selectedUser.id);
     await updateDoc(doc(db,"conversations",cid,"messages",id),{text,edited:true,editedAt:serverTimestamp()});
   }else{
     await updateDoc(doc(db,"messages",id),{text,edited:true,editedAt:serverTimestamp()});
   }
 }catch(err){console.error(err);toast("Could not edit message. Check Firestore rules.")}
}
async function removeMessage(type,id){
 if(!confirm("Delete this message?"))return;
 try{
   if(type==="private"){
     const cid=privateId(currentUser.uid,selectedUser.id);
     await deleteDoc(doc(db,"conversations",cid,"messages",id));
   }else{
     await deleteDoc(doc(db,"messages",id));
   }
 }catch(err){console.error(err);toast("Could not delete message. Check Firestore rules.")}
}
function messageActions(m,type){
 if((m.uid||m.senderId)!==currentUser.uid)return "";
 const id=esc(m.id), text=esc(m.text||"");
 return `<div class="message-actions"><button type="button" class="msg-action edit-message" data-id="${id}" data-type="${type}" data-text="${text}">✏️ Edit</button><button type="button" class="msg-action delete-message" data-id="${id}" data-type="${type}">🗑️ Delete</button></div>`;
}
function renderMessages(box,list,type="community"){
 const term=$("communitySearchInput")?.value?.trim().toLowerCase()||"";
 const filtered=list.filter(m=>!term||String(m.text||"").toLowerCase().includes(term)||String(m.fullName||"").toLowerCase().includes(term)||String(m.username||"").toLowerCase().includes(term));
 if(!filtered.length){box.innerHTML=`<div class="empty-chat"><div><div class="empty-icon">💬</div><strong>${term?"No matching messages":"Welcome to SHS Connect"}</strong><p>${term?"Try another search.":"Start chatting with your school community."}</p></div></div>`;return}
 let lastDate=""; box.innerHTML="";
 filtered.forEach(m=>{
   const mine=(m.uid||m.senderId)===currentUser.uid,d=dateKey(m.createdAt);
   if(d&&d!==lastDate){lastDate=d;const divider=document.createElement("div");divider.className="date-divider";divider.textContent=d===new Date().toDateString()?"Today":d;box.appendChild(divider)}
   const row=document.createElement("div");row.className="message-row"+(mine?" mine":"");
   const senderId=m.uid||m.senderId;
   const av=`<button type="button" class="mini-avatar user-avatar-btn" data-user-id="${esc(senderId||"")}">${esc(initials(m.fullName||m.username))}</button>`;
   const senderName=mine?"You":esc(m.fullName||users.get(senderId)?.name||"Student");
   row.innerHTML=`${mine?"":av}<div class="message-bubble"><div class="sender">${senderName}</div>${mediaMarkup(m)}${m.text?`<div class="message-text">${esc(m.text)}</div>`:""}<div class="message-meta">${esc(timeOf(m.createdAt))}${m.edited?" · edited":""}${mine?'<span class="ticks">✓✓</span>':""}</div>${messageActions(m,type)}</div>${mine?av:""}`;
   box.appendChild(row);
 });
 box.querySelectorAll("[data-user-id]").forEach(b=>b.onclick=()=>openUserProfile(b.dataset.userId));
 box.scrollTop=box.scrollHeight;
}
$("communitySearchBtn").onclick=()=>{$("communitySearchBar").classList.remove("hidden");$("communitySearchInput").focus()};
$("closeCommunitySearch").onclick=()=>{$("communitySearchBar").classList.add("hidden");$("communitySearchInput").value="";renderMessages($("communityMessages"),communityCache)};
$("communitySearchInput").oninput=()=>renderMessages($("communityMessages"),communityCache);

function startAnnouncements(){
 const q=query(collection(db,"posts"),where("type","==","announcement"),limit(100));
 unsubAnnouncements=onSnapshot(q,snap=>{
   const list=snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(b.createdAt?.toMillis?.()||0)-(a.createdAt?.toMillis?.()||0));
   renderAnnouncements(list);
 },err=>{
   console.error(err);toast("Announcements could not load. If Firebase requests an index, create it from the Firebase link in the console.");
 });
}
function renderAnnouncements(list){
 $("announcementList").innerHTML=list.length?list.map(p=>`<article class="announcement card"><div class="announcement-head"><button type="button" class="avatar user-avatar-btn" data-user-id="${esc(p.uid||"")}">${esc(initials(p.authorName))}</button><div><strong>${esc(p.authorName||"Student")}</strong><small>@${esc(p.username||"student")} · ${esc(p.school||"School not set")} · ${esc(timeOf(p.createdAt))}</small></div></div><div class="announcement-body">${esc(p.text||"")}</div></article>`).join(""):`<div class="empty-chat card" style="height:260px"><div><div class="empty-icon">📢</div><strong>No announcements yet</strong><p>Publish the first one.</p></div></div>`;
}
$("announcementList").querySelectorAll("[data-user-id]").forEach(b=>b.onclick=()=>openUserProfile(b.dataset.userId));
$("announcementForm").onsubmit=async e=>{
 e.preventDefault();const text=$("announcementInput").value.trim();if(!text)return;
 try{
   await addDoc(collection(db,"posts"),{uid:currentUser.uid,authorName:currentProfile.name,username:currentProfile.username,school:currentProfile.school,text,type:"announcement",likes:[],createdAt:serverTimestamp()});
   $("announcementInput").value="";$("announcementCount").textContent="0/2000";toast("Announcement published.");
 }catch(err){console.error(err);toast("Could not publish announcement.")}
};
$("announcementInput").oninput=e=>$("announcementCount").textContent=`${e.target.value.length}/2000`;

function renderStudents(){
 const term=($("studentSearchInput")?.value||"").trim().toLowerCase();
 const list=[...users.values()].filter(u=>!term||`${u.name} ${u.username} ${u.school}`.toLowerCase().includes(term));
 $("studentsGrid").innerHTML=list.length?list.map(u=>`<div class="student-card" data-student-id="${esc(u.id)}"><button type="button" class="user-avatar-btn avatar" aria-label="View ${esc(u.name||"student")}'s profile">${esc(initials(u.name))}</button><div><strong>${esc(u.name||"Student")}</strong><small>@${esc(u.username||"student")}</small><div class="student-school">${esc(u.school||"School not set")}</div></div></div>`).join(""):`<div class="empty-chat card" style="grid-column:1/-1;height:220px"><div><div class="empty-icon">🎓</div><p>No students found.</p></div></div>`;
}
$("studentSearchInput").oninput=renderStudents;
$("studentsGrid").addEventListener("click",e=>{
 const card=e.target.closest("[data-student-id]");
 if(card&&e.target.closest(".user-avatar-btn")) openUserProfile(card.dataset.studentId);
});

function openUserProfile(uid){
 const u=users.get(uid);
 if(!u||uid===currentUser?.uid)return;
 $("viewUserAvatar").textContent=initials(u.name);
 $("viewUserName").textContent=u.name||"Student";
 $("viewUserUsername").textContent="@"+(u.username||"student");
 $("viewUserSchool").textContent=u.school||"School not set";
 $("viewUserGender").textContent=u.gender||"Not provided";
 $("viewUserCourse").textContent=u.course||"Not provided";
 $("viewUserPhone").textContent=u.phone||"Not provided";
 $("viewUserBio").textContent=u.bio||"No bio";
 $("viewUserMessageBtn").onclick=()=>{$("userProfileModal").classList.add("hidden");showPage("privatePage");openPrivate(uid)};
 $("userProfileModal").classList.remove("hidden");
}
$("closeUserProfile").onclick=()=>$("userProfileModal").classList.add("hidden");
$("userProfileModal").onclick=e=>{if(e.target.id==="userProfileModal")e.currentTarget.classList.add("hidden")};

/* Emoji picker */
function setupEmoji(buttonId,pickerId,inputId){
 const btn=$(buttonId),picker=$(pickerId),input=$(inputId);
 picker.innerHTML=emojis.map(e=>`<button type="button">${e}</button>`).join("");
 picker.querySelectorAll("button").forEach(b=>b.onclick=()=>{const a=input.selectionStart??input.value.length,z=input.selectionEnd??a;input.value=input.value.slice(0,a)+b.textContent+input.value.slice(z);input.focus();input.selectionStart=input.selectionEnd=a+b.textContent.length;picker.classList.add("hidden")});
 btn.onclick=e=>{e.stopPropagation();picker.classList.toggle("hidden")};
}
document.addEventListener("click",e=>{
 const edit=e.target.closest(".edit-message"), del=e.target.closest(".delete-message");
 if(edit) editMessage(edit.dataset.type,edit.dataset.id,edit.dataset.text);
 if(del) removeMessage(del.dataset.type,del.dataset.id);
});
setupEmoji("communityEmojiBtn","communityEmojiPicker","communityInput");
setupEmoji("privateEmojiBtn","privateEmojiPicker","privateInput");
document.addEventListener("click",e=>{if(!e.target.closest(".emoji-wrap"))document.querySelectorAll(".emoji-picker").forEach(x=>x.classList.add("hidden"))});

/* Three-dot menus */
function showMenu(items,anchor){
 const menu=$("contextMenu");menu.innerHTML=items.map((x,i)=>`<button data-menu-index="${i}">${x.label}</button>`).join("");
 menu.classList.remove("hidden");
 const r=anchor.getBoundingClientRect();menu.style.top=Math.min(innerHeight-180,r.bottom+5)+"px";menu.style.left=Math.max(8,Math.min(innerWidth-205,r.right-195))+"px";
 items.forEach((x,i)=>menu.querySelector(`[data-menu-index="${i}"]`).onclick=()=>{menu.classList.add("hidden");x.action()});
}
document.addEventListener("click",e=>{if(!e.target.closest(".context-menu")&&!e.target.closest(".chat-icon")&&!e.target.closest(".round-btn")&&!e.target.closest(".header-icon"))$("contextMenu").classList.add("hidden")});

$("communityMoreBtn").onclick=e=>showMenu([
 {label:"Community info",action:()=>toast("SHS Connect Community · "+(currentProfile?.school||"All schools"))},
 {label:"Search messages",action:()=>$("communitySearchBtn").click()},
 {label:"My profile",action:()=>showPage("profilePage")}
],e.currentTarget);

$("privateMoreBtn").onclick=e=>showMenu([
 {label:"Student profile",action:()=>selectedUser&&toast(`${selectedUser.name} · @${selectedUser.username||"student"} · ${selectedUser.school||"School not set"}`)},
 {label:"Search students",action:()=>{$("privateSearchWrap").classList.remove("hidden");$("privateSearchInput").focus()}},
 {label:"Close chat",action:()=>$("privateBackBtn").click()}
],e.currentTarget);

$("announcementMenuBtn").onclick=e=>showMenu([
 {label:"Write announcement",action:()=>$("announcementInput").focus()},
 {label:"My profile",action:()=>showPage("profilePage")}
],e.currentTarget);

$("topMenuBtn").onclick=e=>showMenu([
 {label:"My profile",action:()=>showPage("profilePage")},
 {label:"Private messages",action:()=>showPage("privatePage")},
 {label:"Announcements",action:()=>showPage("announcementsPage")},
 {label:"Log out",action:()=>signOut(auth)}
],e.currentTarget);

/* Global search icon */
$("globalSearchBtn").onclick=()=>{$("globalSearchPanel").classList.remove("hidden");$("globalSearchInput").focus()};
$("closeGlobalSearch").onclick=()=>{$("globalSearchPanel").classList.add("hidden");$("globalSearchInput").value="";$("globalSearchResults").innerHTML=""};
$("globalSearchInput").oninput=e=>{
 const term=e.target.value.trim().toLowerCase();
 if(!term)return $("globalSearchResults").innerHTML="";
 const studentResults=[...users.values()].filter(u=>`${u.name} ${u.username} ${u.school}`.toLowerCase().includes(term)).slice(0,8);
 const messageResults=communityCache.filter(m=>`${m.text} ${m.fullName} ${m.username}`.toLowerCase().includes(term)).slice(-8).reverse();
 $("globalSearchResults").innerHTML=[
   ...studentResults.map(u=>`<div class="global-result" data-goto-user="${esc(u.id)}"><strong>👤 ${esc(u.name||"Student")}</strong><small>@${esc(u.username||"student")} · ${esc(u.school||"")}</small></div>`),
   ...messageResults.map(m=>`<div class="global-result"><strong>💬 ${esc(m.fullName||"Student")}</strong><small>${esc(m.text||"")}</small></div>`)
 ].join("")||`<div class="global-result"><small>No results.</small></div>`;
 $("globalSearchResults").querySelectorAll("[data-goto-user]").forEach(x=>x.onclick=()=>{$("globalSearchPanel").classList.add("hidden");showPage("privatePage");openPrivate(x.dataset.gotoUser)});
};

/* Enter-to-send and safe mobile keyboard behavior */
["communityInput","privateInput"].forEach(id=>$(id).addEventListener("keydown",e=>{
 if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();$(id).closest("form").requestSubmit()}
}));
