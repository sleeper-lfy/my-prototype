# 安装版 Logo（v0.4.2）

使用仓库已有的[原始Logo](../previews/branding/game-ui-studio-logo.png)，不重新生成或重绘图案。

- 页面和加载界面：`public/assets/game-ui-studio-logo.png`，与原图逐字节一致。
- 浏览器标签：`public/assets/game-ui-studio.ico`。
- Windows安装／卸载EXE、桌面和开始菜单快捷方式、应用卸载列表：安装根目录的`game-ui-studio.ico`。
- 原图和历史预览保留，卸载仅删除安装目录内的派生图标。

ICO包含16、24、32、48、64、128、256像素图层，透明背景。通过格式转换得到，无图像生成API调用。使用ImageMagick复现：

```sh
magick previews/branding/game-ui-studio-logo.png -define icon:auto-resize=256,128,64,48,32,24,16 packaging/windows/game-ui-studio.ico
```

原图SHA-256为`40077c80c8fcdcdea37311aa75273f5c92affff4caeb3490dbf49944af5f0ecd`。派生图标及复制文件的校验记录见[品牌资源清单](../previews/branding/installed-logo-manifest.json)。

[本版实际验证](VALIDATION-v0.4.2.md)。运行在浏览器中的工具使用站点图标；系统任务栏的宿主浏览器仍由浏览器自身管理。
