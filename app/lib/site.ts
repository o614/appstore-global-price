export const publicStatusPageUrl =
  process.env.NEXT_PUBLIC_STATUS_PAGE_URL ?? "https://stats.uptimerobot.com/WdwUGk8mc9";

export const publicSiteLinks = {
  blog: "https://290935.xyz/",
  linuxDo: "https://linux.do/u/d.to/summary",
  zhihu: "https://www.zhihu.com/people/ehpass",
} as const;

export const publicContact = {
  officialAccount: "不要艾特我",
  serviceDescription: "注册、充值、订阅一站式服务",
  serviceWechat: "ehpass",
} as const;
