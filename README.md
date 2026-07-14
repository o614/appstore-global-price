# App Store 全球价格

一个基于 Apple 各地区公开 App Store 商品页快照的内购与订阅比价网站。网站构建后是纯静态文件，不需要付费 Worker、数据库或运行时接口。

第一版覆盖 10 个常用应用和 10 个商店地区，保留每个地区公开的全部内购项目，区分月付、年付和一次性购买，并提供对应国家的 Apple 商店链接。人民币金额仅使用公开汇率进行参考折算。

## 本地运行

需要 Node.js `>=22.13.0`。

```bash
npm install
npm run dev
npm test
```

## 数据更新

价格发布只允许手动触发：在 GitHub 仓库的 Actions 页面运行“手动更新 App Store 价格”。工作流会固定使用 `data/catalog-config.json` 中的 App ID，抓取并校验全部地区；只有构建测试成功才会提交新快照。

“检测 App Store 价格变化”工作流每天运行四次，只比较数据并发送提醒，不会修改网站。需要在仓库的 Actions secrets 中添加：

```text
BARK_PUSH_URL=https://api.day.app/你的设备密钥
```

可选添加仓库变量 `PUBLIC_SITE_URL`，Bark 发布成功通知会跳转到公开网站。

本地抓取和验证：

```bash
npm run data:fetch
npm run data:check
```

网站展示的是抓取时点的公开快照，不代表实时结算价格；购买资格、税费和最终金额以 Apple 结算页面为准。

## 常用命令

- `npm run dev`：启动本地开发服务
- `npm run build`：在 `out/` 生成 Cloudflare Pages 可直接托管的纯静态文件
- `npm test`：构建并验证首页和全部应用详情页
- `npm run lint`：检查代码规范
