# 维护手册

这套站点把“维护配置”和“抓取结果”分开，日常更新不需要修改页面组件。

## 一条命令更新价格

```bash
npm run data:update
```

命令按顺序完成三件事：抓取候选快照、对照当前快照做安全校验、抓取固定地区所需汇率。三步全部成功后才同时替换 `data/validation-snapshot.json` 和 `data/exchange-rates.json`；失败时保留旧数据。

仅想查看候选结果时运行 `npm run data:fetch`，输出位于 `.tmp/price-snapshot.json`，不会覆盖网站当前数据。`npm run data:check` 用于复核已经发布的快照。

新增应用时优先运行：

```bash
npm run data:add
```

这个命令复用现有应用已经发布的安全数据，只抓取总表中新加入的 App，并按每批 2 个应用处理。每批完成都会写入候选快照；任务意外中断时，可把该候选快照作为 `--reuse` 输入继续，最终仍要通过完整校验才会发布。日常检查订阅变动仍使用 `npm run data:update`，它会重新抓取全部应用，不能复用旧价格。

## 应用总表

`data/catalog-config.json` 是应用目录、分类顺序和抓取数据源的唯一总表。数组顺序就是网站的分类及卡片顺序；普通 App 最少只需写 App ID：

```json
{ "id": "6474233312" }
```

名称、开发者、高清图标、官方分类和 App Store 链接会从 Apple Lookup API 自动补齐。如果 Apple 的官方分类不适合作为本站分组，可在同一行增加可选的 `group`：

```json
{ "id": "6474233312", "group": "AI 助手" }
```

`query` 不再是普通 App 的必填字段。Apple 自有服务不是普通 App Store 内购页，仍需保留 `priceSource`、`service` 和 `metadata`。

同一品牌在个别地区使用不同的官方 App ID 时，只配置已经由 Apple 官方页面确认的地区映射，不猜测其他地区：

```json
{ "id": "376510438", "regionalAppIds": { "jp": "549416492" } }
```

如果公开内购列表混有与订阅比价无关的一次性打赏项目，可按 Apple 页面上的完整名称排除：

```json
{ "id": "6474233312", "excludeItemNames": ["Give Kimi some snacks !"] }
```

排除规则只用于明显不属于订阅套餐的项目，不用于隐藏价格或补齐缺失套餐。

## GitHub Actions 自动抓取

提交 `data/catalog-config.json` 到 `main` 后，`应用总表自动抓取` Action 会自动运行 `npm run data:add`，按每批 2 个应用抓取新增项或特殊地区映射，校验完整静态网站，并把价格快照、汇率和订阅变动日志提交回仓库。也可以在 GitHub Actions 页面手动运行该任务。

因此日常新增 App 不需要由 Codex 执行抓取：维护总表并提交即可。全量检查所有现有应用仍使用 `手动更新 App Store 价格` Action。

自动任务按应用和地区独立处理故障。网络超时、限流或解析异常发生时，已有应用会保留对应地区上一版已验证数据并继续抓取后续内容；全新应用首次抓取失败则暂缓加入网站，下一次任务会自动重试。404 或当地未上架仍保留为官方不可用状态，不会误用其他地区价格补齐。Action 摘要会列出本次复用和暂缓项目；只有地区配置、汇率或快照结构等全局校验失败才停止发布。

## 其他唯一配置入口

| 维护内容 | 文件 | 说明 |
| --- | --- | --- |
| 固定比价地区 | `data/regions.json` | 地区名、币种、Apple storefront 与官方站点；前端、抓取、汇率、测试共用 |
| 应用、类别与数据源 | `data/catalog-config.json` | App ID、可选类别或 Apple 服务抓取类型 |
| 套餐显示名 | `data/plan-definitions.json` | 只优化名称、周期和同名项目次序，不决定套餐是否出现 |
| 国旗 | `public/flags/{code}.png` | 由地区代码自动定位，无需在 JSON 重复配置路径 |
| 当前价格快照 | `data/validation-snapshot.json` | 自动生成，不手工修改 |
| 当前参考汇率 | `data/exchange-rates.json` | 自动生成，不手工修改 |

前端会自动发现抓取结果里的全部公开内购项目。应用新增套餐后，只要 Apple 公开页面能抓到，下一次有效更新就会进入面板；没有友好名称时先显示 Apple 原始名称，随后再在 `plan-definitions.json` 补充别名即可。

## 新增应用

1. 打开 `data/catalog-config.json`，在希望展示的位置添加 `{ "id": "640199958", "group": "Apple 服务" }`；普通 App 不需要手写名称和图标。
2. 提交到 `main`。`应用总表自动抓取` Action 会自动读取 Apple 元数据、分批抓取 20 个地区、校验并提交生成结果，无需让 Codex 手工抓取。
3. 如果同一品牌只在某个地区使用另一官方 App ID，才增加 `regionalAppIds`；如果 Apple 内购列表含明确的打赏项，才用完整名称配置 `excludeItemNames`。
4. 仅当 Apple 原始套餐名不够清楚时，再维护 `data/plan-definitions.json`。需要立即重试时，可在 GitHub Actions 页面手动运行 `应用总表自动抓取`。

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
