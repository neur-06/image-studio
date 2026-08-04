# PinAI Image Studio

Windows 本地 Electron 生图工具，支持 PinAI `gpt-image-2` 文生图和图片编辑。

## 启动

```powershell
npm.cmd install
npm.cmd run dev
```

生产构建并启动：

```powershell
npm.cmd run build
npm.cmd start
```

生成图片时可选择清晰度、预设尺寸、自定义尺寸和数量。点击“保存 PNG”会打开系统保存对话框，默认目录为 `D:\codexproject\生图\保存图片`。

API 密钥请在应用的“设置”页输入，密钥使用 Windows 凭据库保存，不要提交到代码仓库。

创作工作台功能：提示词模板、本地图库、收藏/搜索、自动归档、一键再生成和继续编辑。图库默认位于 `D:\codexproject\生图\保存图片\图库`。
