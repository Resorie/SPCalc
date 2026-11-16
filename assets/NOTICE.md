# 图标来源与权利

本目录的《明日方舟》游戏图片版权属于鹰角网络及相关权利人，不受本项目代码的 GPL-3.0-or-later 授权覆盖。仅用于非官方同人工具中辨识干员、装备和盟约。

- 干员头像来自 [yuanyan3060/ArknightsGameResource](https://github.com/yuanyan3060/ArknightsGameResource/tree/f925fd75438a885a9e0220fed06d0a9b94701bc3/avatar)，固定提交 `f925fd75438a885a9e0220fed06d0a9b94701bc3`。
- 卫戍装备与盟约图标来自 [ArknightsAssets/ArknightsAssets2](https://github.com/ArknightsAssets/ArknightsAssets2/tree/3524c85611e82890367c9e65453b2495e3c39074)，固定提交 `3524c85611e82890367c9e65453b2495e3c39074`。
- 路径映射参考 Stronghold-Protocol 的素材说明，按当前规则包的 `charId`、装备 `iconId` 与盟约 `iconId` 匹配。图片保持原始 PNG，未生成或重绘。各文件的完整来源和 SHA-256 见 `icons/index.json`。

无官方授权或合作关系的暗示。上游代码许可见项目 LICENSE 和 `vendor/stronghold/NOTICE.md`。

## 地图场景与渲染素材

`board/upstream/` 来自国服客户端 `26-04-13-12-31-42_e9b560` 的 8 张启用卫戍协议地图场景及公共地图资源。资源包从官方 CDN 下载并逐个匹配该版本 `hot_update_list.json` 的 MD5，使用 Stronghold-Protocol @ f07b8965061bbc311ad7aa815879b09264a1e47d 的原始 `tools/local-extract` 与 `crop-board-atlas.mjs` 提取。包含网格、烘焙光照、反射、纹理和公共机关；版权属于鹰角网络及相关权利人，不受代码 GPL 许可覆盖。原包清单和产物 SHA-256 见 `board/upstream/provenance.json`，资源条目见 `manifest.json`。静态网页按需读取本地文件，不在运行时热链资源 CDN。旧版自行裁剪拼接的 8 张材质示意已移除。

提取沿用上游记录的假设和裁剪规则；日志报告部分地图引用的 Unity 默认 primitive 网格不可用，其他原始场景模型正常导出，不能宣称与官方客户端逐像素一致。场景渲染也沿用上游已有光照、材质和重复网格处理方式。

提取工具使用 UnityPy、Pillow 与上游 BSD-3-Clause 的 LZ4AK 解码器，仅用于构建素材，不是网页运行依赖。网页所用 PixiJS 7.4.2 与 Three.js 0.186.1 的 MIT 许可随 `vendor/pixi/` 和 `vendor/three/` 保存。

## 规程·序列Ⅰ新增素材

`board/act3autochess-v3_1/` 的十张地图取自国服 Windows 客户端 `26-11-06-12-42-25-70182449`，包含由三个子场景合成的网格、光照与贴图。资源包按客户端 `hot_update_list.json` 的 MD5 核验，并使用 Stronghold-Protocol @ 55f528e9fc4872388360ee85e13eca8594856204 的 `tools/local-extract/regulation_scenes.py` 提取。原资源包与产物校验值随地图包保存。

规程版装备、盟约图标及新增干员头像从同一客户端版本提取。既有头像沿用上文的固定来源。新版图标映射和来源记录见 `icons/act3autochess-v3_1.json`。游戏图标及地图场景版权属于鹰角网络及相关权利人。
