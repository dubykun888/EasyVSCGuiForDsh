# Easy VSC GUI for DSH

在 VS Code 辅助侧栏（右侧）内嵌 DeepSeek Harness (dsh) WebUI，提供快速打开、自动启动/连接、端口同步、主题跟随与工作区感知能力。

## 功能

- 编辑器标签栏右上角按钮快速打开右侧辅助侧栏。
- 自动检测 dsh：
  - 未安装：提示安装 `@deepseek-ai/dsh`。
  - 已安装未启动：优先使用 `npx --yes @deepseek-ai/dsh web --port <port>` 临时启动，失败回退全局 `dsh`。
  - 已启动：直接连接现有 dsh 服务，不重复启动。
- 端口管理：
  - 配置 `easyVscGuiForDsh.port` 指定端口（默认 3080）。
  - 自动读取本地 dsh 默认端口并统一。
  - “同步本地 DSH 端口到插件”按钮。
  - 端口被非 dsh 应用占用时提示重新指定。
- 用户可主动停止“由插件启动”的 dsh；外部 dsh 只显示状态，不关闭。
- 侧栏颜色跟随 VS Code 主题（通过本地代理/主题改写，不影响浏览器中的 dsh）。
- 工作区感知：以当前 VS Code 文件夹作为 dsh 工作区启动，并尝试恢复最后聊天。

## 开发

```bash
npm install
npm run compile
npm run package:local   # 生成 easy-vsc-gui-for-dsh.vsix
```

## 使用

1. 安装 `.vsix`。
2. 点击编辑器右上角 DSH 按钮，或命令面板运行 `DSH: Open DSH GUI`。
3. 首次使用会自动检测/启动 dsh。

## 设置项

| 设置 | 默认值 | 说明 |
|---|---|---|
| `easyVscGuiForDsh.port` | `3080` | dsh 端口 |
| `easyVscGuiForDsh.startMode` | `auto` | `auto` / `npx` / `global` |
| `easyVscGuiForDsh.dshPackage` | `@deepseek-ai/dsh` | npx 使用的包名/版本 |
| `easyVscGuiForDsh.startTimeout` | `60` | 启动等待秒数 |
| `easyVscGuiForDsh.stopDshOnVscClose` | `false` | 关闭 VS Code 时是否停止插件启动的 dsh |
| `easyVscGuiForDsh.themeFollow` | `vscode` | `vscode` / `system` / `dsh` |
| `easyVscGuiForDsh.autoOpenLastChat` | `true` | 自动打开工作区最后聊天 |
| `easyVscGuiForDsh.dshCommand` | `dsh` | 全局 dsh 命令路径 |

## 风险与兼容

- 需要较新版本 VS Code 以支持 auxiliary bar；旧版本会自动回退为右侧 WebviewPanel。
- dsh 为 RC 版本，CLI/API 可能变化；dsh 相关逻辑集中在 `src/dsh` 便于适配。
