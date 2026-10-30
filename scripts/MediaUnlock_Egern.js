// Egern 流媒体可用性初筛 / Media Reachability Check
// 说明：不修改分流、DNS、证书或平台响应；网页探测不等于实际播放解锁。
// Egern JavaScript API: https://egernapp.com/docs/javascript-api/

const SITES = [
  {name:"Netflix", url:"https://www.netflix.com/title/70143836", kind:"netflix"},
  {name:"Disney+", url:"https://www.disneyplus.com/", kind:"disney"},
  {name:"YouTube Premium", url:"https://www.youtube.com/premium", kind:"youtube"},
  {name:"Prime Video", url:"https://www.primevideo.com/", kind:"prime"},
  {name:"Max", url:"https://www.max.com/", kind:"max"},
  {name:"Apple TV+", url:"https://tv.apple.com/", kind:"apple"}
];

function t(value, size=12, color="#E5E7EB", weight="regular") {
  return {type:"text",text:String(value),font:{size,weight},textColor:color,maxLines:1,minScale:0.65};
}

function row(left, right, color="#CBD5E1") {
  return {type:"stack",direction:"row",alignItems:"center",gap:8,children:[
    {...t(left,12,"#E2E8F0","medium"),flex:1},
    t(right,11,color,"semibold")
  ]};
}

function classify(site, result) {
  if (result.error) return {label:"检测失败", color:"#F59E0B"};
  if ([401,403,429].includes(result.status)) return {label:"服务拒绝请求",color:"#F59E0B"};
  if (result.status === 451) return {label:"访问受限 (451)",color:"#F87171"};
  if (result.status === 404) return {label:"资源不可用 (404)",color:"#F59E0B"};
  if (result.status >= 500) return {label:"网站服务异常",color:"#F59E0B"};
  if (result.status < 200 || result.status >= 400) return {label:"响应 " + result.status,color:"#F59E0B"};
  const html = result.text || "";
  if (site.kind === "netflix") {
    // 特定非自制剧页面的可见性，仅是片库信号，不等于能登录或播放。
    if (/Breaking Bad/i.test(html)) return {label:"片目页面可见",color:"#34D399"};
    return {label:"页面可达 / 片库待验",color:"#93C5FD"};
  }
  if (site.kind === "youtube" &&
      /premium is not available in your country|premium is not available in your region|youtube premium is not available/i.test(html)) {
    return {label:"疑似地区限制",color:"#F87171"};
  }
  if (site.kind === "disney" &&
      /disney\+ is not available in your (country|region)|disneyplus is not available in your (country|region)/i.test(html)) {
    return {label:"疑似地区限制",color:"#F87171"};
  }
  if (site.kind === "max" &&
      /max is not available in your (country|region)/i.test(html)) {
    return {label:"疑似地区限制",color:"#F87171"};
  }
  return {label:"网站可访问",color:"#34D399"};
}

export default async function(ctx) {
  const policy = String((ctx.env && ctx.env.POLICY) || "").trim();
  const opts = {timeout:9000, redirect:"follow", credentials:"omit",
    headers:{"Accept":"text/html,application/xhtml+xml,*/*;q=0.8",
      "Accept-Language":"en-US,en;q=0.8",
      "User-Agent":"Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1"}
  };
  if (policy) opts.policy = policy;

  async function request(url) {
    try {
      const resp = await ctx.http.get(url,opts);
      const body = await resp.text();
      return {status:resp.status,text:body.slice(0,220000)};
    } catch (e) {
      return {status:0,error:String(e)};
    }
  }

  const tasks = [
    (async () => {
      try {
        const ipOpts = {timeout:9000,redirect:"follow",credentials:"omit"};
        if (policy) ipOpts.policy = policy;
        const r = await ctx.http.get("https://ipwho.is/", ipOpts);
        if (r.status !== 200) return {ip:"查询失败",country:"--",asn:"--"};
        const data = await r.json();
        if (!data || data.success === false) return {ip:"查询失败",country:"--",asn:"--"};
        return {
          ip:String(data.ip || "未知"),
          country:String(data.country_code || "--").toUpperCase(),
          asn:data.connection && data.connection.asn ? String(data.connection.asn) : "--"
        };
      } catch(e) {return {ip:"查询失败",country:"--",asn:"--"};}
    })(),
    ...SITES.map(async site => ({name:site.name,...classify(site,await request(site.url))}))
  ];

  const all = await Promise.all(tasks);
  const ip = all[0];
  const services = all.slice(1);
  const family = ctx.widgetFamily || "systemLarge";
  const small = family === "systemSmall";
  const accessory = family.indexOf("accessory") === 0;
  const limit = small ? 2 : family === "systemMedium" ? 4 : 6;
  const routeLabel = policy ? ("策略：" + policy) : "策略：按现有分流";

  if (accessory) {
    return {type:"widget",padding:8,children:[
      t("流媒体 " + ip.country + " · " + services[0].name + " " + services[0].label,12)
    ]};
  }

  const children = [
    {type:"stack",direction:"row",alignItems:"center",gap:7,children:[
      {type:"image",src:"sf-symbol:play.rectangle.fill",color:"#60A5FA",width:21,height:19},
      {...t("流媒体解锁初筛",16,"#FFFFFF","bold"),flex:1},
      t(ip.country,12,"#93C5FD","bold")
    ]},
    t(ip.ip + (ip.asn !== "--" ? ("  ·  AS" + ip.asn) : ""),11,"#9CA3AF"),
    t(routeLabel,10,"#9CA3AF")
  ];

  for (const item of services.slice(0,limit)) children.push(row(item.name,item.label,item.color));

  children.push(t("仅网页/片目检测；实际播放需人工确认",10,"#94A3B8"));

  return {
    type:"widget",padding:small?12:16,gap:small?4:7,
    backgroundGradient:{type:"linear",colors:["#101A31","#172846"],startPoint:{x:0,y:0},endPoint:{x:1,y:1}},
    refreshAfter:new Date(Date.now()+30*60*1000).toISOString(),
    children
  };
}
