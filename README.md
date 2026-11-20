# dsh-offpeak-guard

DSH 的**峰谷闸门**：峰期到了自动把正在跑的会话全停掉，谷期到了自动续跑，输入框上方常驻一条状态条（倒计时 + 开关 + 立即继续）。谷期价格是峰期的一半。

## 峰谷规则（DeepSeek 2026-09-19 起）

| 时段（北京时间） | 价格 |
|---|---|
| 周一至周五 9:00–12:00、14:00–18:00 | 峰期（原价） |
| 其余所有时段（含午休、夜里、周末、法定节假日全天） | 谷期（半价） |

节假日表按 2026 年国务院安排内置在 `index.js` 里，**每年 11 月要补下一年**。

## 装

```bash
dsh plugin --profile web add github:MIOM-2025/dsh-offpeak-guard
# 或者本地目录
dsh plugin --profile web add link:~/dsh-offpeak-guard
```

装完重启一次 `dsh web`，浏览器再刷新一下（前端那条状态条是插件带过来的）。

## 行为

- **进峰期**：正在跑的会话全部 `cancel`，记进暂停清单；峰期新起的会话（`turn/start`）也会被立刻停掉。
- **进谷期**：暂停清单里的会话逐个自动补一句「谷期到了，接着跑」，并在状态条上提示续跑了几个。
- **开关「等待谷期」**：默认开（所有会话统一）。关掉后峰期照跑，只显示状态不停机。
- **点「立即继续」**：立刻解除等待、续跑，并且这一轮峰期不会再被自动停（直到下次进谷期）。
- 状态存在 `~/.dsh/offpeak-guard/state.json`，日志在 `~/.dsh/offpeak-guard/offpeak.log`。

## 接口

```
GET  /offpeak-guard/api              当前状态（阶段、下次切换点、暂停清单）
POST /offpeak-guard/api/toggle       { waitOffPeak: true|false }
POST /offpeak-guard/api/resume-now   立刻续跑所有暂停的会话
POST /offpeak-guard/api/kick         手动跑一次判定
```

## 测试

```bash
node test/guard.mjs
```

