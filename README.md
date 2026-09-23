# OfferConsole

你的校招求职控制台：简历库管理、网申表单自动填写、投递进度跟踪。

浏览器扩展（Chrome / Edge，Manifest V3），数据本地优先，可选接入任意 OpenAI 兼容的大模型服务。

## 功能

| 功能 | 说明 |
| --- | --- |
| 资料库 | 集中维护基本信息、教育经历（本科/研究生独立）、实习与项目、技能证书与自定义字段 |
| 简历库 | 支持 PDF / DOCX / Markdown / TXT / JSON；多简历按求职方向分类，独立解析互不覆盖 |
| 快速填充 | 识别网申表单并填入资料；单选组、日期拆分、重复经历块按完整问题处理；下拉框回读验证 |
| AI 扫描填充 | 本地规则优先，剩余空白字段由 AI 逐项识别填入；可框选区域只补空白（需自配模型） |
| 失败学习 | 未识别字段问答补填，答案写入资料与站点学习记录，支持 AI 识别纠错规则沉淀 |
| 投递记录 | 新建、筛选、排序、行内编辑、CSV 导入导出 |
| 备份与同步 | JSON 版本化备份；WebDAV 同步（ETag 防冲突，凭据不上远端） |

## 安装

### 方式一：直接使用（推荐）

下载仓库中的 [`release/offerconsole-extension.zip`](release/offerconsole-extension.zip)，**先解压**，然后打开 `chrome://extensions` → 开启「开发者模式」→「加载已解压的扩展程序」→ 选择**解压出来的目录**（该目录内应能直接看到 `manifest.json`）。

> 浏览器不能直接加载 zip 文件本身，也不能加载源码根目录——源码里的 manifest 指向的是构建产物，未构建时会报「无法加载背景脚本」。

### 方式二：自行构建

```bash
pnpm install
pnpm build
```

然后按上面同样的步骤加载本项目的 `dist/` 目录。

## 使用速览

1. 点击工具栏 OfferConsole 图标 →「设置个人信息」，完成基本信息与教育经历
2. 「简历库」中添加简历文件，可按「产品岗 / 运营岗」等分类
3. 打开网申页面 → 插件弹窗选择本次简历 →「快速填充」
4. 未识别字段在页面右下角补填并记住，下次自动复用
5. **提交动作永远由你亲自完成**，插件不提供自动提交

## 开发

```bash
pnpm install          # 安装依赖
pnpm build            # 构建到 dist/
pnpm test             # 单元测试（node:test，209 例）
pnpm lint             # oxlint
pnpm test:extension-smoke   # 真实浏览器冒烟（macOS 需先设 SMOKE_BROWSER，见下）
```

macOS 冒烟测试说明：正式版 Chrome 153+ 已忽略 `--load-extension` 命令行参数，需使用 Chrome for Testing：

```bash
npx @puppeteer/browsers install chrome@stable   # 下载到 ./chrome/（已 gitignore）
SMOKE_BROWSER="$(pwd)/chrome/mac_arm-153.0.8010.52/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing" \
  pnpm test:extension-smoke
```

## 文档

- [docs/PRD.md](docs/PRD.md) — 产品规划（P0→P2 路线图、设计决策、里程碑）
- [docs/site-compatibility.md](docs/site-compatibility.md) — 站点兼容性实测清单
- [docs/upstream/](docs/upstream/) — 上游项目原始文档归档
- [AI_FIELD_RECOGNITION_SKILL.md](AI_FIELD_RECOGNITION_SKILL.md) — AI 字段识别规则模板

## 致谢与协议

本项目 fork 自 [Job-ApplyMate](https://github.com/lishuheng1/Job-ApplyMate)（基线 v1.3.1），感谢原作者 aurostars 及贡献者。代码以 [MIT License](LICENSE) 开源，原版权声明保留于 LICENSE 文件首部。

## 底线

- 不做官网全自动提交（验证码不可逾越）：永远「自动填 + 人工点提交」
- 渠道自动化不裸奔：半自动 + 拟人化节奏
- 机考 / 正式面试不碰 AI 代答
- 敏感信息本地优先；LLM 请求前做 PII 脱敏
