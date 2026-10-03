const fs=require('fs'),vm=require('vm'),path=require('path');
const html=fs.readFileSync(path.join(__dirname,'..','preview.html'),'utf8');
const code=html.match(/<script>([\s\S]*?)<\/script>/)[1];
const store=new Map();
const buyer={name:'Buyer One',email:'buyer@example.com',role:'buyer',approved:true};
const seller={name:'Kitchen Owner',email:'seller@example.com',role:'seller',approved:true,sellerId:'juniper'};
const rider={name:'Rider One',email:'rider@example.com',role:'buyer',approved:true,riderId:'rNear'};
const profile={id:'juniper',publicName:'Juniper Kitchen',ownerName:'Kitchen Owner',ownerEmail:'seller@example.com',bio:'Food',location:'Lagos',phone:'+2348012345678',whatsapp:'+2348012345678',latitude:6.5244,longitude:3.3792,deliveryRadiusKm:25,bankName:'OPay',accountName:'Juniper Kitchen',accountNumber:'0123456789',opayLink:'',walletLink:''};
const riderProfile={id:'rNear',ownerEmail:'rider@example.com',name:'Rider One',phone:'+2348098765432',whatsapp:'+2348098765432',vehicle:'Motorcycle',serviceArea:'Lagos',latitude:6.5250,longitude:3.3800,serviceRadiusKm:20,baseFee:1500,active:true,available:true};
const initial={'juniper.v2.user':buyer,'juniper.v2.accounts':[buyer,seller,rider],'juniper.v2.seller-profile':{juniper:profile},'juniper.v2.riders':{rNear:riderProfile},'juniper.v2.foods':[]};
for(const [k,v] of Object.entries(initial))store.set(k,JSON.stringify(v));
const localStorage={getItem:k=>store.has(k)?store.get(k):null,setItem:(k,v)=>store.set(k,String(v)),removeItem:k=>store.delete(k)};
const listeners={};const app={innerHTML:'',addEventListener:(n,f)=>listeners[n]=f};const toast={textContent:'',classList:{add(){},remove(){}}};
const document={getElementById:id=>id==='app'?app:id==='toast'?toast:null};const location={origin:'https://preview.local',pathname:'/preview.html',hash:'#/menu?table=08&s=juniper'};
const opened=[];const window={addEventListener:(n,f)=>listeners['window:'+n]=f,open:(...args)=>opened.push(args)};
const navigator={geolocation:{getCurrentPosition:ok=>ok({coords:{latitude:6.5244,longitude:3.3792}})}};
class FD{constructor(form){this.f=form.fields||{}}get(k){return this.f[k]??null}}
const sandbox={console,document,window,location,localStorage,navigator,URL,URLSearchParams,TextEncoder,FormData:FD,setTimeout:()=>1,clearTimeout(){},Blob,XMLSerializer:function(){}};
vm.createContext(sandbox);vm.runInContext(code,sandbox);
const click=(action,dataset={})=>listeners.click({target:{closest:s=>s==='[data-scroll]'?null:s==='[data-action]'?{dataset:{...dataset,action}}:null}});
const submit=(id,fields)=>listeners.submit({target:{id,fields},preventDefault(){}});
const hash=(v)=>{location.hash=v;listeners['window:hashchange']()};
function check(v,m){if(!v)throw new Error(m)}
// Location-based nearby seller/rider and per-item quantity.
click('use-location');
check(app.innerHTML.includes('Juniper Kitchen')&&app.innerHTML.includes('nearby seller'),'location search should show nearby sellers');
click('food-details',{id:'suya-bowl'});hash(location.hash);
check(app.innerHTML.includes('Quantity / people'),'food detail should offer quantity');
click('food-quantity',{delta:'1'});click('add-quantity',{id:'suya-bowl'});
check(JSON.parse(store.get('juniper.v2.cart'))['suya-bowl']===2,'selected quantity should add multiple portions');
click('checkout');hash(location.hash);click('delivery-mode',{mode:'delivery'});
check(app.innerHTML.includes('Rider One')&&app.innerHTML.includes('Nearest available rider'),'checkout should show nearest available rider');
listeners.input({target:{id:'delivery-address',value:'12 Allen Avenue, Lagos'}});
click('place-order');hash(location.hash);
let orders=JSON.parse(store.get('juniper.v2.orders'));
check(orders.length===1&&orders[0].riderId==='rNear'&&orders[0].deliveryFee===1500&&orders[0].quantity===2,'delivery order should include rider, fee, and chosen quantity');
let notes=JSON.parse(store.get('juniper.v2.notifications'));
check(notes.some(n=>n.email==='seller@example.com')&&notes.some(n=>n.email==='rider@example.com'),'seller and rider should receive local assignment notifications');
// Payment account details and receipt-share fallback.
check(app.innerHTML.includes('0123456789')===false,'initial payment screen should start on QR method');
click('payment-method',{method:'bank'});
check(app.innerHTML.includes('0123456789')&&app.innerHTML.includes('Transfer directly'),'bank account details should appear on the payment screen');
submit('receipt-form',{orderId:orders[0].id,receipt:{name:'receipt.png',type:'image/png'}});
check(opened.some(args=>String(args[0]).includes('wa.me/2348012345678')),'unsupported file sharing should open seller WhatsApp with its number');
// Sign in as the approved rider and move the delivery through statuses.
click('sign-out');click('open-signin');submit('signin-form',{email:'rider@example.com'});
hash('#/rider');check(app.innerHTML.includes('Assigned deliveries')&&app.innerHTML.includes('Order'),'rider dashboard should show the assigned order');
click('rider-delivery-status',{id:orders[0].id,status:'accepted'});
orders=JSON.parse(store.get('juniper.v2.orders'));check(orders[0].deliveryStatus==='accepted','rider can accept assigned job');
// Test each added route renders without runtime errors.
for(const route of ['#/business','#/admin','#/updates','#/rider-apply','#/rider-profile/rNear','#/menu?table=08&s=juniper']) hash(route);
console.log('Nearby search, quantity, delivery assignment, bank details, receipt share fallback, rider dashboard, and route rendering passed.');
