# App Store 全球价格

一个基于 Apple 各地区公开 App Store 商品页和官方服务方案页快照的内购与订阅比价网站。网站构建后是纯静态文件，不需要付费 Worker、数据库或运行时接口。

公开地址：<https://price.290935.xyz>

当前覆盖 17 个常用应用与 Apple 服务，以及固定的 20 个地区：中国、美国、香港、台湾、越南、新加坡、日本、韩国、泰国、英国、德国、法国、加拿大、土耳其、澳大利亚、菲律宾、尼日利亚、印度、巴西和印度尼西亚。普通 App 读取公开内购项目；Apple Music、iCloud+、Apple One、Apple TV+、Apple Arcade、Apple Fitness+ 和 Apple News+ 读取各地区 Apple 官方价格页。页面区分月付、年付和一次性购买，并提供对应国家的官方来源链接。人民币金额仅使用公开汇率进行参考折算。

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

价格发布只允许手动触发：在 GitHub 仓库的 Actions 页面运行“手动更新 App Store 价格”。工作流会固定使用 `data/catalog-config.json` 中的 App ID 和数据源，并以 `data/regions.json` 作为抓取、汇率、前端名称、App Store 换区链接和校验规则的唯一地区清单；只有构建测试成功才会提交新快照。

前端会自动发现快照里的全部公开项目及同名重复项；手工套餐配置只负责优化名称和周期，不再决定项目是否显示。新增内购会随下一次有效快照自动出现在页面，覆盖测试会检查每个名称和出现次数都能在比价面板中找到。

“检测 App Store 价格变化”工作流每天运行四次，只比较数据并发送提醒，不会修改网站。需要在仓库的 Actions secrets 中添加：

```text
BARK_PUSH_URL=https://api.day.app/你的设备密钥
```

可选添加仓库变量 `PUBLIC_SITE_URL`，Bark 发布成功通知会跳转到公开网站。

公开价格日志不使用 KV、数据库或运行时缓存。它在正式发布时写入静态 JSON，只保留最近 30 次发布记录，并删除页面不展示的抓取内部字段，因此访客打开页面时不会产生存储读取。

本地抓取和验证：

```bash
npm run data:fetch
npm run data:check
```

抓取器对 App Store 请求统一限速，遇到 429 会读取 `Retry-After` 并指数退避。人工排障时可用 `--reuse <候选快照>` 复用已经验证的地区行，只重抓失败项；正常价格更新仍会完整重抓全部页面。

网站展示的是抓取时点的公开快照，不代表实时结算价格；购买资格、税费和最终金额以 Apple 结算页面为准。

## 常用命令

- `npm run dev`：启动本地开发服务
- `npm run build`：在 `out/` 生成 Cloudflare Pages 可直接托管的纯静态文件
- `npm test`：构建并验证首页和全部应用详情页
- `npm run lint`：检查代码规范
- `npm run data:update`：安全更新价格快照和汇率
