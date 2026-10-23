# Game UI Studio installed application

This directory is an installed runtime, not a source checkout. For component feedback, use `.agents/skills/game-ui-studio/SKILL.md` and its helper. Use the bundled `../node.exe`; do not run npm install, npm ci, npm run dev, or source-code test commands in this directory.

Open the editor through the installed desktop shortcut. The active project is normally `%LOCALAPPDATA%\GameUIStudio\data\project.json`. Read the current browser URL or only the `url` field of `%LOCALAPPDATA%\GameUIStudio\runtime\state.json` for the actual local port. Do not print or share the control token in that state file.

Use the local API and reviewed scalar patches for changes. Never overwrite a running project's JSON, change stable component IDs, rebuild the whole screen for a small review, or automatically approve your own changes. Preserve the user's assets and project data when updating this application.

For Godot validation, export the current design's Godot ZIP from the editor, extract it to a new directory, and follow the skill's generated-project instructions. The source-checkout npm test:godot runner is not installed here. Godot itself must be separately available; a ZIP or old screenshot is not proof that a new export ran. Keep functional, export-fidelity, and art acceptance separate.

Source and development instructions: https://github.com/sleeper-lfy/my-prototype
