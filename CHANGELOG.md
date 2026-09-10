# Changelog

本项目的所有重要变更都记录在此文件。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [0.1.0] — 2026-09-08

首个开源版本，形态为 DSH **动态 Cordis 插件**（host + client 两半）。

### 新增

- 浮窗读数：总 token、输入/输出拆分、缓存命中、思考 token、模型调用次数、估算费用 ¥、按模型的用量与花费明细。
- 交互：悬停即时展开/收起；屏幕中部以鼠标为中心四向展开，靠近底部时向上长出且标题原地不动；展开卡上单击保持展开，实际拖动（≥4px）才整块收缩并 1:1 跟随指针，松手后弹性归位并可重新展开；浮窗可拖拽到任意位置（带边缘阻尼与惯性投影）。
- 计费：内置 DeepSeek 官方 v4 系列价卡（空闲档，元/百万 tokens），按每条 `assistant/message` 的事件时间落入北京时间高峰窗口（周一~周五 09:00-12:00、14:00-18:00）后按 ×2 计价。
- 价格表：浮窗内可直接编辑每个模型的三项单价（输入未命中/输入命中/输出），进程内生效。

[0.1.0]: https://github.com/yeeng2333/shaoleme/releases/tag/v0.1.0
