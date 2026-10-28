# v0.4.0 验证记录

默认64×96像素角色，12个四方向动作，共88帧。程序绘制的示例用于验证动作与评审流程，最终美术未验收。

| 验证 | 实际结果 | 证据 |
| --- | --- | --- |
| 全部模型、API和既有功能测试 | 110项通过 | [日志](../artifacts/v0.4.0/unit-tests.txt) |
| 动画真实浏览器流程 | 8项通过，零页面错误 | [报告](../artifacts/v0.4.0/animation-browser/results.json) |
| Godot 4.6.3实际运行 | 88帧、12事件，播放推进、时长、截图像素比对通过 | [报告](../artifacts/v0.4.0/animation-godot/results.json) |
| Windows安装程序 | Wine 18项通过（含v0.3升级及安装版动画） | [安装报告](../releases/v0.4.0/windows-verification.json) |

浏览器实际操作覆盖动作选择、播放与逐帧、洋葱皮、骨骼与时长保存、重新加载、帧评论、反馈ZIP中真实PNG解码、补丁预览与应用、版本拒绝、回退、精灵图原始像素与稳定ID保留、动画JSON往返及中文1366×768界面。修改攻击帧时长后，原有hitbox事件数据保持不变。

Godot实际导入全部PNG和SpriteFrames，检查每一帧尺寸及非均匀时长，测试动画播放推进和攻击事件实际触发次数；图形窗口截图中的角色像素与源帧逐点比较。不是以ZIP存在或headless导入成功代替运行验收。

复现：`npm test`、`npm run build`、`python scripts/animation-smoke.py`、`npm run test:animation-godot`。浏览器脚本依赖Python Playwright和Chromium；Godot需要4.3+和可用图形显示（例如Linux的`DISPLAY=:93`，以实际环境为准）。普通安装版使用不需要Python。

边界：动画独立保存在`animation-state.json`，通过动画JSON完整备份，不包含在现有UI／地图ZIP。预设只有待机、行走、攻击四方向人形；完整帧图不会自动拆成骨骼。骨架与部件生成可辅助制作，方向性美术仍需提供。检查提示不代替动作力度和美术验收。导出的是像素帧、事件和映射，骨架保留在Studio文档；游戏物理和业务逻辑需另行接入。安装验证使用Wine，不等于原生Windows实机验收。

[操作说明](PIXEL-ANIMATION.md) · [界面截图](../previews/v0.4.0/README.md)
