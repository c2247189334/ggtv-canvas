// 从 skill 的 scripts/transport.mjs 原样搬来，只改了 fail 的 import 来源。
// 这一层是干什么的：这台机器上跑着代理，DNS 会返回 198.18.x.x 这种假地址，
// 直连火山的域名会连不上。所以要问一次真实 DNS，并绑到物理网卡出去。
// 【别自己改】这段是实测跑通过的，跟 skill 保持一致，将来好对 diff。
// ⚠ 唯一的例外（2026-09-24）：查真实 DNS 的管道名不再写死 `verge-mihomo`，改由 pickDnsPipe 现找。
// Clash Verge 2.5.5 把它改成了 `verge-mihomo-production-<一长串>`，写死的旧名 ENOENT，
// 模板页识别和视频拆解一起报「连不上识别服务」。`阶段0测试/skill脚本/transport.mjs` 那份没跟着改。
// ⚠ 第二个例外（2026-10-14，登录积分）：fetch 在请求还没完整发出去之前出的错（路由 / DNS / 连接 / TLS 握手 / 发到一半），
// 错误对象上标 notSent = true（markUnsent / watchSend）。视频生成扣分靠它分「没发出去 → 全退」和「发出去了、结果不明 → 不退」。
// 只加标记，不改任何请求行为。
// ⚠ 第三个例外（2026-11-01，开源）：找不到 Clash Verge 的管道不再直接报 REAL_DNS_PIPE_MISSING，
// 先从物理网卡直接问公共 DNS（boundDNS）；问到的还是假地址或问不通，才报这个错。别人电脑上的代理不一定是 Clash Verge。
import {lookup,Resolver} from 'node:dns/promises';
import {request as httpRequest} from 'node:http';
import {request as httpsRequest} from 'node:https';
import {networkInterfaces} from 'node:os';
import {execFileSync} from 'node:child_process';
import {readdirSync} from 'node:fs';
// 2026-10-20 搬进无限画布：新项目没有 volcano.mjs，fail 就地定义（和旧项目 volcano.mjs 里那个一模一样）。
// 除了这一处，下面一个字没改。
function fail(code) {
  throw Error(code);
}

/** 从 `\\.\pipe\` 下的名字里挑 Mihomo 的管道：旧名优先，其次带后缀的（production 优先）；没有返回 null。 */
export function pickDnsPipe(names) {
  if (names.includes('verge-mihomo')) return 'verge-mihomo';
  const tagged = names.filter((n) => n.startsWith('verge-mihomo-')).sort();
  return tagged.find((n) => n.startsWith('verge-mihomo-production-')) ?? tagged[0] ?? null;
}
function dnsPipePath() {
  let names = [];
  try {names = readdirSync('\\\\.\\pipe\\');} catch {return null;}
  const name = pickDnsPipe(names);
  return name ? '\\\\.\\pipe\\' + name : null;
}

const fake=ip=>/^198\.(18|19)\./.test(ip);
const publicV4=ip=>/^\d+\.\d+\.\d+\.\d+$/.test(ip)&&!fake(ip)&&! /^(0\.|10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip);
function physicalAddress() {
  if(process.platform!=='win32')return undefined;
  const script="$p=@(Get-NetAdapter -Physical | Where-Object Status -eq 'Up' | Select-Object -ExpandProperty ifIndex); $r=Get-NetRoute -AddressFamily IPv4 -DestinationPrefix '0.0.0.0/0' | Where-Object {$_.InterfaceIndex -in $p} | Sort-Object RouteMetric | Select-Object -First 1; if($r){Get-NetIPAddress -AddressFamily IPv4 -InterfaceIndex $r.InterfaceIndex | Where-Object {$_.AddressState -eq 'Preferred' -and $_.IPAddress -notmatch '^(169\\.254\\.|127\\.)'} | Select-Object -First 1 -ExpandProperty IPAddress}";
  let address;
  try {address=execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],
    {encoding:'utf8',windowsHide:true,timeout:10000,stdio:['ignore','pipe','pipe']}).trim();} catch {fail('PHYSICAL_ROUTE_READ_FAILED');}
  if(!Object.values(networkInterfaces()).flat().some(x=>x.address===address&&!x.internal&&!fake(address)))fail('PHYSICAL_ROUTE_AMBIGUOUS');
  return address;
}
/** 没有 Clash Verge 管道时的退路：绑在物理网卡上问阿里、腾讯的公共 DNS；问不到公网地址返回 null。 */
export async function boundDNS(host,localAddress,resolver=new Resolver({timeout:5000,tries:2})) {
  resolver.setServers(['223.5.5.5','119.29.29.29']);
  if(localAddress)resolver.setLocalAddress(localAddress);
  let answers;
  try{answers=await resolver.resolve4(host);}catch{return null;}
  return answers.find(publicV4)??null;
}
async function realDNS(host,local) {
  const records=await lookup(host,{all:true,family:4});
  const address=records.find(x=>publicV4(x.address))?.address;
  if(address)return {address,fakeDNS:false};
  if(process.platform!=='win32'||!records.some(x=>fake(x.address)))fail('PUBLIC_DNS_MISSING');
  const pipe=dnsPipePath();
  if(!pipe){const bound=await boundDNS(host,local());if(!bound)fail('REAL_DNS_PIPE_MISSING');return {address:bound,fakeDNS:true};}
  // Existing local Mihomo read-only DNS API. No config writes and no proxy secrets read.
  const data=await new Promise((resolve,reject)=>{
    const req=httpRequest({socketPath:pipe,method:'GET',
      path:'/dns/query?name='+encodeURIComponent(host)+'&type=A'},res=>{
      let text='';res.on('data',b=>text+=b);res.on('error',reject);res.on('end',()=>{
        try{if(res.statusCode!==200)throw Error();resolve(JSON.parse(text));}catch{reject(Error('REAL_DNS_QUERY_FAILED'));}
      });
    });req.setTimeout(10000,()=>req.destroy(Error('REAL_DNS_QUERY_TIMEOUT')));req.on('error',reject);req.end();
  });
  const real=(data.Answer??[]).find(x=>x.type===1&&publicV4(x.data))?.data;
  if(!real)fail('PUBLIC_DNS_MISSING');return {address:real,fakeDNS:true};
}

/** 给错误标上「请求没完整发出去」。 */
export function markUnsent(err) {
  if (err && typeof err === 'object') err.notSent = true;
  return err;
}

/**
 * 接管一个 http(s) 请求的 'error'：请求还没完整交给系统发出（'finish' 之前）出的错标 notSent，
 * 之后出的错（对面收到整个请求后才断、读回复时出错）原样交出去 —— 对面可能已经收下并开始干活。
 */
export function watchSend(req, reject) {
  let finished = false;
  req.on('finish', () => { finished = true; });
  req.on('error', (err) => reject(finished ? err : markUnsent(err)));
}

export function transport(c) {
  const allowed=new Set(['ark.cn-beijing.volces.com',`${c.TOS_BUCKET}.tos-cn-beijing.volces.com`,
    'ark-acg-cn-beijing.tos-cn-beijing.volces.com']);
  const cache=new Map();let localAddress,initialized=false;
  async function route(host) {
    if(!allowed.has(host))fail('HOST_NOT_ALLOWED');
    if(!initialized){initialized=true;}
    const old=cache.get(host);if(old&&Date.now()-old.time<60000)return old;
    const dns=await realDNS(host,()=>localAddress??=physicalAddress());
    if(dns.fakeDNS&&!localAddress)localAddress=physicalAddress();
    const r={...dns,localAddress,time:Date.now()};cache.set(host,r);return r;
  }
  async function fetch(input,options={}) {
    let url,r,body;
    try {
      url=new URL(input);
      if(url.protocol!=='https:'||url.username||url.password||url.port&&url.port!=='443')fail('URL_NOT_ALLOWED');
      r=await route(url.hostname);body=options.body===undefined?undefined:Buffer.from(options.body);
    } catch(err) {throw markUnsent(err);}
    return new Promise((resolve,reject)=>{
      let req;
      try {req=httpsRequest(url,{method:options.method??'GET',agent:false,localAddress:r.localAddress,
        servername:url.hostname,lookup:(_h,o,cb)=>o?.all?cb(null,[{address:r.address,family:4}]):cb(null,r.address,4),
        headers:{'Accept-Encoding':'identity',...(options.headers??{}),...(body?{'Content-Length':body.length}:{})},
        signal:AbortSignal.timeout(options.timeout??60000)},res=>{
        const chunks=[];let size=0;
        res.on('data',b=>{size+=b.length;if(size>64*1024*1024)res.destroy(Error('RESPONSE_TOO_LARGE'));else chunks.push(b);});
        res.on('error',reject);res.on('aborted',()=>reject(Error('RESPONSE_INTERRUPTED')));
        res.on('end',()=>{try{
          const headers=Object.fromEntries(Object.entries(res.headers).filter(([,v])=>v!==undefined).map(([k,v])=>[k,Array.isArray(v)?v.join(', '):String(v)]));
          resolve(new Response([204,205,304].includes(res.statusCode)?null:Buffer.concat(chunks),{status:res.statusCode,headers}));
        }catch{reject(Error('RESPONSE_INVALID'));}});
      });} catch(err) {return reject(markUnsent(err));}
      watchSend(req,reject);req.end(body);
    });
  }
  return {fetch,route};
}
