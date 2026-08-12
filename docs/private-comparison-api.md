# 公众号订阅比价私有 API

该接口只供 `o614/gzhbot` 调用，不面向浏览器或第三方开放。Web 与公众号继续保持两个独立仓库。

## Cloudflare Pages 配置

在 Pages 项目的生产环境中添加：

- KV 绑定：`PRICE_COMPARE_KV`
- 加密变量：`PRICE_COMPARE_API_SECRET`

密钥至少使用 32 个随机字节，不写入仓库。公众号 Vercel 项目必须配置同一份密钥。

## Vercel 配置

公众号项目添加：

- `PRICE_COMPARE_API_URL=https://price.290935.xyz/api/apps/private`
- `PRICE_COMPARE_API_SECRET=<与 Cloudflare 相同的密钥>`

## 接口

所有接口只接受 `POST`，请求头包含 Unix 秒时间戳与 HMAC-SHA256 签名：

- `x-price-timestamp`
- `x-price-signature`

签名原文为：

```text
时间戳\n请求方法\nURL 路径\n原始 JSON 请求体
```

可用路径：

- `/health`：检查鉴权、KV 与快照状态，不触发抓取。
- `/search`：按名称、App ID 或 App Store 链接返回最多三个候选。
- `/compare`：读取快照或缓存；未收录 App 启动固定 20 区抓取。

## 缓存与降级

- 正常缓存 12 小时。
- 热门 App 最快每 3 小时后台刷新。
- 旧缓存最多兜底 7 天。
- 同一 App 的抓取使用短锁降低并发重复；单个地区失败不会终止其他地区。
- 无缓存的首次抓取最多等待约 2.8 秒，未完成返回 `202 pending`，后台继续抓取。
- 全局限流为每分钟 60 个签名请求，限流时优先使用已有缓存。
- 精选 App 与 Apple 官方服务直接复用网站快照；临时查询不会加入公开目录或价格日志。

Cloudflare KV 是最终缓存，公众号 KV 只保存三分钟会话、匿名运营聚合和热门判断。
