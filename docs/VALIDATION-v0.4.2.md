# v0.4.2 安装版 Logo 验证

本版122项回归测试、4项品牌浏览器流程和19项Wine安装测试通过。只接入已有Logo和对应安装资源。原图保留，源PNG、运行时PNG与HTTP响应均按原始SHA-256校验；没有重新生成美术。

| 检查 | 证据 |
| --- | --- |
| 既有模型、API和启动回归 | [测试日志](../artifacts/v0.4.2/unit-tests.txt) |
| 加载页、页头、站点图标及中英工作区真实浏览器检查 | [浏览器报告](../artifacts/v0.4.2/branding/results.json) |
| 安装／卸载PE图标、LNK图标路径与索引、DisplayIcon注册表、升级与数据保留 | [安装报告](../releases/v0.4.2/windows-verification.json) |

Windows ICO包含16、24、32、48、64、128、256七种尺寸；安装测试比较实际EXE资源中的图标数据和ICO原始层，不仅检查脚本配置。浏览器验证实际下载Logo、解析ICO并检查图片解码，覆盖加载界面以及UI、地图、动画工作区的中文和英文页头。

安装兼容性使用Wine与实际Windows Node，浏览器为Linux Chromium；未宣称Windows实机或系统图标缓存行为已验证。本版未重跑Godot渲染，导出实现未修改；动画渲染证据见[v0.4.1](VALIDATION-v0.4.1.md)。

[品牌资源说明](BRANDING.md) · [实际截图](../previews/v0.4.2/README.md)
