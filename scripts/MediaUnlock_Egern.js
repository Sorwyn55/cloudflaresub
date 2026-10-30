/**
 * Egern 流媒体地区与片库检测 v2.0
 *
 * 检测等级：
 * 1. 双源出口IP国家/ASN（此国家不等同于流媒体平台的实际地区）
 * 2. Netflix 原创作品 + 4 部非原创版权片页面交叉检测
 * 3. YouTube 页面自报 GL（可能受语言/账户偏好影响）
 * 4. 其他流媒体只检测显式区域拦截与网页访问能力
 *
 * 注意：未登录、未请求 DRM 播放许可，不可能验证整库或真正播放。
 * 对无法证实的情况使用“待验证”，不把HTTP 200判定为完整解锁。
 * 不修改DNS/代理规则，不启用MITM，不读取浏览器Cookie。
 */

const NF_ORIGINAL={id:"80018499",name:"Stranger Things"};
const NF_LICENSED=[
  {id:"70143836",name:"Breaking Bad"},
  {id:"80027042",name:"授权样本 B"},
  {id:"70140425",name:"授权样本 C"},
  {id:"70283261",name:"授权样本 D"}
];
const PLATFORMS=[
  {name:"Disney+",url:"https://www.disneyplus.com/",kind:"disney"},
  {name:"YouTube Premium",url:"https://www.youtube.com/premium",kind:"youtube"},
  {name:"Prime Video",url:"https://www.primevideo.com/",kind:"prime"},
  {name:"Max",url:"https://www.max.com/",kind:"max"},
  {name:"Apple TV+",url:"https://tv.apple.com/",kind:"apple"},
  {name:"Hulu",url:"https://www.hulu.com/",kind:"hulu"}
];

const COLOR={green:"#6EE7B7",blue:"#93C5FD",yellow:"#FCD34D",red:"#FDA4AF",muted:"#94A3B8"};
function txt(value,size=12,color="#E2E8F0",weight="regular") {
  return {type:"text",text:String(value),font:{size,weight},textColor:color,maxLines:1,minScale:0.6};
}
function line(name,detail,color=COLOR.blue) {
  return {type:"stack",direction:"row",alignItems:"center",gap:5,children:[
    {...txt(name,12,"#E5E7EB","medium"),flex:1},
    txt(detail,11,color,"semibold")
  ]};
}
function code(value) {
  const s=String(value||"").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(s)?s:"--";
}
function parseMeta(html,name) {
  const tags=html.match(/<meta\b[^>]{0,1800}>/gi)||[];
  for(const tag of tags) {
    if(!new RegExp('(?:property|name)\\s*=\\s*["\\x27]'+name+'["\\x27]','i').test(tag)) continue;
    const m=tag.match(/content\s*=\s*["']([^"']{1,200})["']/i);
    if(m) return m[1];
  }
  return "";
}
function hasHttpError(r) {return !!r.error||!r.status||r.status>=400;}
function pageBlocked(r) {
  if (r.error) return {state:"error",detail:"连接失败"};
  if (r.status===429) return {state:"unknown",detail:"429 限流"};
  if (r.status===401||r.status===403) return {state:"unknown",detail:r.status+" 拒绝访问"};
  if (r.status===451) return {state:"blocked",detail:"451 地区限制"};
  if (r.status>=500) return {state:"unknown",detail:"平台服务器异常"};
  if (r.status>=400) return {state:"unknown",detail:"HTTP "+r.status};
  if (r.status<200 || r.status>=300) return {state:"unknown",detail:"HTTP "+r.status};
  return null;
}
function netflixTitle(r, item) {
  if(r.error) return "unknown";
  // Netflix 原站的明确错误页；单独404也可能是片目下架，非一定VPN。
  if(r.status===404 || r.status===410) return "missing";
  if(r.status===403 || r.status===429 || r.status>=500 || r.status<200 || r.status>=300) return "unknown";
  const body=r.text||"";
  if(/NSEZ-403|page-404|<title[^>]*>\s*(?:Oh no!|Page Not Found)/i.test(body)) return "missing";
  if(/unusual traffic|captcha|access denied|please enable javascript/i.test(body)) return "unknown";
  // 有与指定片目对应的结构化内容才算可见；HTTP 200 / 通用登陆页不算。
  const og=parseMeta(body,"og:title");
  const titleMatch=body.match(/<title[^>]*>([^<]{2,220})<\/title>/i);
  const title=(og|| (titleMatch?titleMatch[1]:"")).trim();
  const looksLikeTitle=title.length>5 && !/^(netflix|sign in|log in|not found|oh no|home)[\s|:-]*$/i.test(title);
  const metadataId=new RegExp('(?:["\\x27](?:videoId|video_id|titleId|video_id)["\\x27]\\s*:\\s*["\\x27]?'+item.id+'\\b)','i').test(body);
  const named=item.name!=="授权样本 B" && item.name!=="授权样本 C" && item.name!=="授权样本 D";
  const namedTitle=named && title.toLowerCase().includes(item.name.toLowerCase());
  // 未知片名样本必须通过片目元数据ID + 标题两个证据。
  if(looksLikeTitle && (namedTitle || metadataId)) return "visible";
  return "unknown";
}
function nfSummary(results) {
  const orig=results[0].state;
  const lic=results.slice(1);
  const ok=lic.filter(x=>x.state==="visible").length;
  const missing=lic.filter(x=>x.state==="missing").length;
  const unknown=lic.length-ok-missing;
  let label="版权片 "+ok+"/"+lic.length+" · 待验证";
  let color=COLOR.yellow;
  if(orig==="missing") {label="原创页不可用 / 待核实";color=COLOR.red;}
  else if(orig==="unknown") {label="原创页未确认 · 待验证";color=COLOR.yellow;}
  else if(ok>0) {label="版权片线索 "+ok+"/"+lic.length;color=COLOR.green;}
  else if(missing>=3 && unknown===0) {label="疑似仅全球授权";color=COLOR.yellow;}
  else {label="版权片情况不明确";color=COLOR.yellow;}
  const origStr=orig==="visible"?"可见":orig==="missing"?"不可用":"待确认";
  return {label,color,detail:"原创 "+origStr+" · 版权片 "+ok+"可见/"+missing+"不可见/"+unknown+"未知",ok,missing,unknown};
}
function classifyPlatform(p,r) {
  const error=pageBlocked(r);
  if(error) return {name:p.name,label:error.detail,color:error.state==="blocked"?COLOR.red:COLOR.yellow};
  const body=r.text||"";
  const checks={
    disney:/error code 73|disney\+ is not available in your (country|region)|disneyplus is not available in your (country|region)|content isn't available to watch in your current location/i,
    youtube:/youtube premium is not available in your (country|region)|premium is not available in your (country|region)|premium isn't available in your (country|region)/i,
    max:/max is not available in your (country|region)|not available in your region/i,
    hulu:/hulu is not available in your (country|region)|only available in the (united states|u\.s\.)/i,
    prime:/this video is currently unavailable to watch in your location/i,
    apple:/this content is not available in your country or region/i
  };
  const yt=(p.kind==="youtube")?body.match(/["'](?:GL|countryCode)["']\s*:\s*["']([A-Za-z]{2})["']/):null;
  const pageRegion=yt?code(yt[1]):"--";
  if(checks[p.kind] && checks[p.kind].test(body)) {
    return {name:p.name,label:"疑似区域限制"+(pageRegion!=="--"?" · "+pageRegion:""),color:COLOR.red,pageRegion};
  }
  // 即使首页可打开，也不代表订阅/DRM/片库/实际播放可用。
  return {name:p.name,label:(pageRegion!=="--"?"页面 "+pageRegion+" · ":"")+"播放待验",color:COLOR.blue,pageRegion};
}

export default async function(ctx) {
  const env=ctx.env||{};
  const policy=String(env.POLICY||"").trim();
  const expect=code(env.EXPECT_REGION);
  const timeout=9000;
  const base={timeout,redirect:"follow",credentials:"omit"};
  if(policy) base.policy=policy;
  const headers={
    "Accept":"text/html,application/xhtml+xml,*/*;q=0.8",
    "Accept-Language":"en-US,en;q=0.8",
    "User-Agent":"Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1"
  };
  async function read(url,isJson=false) {
    try {
      const r=await ctx.http.get(url,{...base,headers: isJson?{"Accept":"application/json"}:headers});
      if(isJson) return {status:r.status,data:await r.json()};
      return {status:r.status,text:(await r.text()).slice(0,240000)};
    } catch(e) {return {status:0,error:String(e)};}
  }
  const geo1=read("https://ipwho.is/",true).then(r=>{
    if(r.status!==200||!r.data||r.data.success===false) return null;
    return {ip:String(r.data.ip||""),country:code(r.data.country_code),asn:r.data.connection&&r.data.connection.asn?String(r.data.connection.asn):"--"};
  });
  const geo2=read("https://api.country.is/",true).then(r=>{
    if(r.status!==200||!r.data||r.data.error) return null;
    return {ip:String(r.data.ip||""),country:code(r.data.country)};
  });
  const nfAll=[NF_ORIGINAL,...NF_LICENSED];
  const nftasks=nfAll.map(async item=>({id:item.id,state:netflixTitle(await read("https://www.netflix.com/title/"+item.id),item)}));
  const otherTasks=PLATFORMS.map(async p=>classifyPlatform(p,await read(p.url)));
  const all=await Promise.all([geo1,geo2,...nftasks,...otherTasks]);
  const g1=all[0],g2=all[1],nf=all.slice(2,2+nfAll.length),others=all.slice(2+nfAll.length);
  const nfData=nfSummary(nf);
  const geoConflict=!!(g1&&g2&&g1.country!=="--"&&g2.country!=="--"&&g1.country!==g2.country);
  const ipConflict=!!(g1&&g2&&g1.ip&&g2.ip&&g1.ip!==g2.ip);
  const trusted=!!(g1&&g2&&!geoConflict&&!ipConflict&&g1.country!=="--");
  const region=trusted?g1.country:((g1&&g1.country!=="--")?g1.country:((g2&&g2.country!=="--")?g2.country:"--"));
  let regionNote=trusted?"双源一致":(geoConflict?"定位国家冲突":(ipConflict?"出口 IP 不一致":"单源/未知"));
  let regionColor=trusted?COLOR.green:COLOR.yellow;
  if(expect!=="--"&&region!=="--"&&expect!==region) {
    regionNote="期望 "+expect+" / 实际 "+region;
    regionColor=COLOR.red;
  }
  const ip=(g1&&g1.ip)||(g2&&g2.ip)||"IP 未确认";
  const asn=(g1&&g1.asn&&g1.asn!=="--")?"AS"+g1.asn:"ASN 未知";
  const yt=others.find(x=>x.name==="YouTube Premium");
  const pageConflict=yt&&yt.pageRegion&&yt.pageRegion!=="--"&&region!=="--"&&yt.pageRegion!==region;
  if(pageConflict) {
    yt.label="页面 "+yt.pageRegion+" ≠ 出口 "+region;
    yt.color=COLOR.yellow;
  }
  const small=ctx.widgetFamily==="systemSmall";
  const medium=ctx.widgetFamily==="systemMedium";
  const accessory=String(ctx.widgetFamily||"").startsWith("accessory");
  if(accessory) {
    return {type:"widget",padding:8,children:[
      txt("流媒体 "+region+" · Netflix "+nfData.label,12,"#FFFFFF","medium")
    ]};
  }
  const children=[
    {type:"stack",direction:"row",alignItems:"center",gap:7,children:[
      {type:"image",src:"sf-symbol:play.rectangle.fill",color:"#93C5FD",width:18,height:16},
      {...txt("流媒体 · 严格检测",16,"#FFFFFF","bold"),flex:1},
      txt(region,13,regionColor,"bold")
    ]},
    txt(ip+" · "+asn,11,"#CDD5E2"),
    txt(regionNote+" · "+(policy||"当前分流"),10,regionColor,"medium"),
    line("Netflix",nfData.label,nfData.color)
  ];
  if(!small) {
    children.push(txt(nfData.detail,10,COLOR.muted));
    const cap=medium?3:PLATFORMS.length;
    for(const s of others.slice(0,cap)) children.push(line(s.name,s.label,s.color));
  }
  children.push(txt(small?"未验证播放/整库":"HTTP 片目线索 ≠ 账号片库 / DRM 播放",10,COLOR.muted));
  return {
    type:"widget",padding:small?12:16,gap:small?4:6,
    backgroundGradient:{type:"linear",colors:["#0C172E","#1B3052"],startPoint:{x:0,y:0},endPoint:{x:1,y:1}},
    refreshAfter:new Date(Date.now()+30*60*1000).toISOString(),
    children
  };
}
