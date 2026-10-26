# 贡献指南

[English](../CONTRIBUTING.md) | [简体中文](CONTRIBUTING.zh-CN.md)

## 分支

- `main`：默认分支，存放已审查、可发布的基线。
- `dev`：仅保留在本地的开发分支，不推送到 GitHub。
- 在本地 `dev` 开发，审查并脱敏后再将变更合入 `main`，只推送 `main`。外部 PR 以 `main` 为目标。

只有 `main` 公开。个人配置、凭据、机器标识和原始测试输出不得进入任何提交，包括本地开发历史。这里是工作流程约定，不代表已经配置服务端分支保护。

## 本地检查

使用 Windows x64 和 Node.js 22+ x64：

```powershell
npm ci --ignore-scripts
npm test
npm run build
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/build-remote.ps1
git add .
npm run check:publication
git diff --cached --check
git diff --cached
```

构建 `bin/ssh.exe` 前退出使用该目录的 App。如需保留运行中的 App，请使用独立 checkout。默认测试覆盖识别、二进制标记、SSH 参数、MCP 端口预检、流桥接、持久会话、安装及目标身份隔离、认证重连、主机识别及安装复用。修改时保持身份生成方式稳定，实机测试查找会话时使用共享身份工具。CI 执行本地测试、发布检查和原生编译，不连接你的电脑。

发布检查扫描 **Git 暂存区**，必须先暂存最终修改。它检查禁用文件、二进制内容、用户目录路径、内网地址及常见凭据模式，不输出匹配值；它不能替代完整秘密扫描和人工审查。示例使用占位符及示例域名，测试使用虚构的 `C:\fixtures` 路径。

## 显式选择实机测试

先构建启动器和部署包，本机需配置 Desktop，远端需原生 CLI。测试使用 SSH 凭据，首次连接可能创建适配器计划任务；需要远端 PowerShell 7。请顺序运行，尽量使用专门的测试主机。

```powershell
$env:CODEX_TEST_HOST = 'windows-dev'
npm run prepare:remote
npm run test:integration
npm run test:durable
npm run test:discovery
npm run test:install
```

| 命令 | 范围 |
| --- | --- |
| `test:integration` | 真实 App 封装、原生握手、身份、Unicode 文件、输出流、退出码和重连。 |
| `test:durable` | 断开自己的 SSH，检查进程和 stdin 续接及重连前后的认证 MCP。 |
| `test:discovery` | 检测和启动不在旧版 `aliases` 中的主机；请选择符合条件的别名，示例名单为空。 |
| `test:install` | 创建唯一命名的隔离任务，验证全新部署和重复安装，最后只停止并清理该实例。 |

报告和临时文件写入被忽略的 `work/`。测试不停止生产服务，但普通测试会话可能保留在服务的有限池中。测试中断后可能需清理其唯一命名的临时文件或任务，不要清理其他会话状态。

以下测试**使用远端模型账号额度**，创建临时 agent 会话：

```powershell
npm run test:agent
npm run test:agent-durable
```

第二项会在 agent 命令运行时断开测试 SSH。两项都不包含在 CI 或 `npm test` 中。

## 兼容性和服务变更

兼容性工具读取已安装 App 中一小段命令格式化函数，布局和版本检查有意保持严格。适配新版时，先审查命令封装和协议、完成相关实机测试，再更新示例版本检查及两份 README。不要分发 App 程序包。

安装器复用兼容服务，不覆盖更新。升级前需等待远端任务结束，因为停止宿主会终止它的子进程。打包复制本机 Node 并下载对应许可证，Node 版本变化也会改变部署包。

## PR 和文档

说明行为变化、实际运行的检查及未验证的平台或账号。英文 README 保持为首页，用户可见变更同步中文文档。不要附原始 SSH 配置、主机缓存、认证文件或完整报告；私人复现细节留在仓库外。

许可状态见[第三方说明](../third_party/README.md)，项目尚未选定整体许可证。
