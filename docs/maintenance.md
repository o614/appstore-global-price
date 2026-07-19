# 维护手册

这套站点把“维护配置”和“抓取结果”分开，日常更新不需要修改页面组件。

## 一条命令更新价格

```bash
npm run data:update
```

命令按顺序完成三件事：抓取候选快照、对照当前快照做安全校验、抓取固定地区所需汇率。三步全部成功后才同时替换 `data/validation-snapshot.json` 和 `data/exchange-rates.json`；失败时保留旧数据。

仅想查看候选结果时运行 `npm run data:fetch`，输出位于 `.tmp/price-snapshot.json`，不会覆盖网站当前数据。`npm run data:check` 用于复核已经发布的快照。

## 唯一配置入口

| 维护内容 | 文件 | 说明 |
| --- | --- | --- |
| 固定比价地区 | `data/regions.json` | 地区名、币种、Apple storefront 与官方站点；前端、抓取、汇率、测试共用 |
| 应用与数据源 | `data/catalog-config.json` | App ID 或 Apple 服务抓取类型 |
| 套餐显示名 | `data/plan-definitions.json` | 只优化名称、周期和同名项目次序，不决定套餐是否出现 |
| 国旗 | `public/flags/{code}.png` | 由地区代码自动定位，无需在 JSON 重复配置路径 |
| 当前价格快照 | `data/validation-snapshot.json` | 自动生成，不手工修改 |
| 当前参考汇率 | `data/exchange-rates.json` | 自动生成，不手工修改 |

前端会自动发现抓取结果里的全部公开内购项目。应用新增套餐后，只要 Apple 公开页面能抓到，下一次有效更新就会进入面板；没有友好名称时先显示 Apple 原始名称，随后再在 `plan-definitions.json` 补充别名即可。

## 新增应用

1. 在 `data/catalog-config.json` 添加固定 App ID 和数据源类型。
2. 运行 `npm run data:update`。
3. 运行 `npm test`，确认 20 个地区、套餐覆盖和静态详情页都通过。
4. 仅当原始套餐名不够清楚时，再维护 `data/plan-definitions.json`。

## 调整地区

地区清单是产品级固定约束，不能因为某个应用临时缺价而随意增删。确需调整时：

1. 修改 `data/regions.json`，同时保留全局唯一的两位小写地区代码。
2. 放入同名旗帜文件 `public/flags/{code}.png`。
3. 更新 `tests/regions.test.mjs` 的固定顺序。
4. 完整运行 `npm run data:update && npm test`。

## Apple 自有服务图标

Apple 服务使用已确认来源的本地高清资源，统一放在 `public/service-icons/`，路径由 `data/catalog-config.json` 的 `metadata.icon` 配置。普通 App 图标继续使用 Apple 元数据返回的 CDN 地址；两类图标都由 `AppArtwork` 统一渲染，不在卡片中分别维护，也不自行绘制或仿制。

iCloud+ 当前图标来自维基百科的 iCloud 条目；更换本地文件时保留 `apple-icloud-plus.png` 文件名即可，无需修改页面组件。

## 发布前检查

```bash
npm run lint
npm test
```

检查浏览器控制台无错误，并至少验收桌面宽屏、390px 手机宽度及“减少动态效果”模式。价格页始终同时保留原币标价与人民币参考折算。
