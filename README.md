# App Store 订阅比价

一个基于 Apple 各地区公开 App Store 商品页和官方服务方案页的内购与订阅比价网站。精选目录和变动日志仍是静态快照；未收录应用可通过 Cloudflare Pages Function 临时搜索和比较，不使用数据库或 KV。

公开地址：<https://price.290935.xyz>

精选目录维护常用应用与 Apple 服务；自定义搜索不限制 App，但所有入口都只比较固定的 18 个地区：中国、美国、香港、台湾、越南、日本、英国、德国、加拿大、土耳其、澳大利亚、印度、巴西、印度尼西亚、墨西哥、新西兰、阿联酋和沙特阿拉伯。普通 App 读取公开内购项目；Apple Music、iCloud+、Apple One、Apple TV+、Apple Arcade、Apple Fitness+ 和 Apple News+ 读取各地区 Apple 官方价格页。页面区分月付、年付和一次性购买，并提供对应国家的官方来源链接。人民币金额仅使用公开汇率进行参考折算。

## 本地运行

需要 Node.js `>=22.13.0`。

```bash
npm install
npm run dev
npm test
```

## 数据更新

日常本地维护只需运行：

```bash
npm run data:update
```

它会先生成候选价格和汇率，全部校验通过后再一起发布到 `data/`；抓取或校验失败不会覆盖当前网站数据。完整的配置入口、新增应用和地区调整步骤见 [`docs/maintenance.md`](docs/maintenance.md)，视觉与交互约束见 [`docs/design-system.md`](docs/design-system.md)。

“检测并发布 App Store 订阅变动”工作流在北京时间 06:37、14:37 和 22:37 自动运行，也支持手动触发。第一次发现变化后会等待 8 分钟并重新完整抓取；只有两次变化指纹一致、数据校验和静态构建全部通过时才提交新快照。工作流固定使用 `data/catalog-config.json` 中的 App ID 和数据源，并以 `data/regions.json` 作为抓取、汇率、前端名称、App Store 换区链接和校验规则的唯一地区清单。

前端会自动发现快照里的全部公开项目及同名重复项，并统一优先展示主要订阅、折叠其他购买项目；手工套餐配置只负责优化名称和周期，不决定项目是否保留。新增内购会随下一次有效快照自动出现在页面，覆盖测试会检查每个名称和出现次数都能在比价面板中找到。

已确认的数据提交后，工作流会等待 Cloudflare Pages 部署，并通过公开部署标记验证线上版本；只有验证成功才发送 Bark 上线通知。任务失败会保留上一版数据并发送 Bark。需要在仓库的 Actions secrets 中添加：

```text
BARK_PUSH_URL=https://api.day.app/你的设备密钥
```

可选添加仓库变量 `PUBLIC_SITE_URL`，Bark 发布成功通知会跳转到公开网站。

公开订阅变动日志不使用 KV、数据库或运行时缓存。它在正式发布时写入静态 JSON，只保留最近 30 次发布记录，并删除页面不展示的抓取内部字段。新增或删除目录应用等维护操作仅写入 Action 内部摘要，不进入公开日志或 Bark。

本地抓取和验证：

```bash
npm run data:fetch
npm run data:check
```

抓取器对 App Store 请求统一限速，遇到 429 会读取 `Retry-After` 并指数退避。人工排障时可用 `--reuse <候选快照>` 复用已经验证的地区行，只重抓失败项；正常价格更新仍会完整重抓全部页面。

网站展示的是抓取时点的公开快照，不代表实时结算价格；购买资格、税费和最终金额以 Apple 结算页面为准。

## 常用命令

- `npm run dev`：启动本地开发服务
- `npm run build`：在 `out/` 生成静态页面；仓库根目录的 `functions/` 由 Cloudflare Pages 同时部署
- `npm test`：构建并验证首页和全部应用详情页
- `npm run lint`：检查代码规范
- `npm run data:update`：安全更新价格快照和汇率

## 自定义应用查询

`/search/` 接受应用名称、App ID 或 App Store 链接。`/api/apps/search` 只负责在 Apple 公开接口中定位应用，`/api/apps/compare/{id}` 再逐区读取固定 18 个地区的公开内购。单个 Apple 请求和整次查询均有时间与响应体积上限；某个地区超时、限流或解析失败只会标记该地区，不会中止其余地区，也不会把降级响应写入边缘缓存。

临时查询使用 Cloudflare Cache API 限时缓存搜索和比价响应，不写入 KV、精选目录或订阅变动日志。`public/_routes.json` 将 Pages Function 严格限制在 `/api/*`，其余页面继续按静态文件提供。Pages Function 只接受 GET，并为全部 API 响应添加安全响应头；生产环境还应按 [`docs/maintenance.md`](docs/maintenance.md) 的规则在 Cloudflare WAF 启用接口限流。
