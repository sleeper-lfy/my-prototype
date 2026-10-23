# Game UI Studio repository

Use `.agents/skills/game-ui-studio/SKILL.md` when handling design feedback, component revisions, local patch exchange, or Godot UI export validation. The companion helper uses this repository's real model; do not fork its rules into ad hoc patch scripts.

Application code work and design-document work are distinct. For a component review, change only the authorized design properties through the patch workflow; do not rebuild the editor or whole screen. For a coding request, run tests relevant to the implementation.

Run `npm ci` for dependencies, `npm test` for model/API/skill checks, and `npm run build` for the frontend. `npm run test:godot` runs the immutable example unless `--project` is specified. Real screenshots require a graphical display. Keep functional, export-fidelity, and art acceptance separate.

`data/`, caches, user imports, environment files, and local credentials are not release source. Release packaging must exclude them. Use existing checkouts; no additional Git worktree is needed unless explicitly requested.
