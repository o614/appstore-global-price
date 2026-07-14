# App Store 全球价格

一个基于 Apple 各地区公开 App Store 商品页快照的内购与订阅比价网站。

第一版覆盖 10 个常用应用和 10 个商店地区，保留每个地区公开的全部内购项目，区分月付、年付和一次性购买，并提供对应国家的 Apple 商店链接。人民币金额仅使用公开汇率进行参考折算。

## 本地运行

需要 Node.js `>=22.13.0`。

```bash
npm install
npm run dev
npm test
```

## 数据更新

```bash
node scripts/validate-iap-data.mjs --output data/validation-snapshot.json
node scripts/fetch-exchange-rates.mjs --output data/exchange-rates.json
```

网站展示的是抓取时点的公开快照，不代表实时结算价格；购买资格、税费和最终金额以 Apple 结算页面为准。

## 常用命令

- `npm run dev`：启动本地开发服务
- `npm run build`：生成可部署版本
- `npm test`：构建并验证首页和应用详情页
- `npm run lint`：检查代码规范
