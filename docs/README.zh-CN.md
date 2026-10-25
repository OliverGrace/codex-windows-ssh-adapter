# Codex Windows SSH 适配器

[English](../README.md) | [简体中文](README.zh-CN.md)

让 Codex Desktop 的 **设置 → 连接 → SSH** 连接原生 Windows Codex CLI。使用同一个本地入口连接多台 Windows 主机，保留 SSH 断线期间的远端进程，并通过原有 SSH 隧道使用桌面 MCP 工具。

**这是实验性的非官方适配器。** 默认版本检查已更新为 Desktop `26.1021.3705.0`，兼容性工具也保留对先前已验证的 `26.1013.4894.0` 的支持；CLI 已验证 `0.162.0` 和 `0.163.0`。App 协议更新可能需要修改适配器，因此启动器会检查已安装的 App 版本。

## 功能

- 对可识别的 Codex SSH 启动命令自动检测 Windows，无须逐台维护适配名单。
- 沿用 SSH 别名、密钥、端口、`Include`、`ProxyJump` 和 `ProxyCommand`。
- 首次连接自动部署私有运行时及用户计划任务，复用已有的兼容服务。
- SSH 断开时保留原生 Codex、终端和子进程；同一客户端身份重连后重新附着。
- 按本机安装及 SSH 目标区分持久会话，避免不同电脑反复抢占彼此的连接。
- 保留原生 Windows 执行环境，以及远端 CLI 原有的 PowerShell 配置。
- 将桌面 MCP 反向转发监听检查适配到 Windows，保留回环绑定和认证。
- 普通 SSH 命令和已识别的 Unix 主机交给系统 OpenSSH。

适配器通过进程级 `PATH` 生效，不修改 App 安装包、系统 SSH、系统 `PATH` 或远端 SSH 默认 Shell。远端不需要打开 Codex Desktop App。

## 环境要求

| 本机 | 远端 Windows 主机 |
| --- | --- |
| Windows x64 和已验证版本的 Codex Desktop | Windows 10/11 x64，OpenSSH Server 和 SFTP 可用 |
| Node.js 22+ x64 和 npm | 原生 Codex CLI，支持 `app-server --stdio` |
| Windows OpenSSH 客户端，含 `ssh.exe`、`scp.exe` | CLI 账号和工作所需配置已就绪 |
| Windows PowerShell 5.1、.NET Framework C# 编译器 | Windows PowerShell 5.1、任务计划服务 |
| 密钥或 SSH agent 的非交互 SSH 登录 | SSH 用户有权注册自己的计划任务 |

部署包自带远端 Node.js。适配器不强制要求 PowerShell 7，但实机测试需要 `pwsh.exe`。ARM64 尚未验证。优先创建 S4U 任务；降级为 Interactive 任务时，该 Windows 用户必须保持登录。

## 快速开始

1. 将仓库克隆到自选目录，在该目录打开 PowerShell：

   ```powershell
   git clone https://github.com/OliverGrace/codex-windows-ssh-adapter.git
   cd codex-windows-ssh-adapter
   npm ci --ignore-scripts
   npm run build
   npm run prepare:remote
   ```

   构建生成本地启动器，并从示例创建 `adapter.config.json`。打包会编译远端启动器，复制本机 Node 及对应许可证。生成文件仅保留在本地。

2. 如果尚未配置目标，在 `%USERPROFILE%\.ssh\config` 添加别名，替换以下示例值：

   ```sshconfig
   Host windows-dev
       HostName windows-host.example.com
       User your-windows-user
       IdentityFile ~/.ssh/id_ed25519
       IdentitiesOnly yes
   ```

   先用系统 SSH 核验主机密钥和认证，再检查非交互登录：

   ```powershell
   & "$env:WINDIR\System32\OpenSSH\ssh.exe" windows-dev hostname
   & "$env:WINDIR\System32\OpenSSH\ssh.exe" -o BatchMode=yes windows-dev hostname
   ```

3. 从菜单或托盘完整退出已运行的本机 Codex App，双击 **`Launch-Codex-Windows.cmd`**，在 **设置 → 连接 → SSH** 选择目标。

4. 打开远端 Windows 项目目录即可工作。以后连接新主机仍使用这个入口，无须在适配器内增加别名。

首次连接会上传部署包，使用已测试 Node 版本时约 34 MiB；远端验证 SHA-256 后创建后台任务。网络较慢时可提前部署：

```powershell
node scripts/setup-host.mjs --check windows-dev
npm run install:remote -- windows-dev
node scripts/remote.mjs status windows-dev
```

`--check` 仅检测，不安装。安装器复用兼容的 `0.2.0` 或 `0.3.0` 服务，不覆盖文件、令牌或运行中的进程；这不是原地升级命令。

## 配置

`adapter.config.json` 是被 Git 忽略的本机配置，仅提交 `adapter.config.example.json`。

| 配置项 | 含义 |
| --- | --- |
| `autoDetectWindows` | 对可识别的桌面 SSH 命令自动检测 Windows，默认开启。 |
| `aliases` | 自动检测关闭时使用的旧版白名单；通用模式留空。 |
| `realSsh` | 系统 `ssh.exe` 的绝对路径；非标准 Windows 安装需调整示例路径。 |
| `durableHost` | 旧版模式的持久宿主开关；自动模式下 Windows 使用持久宿主。 |
| `remoteCodexCommand` | 旧版命令名；自动模式查找原生 CLI。 |
| `maxMessageBytes` | 本地桥接消息上限，默认 16 MiB。 |
| `testedAppVersion` | App 版本检查；修改前应完成兼容性验证。 |
| `clientId` | 可选的非空本机安装标识；默认使用本机名和项目路径。结合 SSH 目标及原始客户端名生成哈希；不同电脑应使用不同值。 |

专用启动器为 App 进程设置 `CODEX_WINDOWS_SSH_AUTO=1`。CLI 自动发现覆盖常见 npm 安装、可执行文件路径、`.local\bin` 和 WinGet 链接。自定义安装可在**远端**设置 `CODEX_CLI_PATH`，指向真正的 `codex.exe`，并确保 SSH 登录环境能读到它。

## 架构与后台运行

本机 App → 项目 SSH 启动器 → 系统 OpenSSH → 远端代理 → 带认证的回环 WebSocket → 计划任务中的持久宿主 → 原生 `codex app-server --stdio` → Windows 工具和 PowerShell。

持久宿主持有 Codex 的 stdio，SSH 只负责附着和脱离。宿主协调初始化、请求 ID、审批和通知缓存。同一客户端身份的新连接接管已有会话；最多保留 12 个身份，每会话离线通知上限为 32 MiB。

本地桥接器为初始化客户端名添加稳定的哈希后缀。同一本机安装及 SSH 别名重连时复用会话，不同安装或别名使用独立会话；其他初始化字段和请求 ID 保持不变。更换项目路径、本机名、SSH 别名或 `clientId` 会使用新身份。如需在以后迁移目录时保持身份，应在建立会话前配置独有的 `clientId`。应用此次修复后的首次连接会创建独立会话，已有远端进程保留。此修复兼容现有 `0.2.0` 和 `0.3.0` 宿主，无须重启或替换远端服务。

远端计划任务名为 `CodexWindowsSshAdapter`，文件位于 `%LOCALAPPDATA%\CodexWindowsSshAdapter`，仅当前 Windows 用户和 SYSTEM 可访问。随机令牌用于认证动态端口的回环 WebSocket，留在远端，不传给本机 App。不创建局域网监听或防火墙例外。

原生启动器使用 Windows Job Object 管理宿主和子进程。**停止该计划任务会结束它拥有的 Codex 会话、终端及子进程。** 普通 SSH 断线不会停止任务。

## MCP 转发和断线边界

保留 App 的 `-R 127.0.0.1:端口:127.0.0.1:端口` 和 Bearer 认证。Windows `Get-NetTCPConnection` 检查只接受目标端口上恰好一个 IPv4 回环监听。SSH 服务端必须允许 TCP 反向转发；适配器不会修改 `sshd_config`。

宿主为 Codex 子进程的 `NO_PROXY`/`no_proxy` 补充 `localhost`、`127.0.0.1` 和 `::1`，保留其他代理设置。

- 隧道或本机 App 关闭期间，本机 MCP 不可用，正在进行的调用可能失败；不会自动重复失败的工具调用。
- 如果 App 重启导致 MCP 地址或令牌改变，重新打开或恢复线程以获得新的桌面 MCP 配置。
- 远端重启、关机、休眠、进程崩溃或主动停止任务会影响工作；已结束进程的内存无法恢复。
- 待审批请求仍需用户审批，不会因重连而自动通过。
- 通知溢出时丢弃最旧通知，`status.json` 中的 `droppedNotifications` 记录数量。重要命令日志应写入文件。
- 协议层支持终端进程续接；完整退出 App 后终端页签是否恢复取决于 App UI。
- S4U 不会自动获得交互登录的网络共享凭据；UNC 路径及网络盘需另行验证。
- 未实现 App 内远端 CLI 安装、升级和杀掉所有进程等管理命令。应在任务结束后直接维护原生 CLI。

## 管理与排查

```powershell
npm run doctor
node scripts/remote.mjs status windows-dev
node scripts/remote.mjs start windows-dev
```

只有确认远端任务结束后，才执行停止和重启：

```powershell
node scripts/remote.mjs stop windows-dev
node scripts/remote.mjs start windows-dev
```

| 问题 | 处理方式 |
| --- | --- |
| 提示 App 已运行 | 完整退出后再使用本项目启动器。 |
| App 版本不匹配 | 验证新版兼容性后再修改版本配置。 |
| SSH 设置中没有主机 | 添加 SSH 别名，确认系统 SSH 可用。 |
| 认证或主机密钥错误 | 修复原始 SSH 连接；检查不会被绕过。 |
| SSH 登录正常，但 Windows 检测失败，或 PowerShell 提示“拒绝访问” | 检查远端杀毒软件或终端防护的拦截记录，详见下文。 |
| 找不到 CLI | 使用 SSH 用户运行 Codex，或设置远端 `CODEX_CLI_PATH`。 |
| 首次连接超时 | 先执行 `npm run install:remote -- windows-dev`。 |
| 反复 `websocket closed (code=1006)`，且 Desktop 日志出现 `Durable host closed: 1012 Reattached` | 另一连接正在接管同名会话。更新本地适配器后重连，并确认不同电脑没有共用显式配置的 `clientId`。 |
| 无法注册任务 | 检查任务计划权限；Interactive 模式要求用户保持登录。 |
| MCP 不可用 | 检查 SSH 转发策略；若 App 缓存了旧失败状态，完整退出并重启后连接。 |
| Agent 和终端 Shell 不同 | Agent 沿用 CLI 设置；终端可能先启动 Windows PowerShell，可输入 `pwsh`。 |

`logs/adapter.jsonl` 记录操作元数据，不记录提示词或凭据值。被忽略的 `work/` 中有缓存、测试文件及报告，可能含机器名和路径；分享诊断输出前请审查并脱敏。

### VPN 连接反复重连

仅凭 `1006` 无法判断是网络故障，应查看 Desktop 的 SSH 代理失败日志中的底层断开原因。`1012 Reattached` 表示持久宿主收到相同客户端身份的新连接；两个客户端持续重连时会互相挤掉。旧版适配器在不同电脑上共用 `Codex Desktop` 身份，本地身份后缀修复了该冲突，无须修改 VPN 路由、SSH 转发策略或远端计划任务。

使用 Tailscale 时，先确认 DNS 解析和系统 SSH 登录，`tailscale ping windows-dev` 可辅助区分直连和中继。若 SSH 认证与反向转发成功，随后出现 `1012 Reattached`，应排查会话归属，不需要因此关闭 Tailscale 或开放额外端口。重连后用 `node scripts/remote.mjs status windows-dev` 和本机 Desktop 连接日志确认结果。其他断开原因需单独排查。

### 杀毒软件与终端防护

安全软件可能拦截适配器的子进程，即使 SSH 登录本身正常。一次使用 360 安全软件的部署中，`ssh ... hostname` 可以执行，远端 `powershell.exe` 却返回“拒绝访问”，导致主机检测提示 `Cannot identify this SSH host as Windows or Unix`。放行被拦截的操作后，App 重新连接到原有 Codex 进程，断线和 MCP 测试通过。这是排查案例，不代表所有“拒绝访问”都由杀毒软件引起。

适配器使用 Windows PowerShell（`powershell.exe`）进行主机检测、计划任务管理和 MCP 监听检查。Agent 的 PowerShell 7（`pwsh.exe`）可以正常运行，并不代表这些适配器操作也已获准执行。

1. 在本机分别测试基础 SSH 命令和无副作用的 Windows PowerShell 命令：

   ```powershell
   & "$env:WINDIR\System32\OpenSSH\ssh.exe" -o BatchMode=yes windows-dev hostname
   & "$env:WINDIR\System32\OpenSSH\ssh.exe" -o BatchMode=yes windows-dev 'powershell.exe -NoProfile -NonInteractive -Command "Write-Output ADAPTER_POWERSHELL_OK"'
   ```

2. 在发生失败的电脑上检查防护历史和隔离区，核对时间、程序、命令及父进程是否属于适配器。相关组件包括本机项目的 `bin\ssh.exe` 和 Node 运行时，以及远端 PowerShell、原生 Codex CLI 和 `%LOCALAPPDATA%\CodexWindowsSshAdapter` 内的文件（宿主/代理启动器、脚本，以及较新安装中的私有 Node 运行时）。

3. 确认是拦截且文件可信后，恢复被隔离的适配器文件，并通过安全软件提供的控制项放行具体的适配器操作。保持防护开启，避免排除整个磁盘或无条件放行所有 PowerShell 命令；受管理的电脑应由管理员审查拦截。

4. 重新检查主机，再到 App 连接：

   ```powershell
   node scripts/setup-host.mjs --check windows-dev
   node scripts/remote.mjs status windows-dev
   ```

   如果宿主已停止，执行 `node scripts/remote.mjs start windows-dev`。拦截不一定会结束已有 Codex 进程，重装或停止服务前先检查状态。若 App 缓存了 MCP 失败状态，完整退出后用 `Launch-Codex-Windows.cmd` 重新启动并连接。如果没有对应拦截记录，继续检查程序权限、SSH 策略和服务状态。

回退时退出 App，再用普通快捷方式启动，即可停止加载本地适配器，远端任务仍保留。完全卸载远端适配器前，先结束工作、停止宿主，再删除其计划任务及 `%LOCALAPPDATA%\CodexWindowsSshAdapter`，保留原来的 `.codex` 目录。

## 开发与验证

`main` 是默认发布分支，`dev` 仅保留在本地，不推送到 GitHub。两者都不包含个人配置或运行状态。详见[中文贡献指南](CONTRIBUTING.zh-CN.md)。

```powershell
npm test
git add .
npm run check:publication
```

默认 14 项本地测试不需要 App、SSH 凭据或模型账号，包含不同 Desktop 身份隔离及重连归属检查。CI 还会编译 Windows 启动器。发布检查扫描 Git 暂存区中的禁用文件和常见敏感模式，不能替代人工审查。

历史实机验证覆盖一台原生 Windows 主机、通往同一机器的未列入适配名单的 SSH 目标、隔离的全新 `0.3.0` 安装、PowerShell、强制断线重连，以及重连前后的认证 MCP。真实临时 agent 会话也曾在 SSH 断开期间完成命令。2026 年 10 月更新另行验证了经 Tailscale 连接两台 Windows 主机，并观察到修复后与另一客户端争抢会话的问题消失。这些是实测结果，不是每次 CI 都会重跑的测试，也不代表长期可靠性保证。尚未验证 ARM64 或普通非管理员账号；Unix 分流有本地测试覆盖，没有完成 Linux 实机验收。

## 目录说明

| 目录 | 用途 |
| --- | --- |
| `src/` | SSH 翻译、桥接、主机检测、原生启动器源码 |
| `remote/` | 安装器、持久宿主、代理及计划任务入口 |
| `scripts/` | 构建、启动、部署、诊断和发布检查 |
| `tests/` | 本地测试及显式选择的实机测试 |
| `docs/` | 中文用户和贡献文档 |
| `third_party/` | 组件说明，下载的许可证缓存不进入 Git |
| `bin/`、`work/`、`logs/` | 生成或机器相关文件，不提交 |

许可说明见[第三方说明](../third_party/README.md)。本项目不是 OpenAI 官方产品。背景资料：[Codex 远端连接](https://learn.chatgpt.com/docs/remote-connections)、[app-server](https://learn.chatgpt.com/docs/app-server)。
