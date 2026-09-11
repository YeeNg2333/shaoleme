# 烧了么 · shaoleme

> 挂在 DeepSeek Harness（DSH）界面上的小浮窗：**实时显示当前会话烧掉了多少 token、折算多少人民币。**

A floating real-time token & cost meter for DeepSeek Harness sessions, shipped as a
Cordis **dynamic plugin** (host + client halves).

![image](https://github.com/YeeNg2333/shaoleme/blob/main/show.gif)

当前版本 **v0.1.0**。

---

## 它显示什么

- 总 token（输入 + 输出，缓存命中另计）、输入/输出拆分、缓存命中、思考 token、模型调用次数
- 估算费用 **¥**（按 DeepSeek 官方价折算）
- 按模型拆分的用量与花费明细
- **价格表**：每个模型的「输入未命中 / 输入命中 / 输出」单价可直接在浮窗里改

## 交互

- 悬停即时展开，移出即时收起
- 浮窗位于屏幕中部时以鼠标为中心**四向展开**；靠近屏幕底部时改为**向上长出**，标题原地不动
- 展开卡上**单击保持展开**；只有真正拖动（≥ 4px）才整块收缩并 1:1 跟随指针，松手后弹性归位并自动重新展开
- 浮窗可拖到任意位置，带边缘阻尼与惯性投影（松手后的落点按动量预测）

## 计费口径

价目来源：DeepSeek 官方「模型 & 价格」<https://api-docs.deepseek.com/zh-cn/quick_start/pricing>

**哦我的天呐先生，你说梁圣发布了什么？！！deepseek-4.1，先生，这得省不少钱**

| 模型 | 输入（缓存未命中） | 输入（缓存命中） | 输出 |
| --- | --- | --- | --- |
| `deepseek-v4-flash` | ¥1.5 | ¥0.05 | ¥4.5 |
| `deepseek-v4-flash-vision-exp` | ¥1.5 | ¥0.05 | ¥4.5 |
| `deepseek-v4-pro` | ¥4.5 | ¥0.15 | ¥13.5 |

单位为 **元 / 百万 tokens**，表中为**空闲时段**价格。

- **高峰时段 = 空闲 × 2**；高峰定义为北京时间 **周一~周五 09:00-12:00、14:00-18:00**，其余为空闲时段
- 计费按**每条 `assistant/message` 的事件时间**落入对应窗口后取价——不是按"当前时刻"把整段乘系数
- `usage` 是互斥计数：`inputTokens` 为未命中输入、`cacheReadTokens` 为命中输入（另计），总 token = 输入 + 命中 + 输出
- 费用是**估算**：官方不提供"按会话的花费"接口，这里用官方单价 × 真实 usage 折算；实际扣费以 DeepSeek 账单为准
- 价格表里的改动**只在本次运行内有效**（动态插件的内存态，重启即回到官方价）

## 数据与隐私

- 只读取当前 DSH 会话的**内存事件快照**（通过 `sessions` 服务），不写盘、不上传、不采集
- v0.1.0 不发起**任何**网络请求，也不需要 API Key

## 安装 / 使用

1. 打开 DSH Web GUI
2. 打开插件面板的「定义插件」
3. **Host** 一栏粘贴 `host.js` 的全部内容，**Client** 一栏粘贴 `client.js` 的全部内容
4. 点「运行」，在界面上允许一次（Client 侧需要审批）
5. 打开任意会话，右下角即出现浮窗

命令行 / Agent 方式等价：把两个文件内容分别作为 `cordis_define` 的 `code.host` 与 `code.client`，然后 `cordis_run`。

> ⚠️ 动态插件只存在于**当前 DSH 进程**，进程重启后会消失，重新粘贴一次即可恢复。要做到"每次会话自动加载"，需要移植成静态包，见 Roadmap。

## 文件

| 文件 | 说明 |
| --- | --- |
| `host.js` | Host half（`code.host` 的函数体）：会话事件折叠、¥ 折算、快照缓存、价格覆盖 |
| `client.js` | Client half（`code.client` 的函数体）：浮窗 UI、悬停/拖拽交互、与 Host 的 RPC |
| `scripts/check.mjs` | 语法与结构自检（CI 使用） |

`host.js` / `client.js` 都是**函数体**（以 `return {` 开头），不是可独立运行的模块——直接 `node host.js` 会报错，这是 DSH 动态插件的约定；自检脚本用 `new AsyncFunction(...)` 包一层来解析与校验结构。

## Roadmap

- [ ] **峰谷拆分展示**：本会话高峰/低谷各自消耗的 token 与花费，以及"当前是否处于高峰（×2）"的实时指示
- [ ] **双档价表**：空闲/高峰两套价格分别编辑（当前只存空闲档，高峰由 ×2 推导）
- [ ] **余额显示**：调用官方 `GET /user/balance` 展示账户余额（<https://api-docs.deepseek.com/zh-cn/api/get-user-balance>）
- [ ] 价格与高峰窗口**持久化**（重启后保持）
- [ ] 历史会话的峰谷花费统计 CLI（扫描 `$DSH_HOME/sessions` 下的会话存储）
- [ ] **静态包形态**：把两半移植成 monorepo 静态插件，实现"每次会话自动加载"

## 开发

```bash
node scripts/check.mjs   # 解析两个插件体并校验返回结构
```

## 许可

[MIT](LICENSE) © 2026 YeeNg
