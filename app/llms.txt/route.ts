import { apps, dataGeneratedAt, regionMeta } from "../lib/catalog";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://price.290935.xyz";

export const dynamic = "force-static";

export function GET() {
  const appLinks = apps
    .map((app) => `- [${app.matchedName}](${siteUrl}/apps/${app.id}/): ${app.category}，比较公开的 Apple 官方价格。`)
    .join("\n");
  const generatedAt = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(dataGeneratedAt));

  const content = `# App Store 订阅比价

> 比较同一 App 或 Apple 订阅服务在 ${Object.keys(regionMeta).length} 个固定地区的官方价格，保留原币标价，人民币金额仅供横向参考。

本站按月付、年付和一次性购买分别比较。服务不可用、官方价格未公开与解析失败是三种不同状态；本站不会猜测国家网址，也不会用其他地区的价格补齐。

## 主要页面

- [首页与应用目录](${siteUrl}/): 浏览全部已收录应用与 Apple 订阅服务。
- [搜索任意应用](${siteUrl}/search/): 输入应用名称、App ID 或 App Store 链接，临时比较同一组固定 ${Object.keys(regionMeta).length} 个地区；查询不会加入目录或变动日志。
- [订阅变动日志](${siteUrl}/changes/): 查看已经校验并发布的套餐调价、新增、移除和可用状态变化。
- [XML Sitemap](${siteUrl}/sitemap.xml): 机器可读的完整公开页面清单。

## 应用与服务

${appLinks}

## 数据说明

- 数据来源：对应地区的 App Store 公开商品页或 Apple 官方服务页面。
- 比价范围：固定 ${Object.keys(regionMeta).length} 个地区；不同购买周期分别排名。
- 人民币金额：按公开汇率折算，仅供参考。
- 最近价格快照：${generatedAt}（Asia/Shanghai）。
- 最终价格、购买资格与税费：以对应地区 Apple 结算页为准。
`;

  return new Response(content, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=0, must-revalidate",
    },
  });
}
