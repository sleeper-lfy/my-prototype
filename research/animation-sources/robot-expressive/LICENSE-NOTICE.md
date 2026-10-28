# RobotExpressive source and license

The original **RobotExpressive** model and skeletal animation are by **Tomás Laulhé / Quaternius**. The upstream README identifies the asset license as **CC0 1.0**. Don McCurdy added facial morph targets, converted the asset with FBX2glTF, and adjusted materials.

- Evidence: [fixed upstream README](https://github.com/mrdoob/three.js/blob/68a2712f9d130e8e9813488228dfef3509920fb2/examples/models/gltf/RobotExpressive/README.md), preserved locally as `UPSTREAM-README.md`.
- Source: [fixed original GLB](https://github.com/mrdoob/three.js/blob/68a2712f9d130e8e9813488228dfef3509920fb2/examples/models/gltf/RobotExpressive/RobotExpressive.glb).
- Upstream commit: `68a2712f9d130e8e9813488228dfef3509920fb2`.
- Original GLB: 463988 bytes, SHA-256 `047f5e5fb3bb6d378bd1df16ca6137f2a596c99b3a1b5690b4020c05aaf6f319`.
- Canonical license: <https://creativecommons.org/publicdomain/zero/1.0/>.
- Full license text is retained in `CC0-1.0.txt` (SPDX license-list-data CC0-1.0 text).
- Source inspected on 2026-10-28.

Game UI Studio keeps the asset unchanged and extracts the real skeletal keyframe tracks for four reference presets: Idle, Walking, Running, and Punch. These are authored animations, not represented as recorded human motion capture. The 3D-to-2D conversion is described in `docs/MOTION-SOURCES.md`; it loses depth and does not preserve the full 3D rig. Attribution is retained even though CC0 does not require it.

The source license applies to the source asset and its extracted motion data. The application and conversion script retain the repository's own license.
