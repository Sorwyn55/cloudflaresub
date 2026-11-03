export default async function(ctx) {
  const url = ctx.request?.url || "";
  const body = ctx.response?.body;
  if (typeof body !== "string" || !body.length) return;

  let obj;
  try {
    obj = JSON.parse(body);
  } catch {
    return;
  }

  const deleteDataPaths = [
    "/post/homepage/guide/card",
    "/furion/position/content",
    "/hot/soul/rank",
    "/post/gift/list",
    "/mobile/app/version/queryIos",
    "/teenager/config",
    "/winterfell/v2/getIpByDomain",
    "/official/scene/module"
  ];

  if (obj?.data && deleteDataPaths.some(path => url.includes(path))) {
    delete obj.data;
  }

  if (url.includes("/chat/limitInfo") && obj?.data && Object.prototype.hasOwnProperty.call(obj.data, "limit")) {
    obj.data.limit = false;
  }

  if (url.includes("/v6/planet/config")) {
    const removeTitles = new Set([
      "异世界回响",
      "狼人魅影",
      "梦想海岛王",
      "幻想星球",
      "爆弹喵",
      "星球实验室",
      "兴趣群组",
      "群聊派对"
    ]);

    if (Array.isArray(obj?.data?.gameInfo?.gameCards)) {
      obj.data.gameInfo.gameCards = obj.data.gameInfo.gameCards.filter(card => !removeTitles.has(card?.title));
    }

    if (Array.isArray(obj?.data?.coreCards)) {
      obj.data.coreCards = obj.data.coreCards.filter(card => !removeTitles.has(card?.title));
      for (const card of obj.data.coreCards) {
        if (Array.isArray(card?.secondCards)) {
          card.secondCards = card.secondCards.filter(sc => !removeTitles.has(sc?.title));
        }
      }
    }
  }

  if (Array.isArray(obj?.data?.coreCards)) {
    for (const card of obj.data.coreCards) {
      if (card?.style === 2) card.style = 1;
    }
  }

  return {
    body: JSON.stringify(obj)
  };
}
