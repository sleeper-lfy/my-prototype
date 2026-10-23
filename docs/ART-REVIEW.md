# Independent art review — Ashfall character dossier

## Acceptance state

**Concept sample complete; final art direction is awaiting human acceptance.** Functional checks, patch tests, and a successful Godot launch do not approve its visual quality. This document is a separate art gate, not a replacement for that approval.

The 960 × 600 sample is a restrained fantasy RPG dossier: forest-green atmosphere, antique-gold highlights, parchment typography, a large portrait, and a clearly dominant recruitment action. It deliberately uses an illustrated game scene rather than a dashboard of equally weighted boxes.

## What is provided

- A fictional character, Elara Voss, drawn as original geometric vector art: layered armour, gilt seams, cloak, crown, sword, rune-like halo, and a restrained frame.
- An original mountain-valley backdrop with atmospheric layers. The right side is shaded to protect text contrast.
- A 12-pixel nine-slice frame, three visibly different button-state textures, and four line-art sigils.
- Named colour and type tokens, six project-specific design rules, and 36 individually addressable components. The portrait is an image component inside a real editable card; the labels, buttons, HUD, and layout are separate components.
- Two sample review requests. One asks for a clearer recruitment label; the other asks for a stronger portrait border. Neither permits a whole-screen redesign.

The SVG artwork has been inspected in a real Chromium rendering. This confirms the portrait renders, not that its style is production-ready. Full-screen editorial judgment should use `artifacts/editor.png` / the running editor when available, plus the actual `artifacts/godot.png` export capture.

## Review checklist

| Area | Acceptance criterion | Current disposition |
| --- | --- | --- |
| Hierarchy | Name, portrait, and primary action read before metadata and decoration | Designed for this hierarchy; review at intended game resolution |
| Character identity | Portrait supports the project's story and is distinguishable from other heroes | Single original concept; no roster-wide consistency claim |
| Art quality | Anatomy, face, silhouette, materials, and lighting meet the game's visual bar | Stylised geometric concept; human art-direction review required |
| Typography | Display and HUD type are distinct; labels remain legible at game resolution | Bundled fonts used; smallest metadata is 9–11 px at the 960 px source size and needs accessibility review |
| Ornament | Borders and emblems support grouping without competing with content | Restrained antique-gold vocabulary; not a complete production theme |
| State design | Normal, hover, and pressed skins are visibly different; text remains legible | Three textures supplied; use actual editor/Godot interaction checks |
| Layout | Free-position cards retain composition; HUD cells align automatically | Both models are represented; assess exported screenshot separately |
| Contrast | Lore remains readable and CTA text/background are clearly separated | Low-contrast secondary text is an intentional concept choice, not an accessibility certification |
| Responsiveness | Required game aspect ratios and translations have enough room | Only 960 × 600 has been designed; other aspect ratios and CJK/long translations remain unapproved |
| Export fidelity | Fonts, colours, assets, spacing, and wrapping remain acceptable in Godot | Judge the real Godot capture and comparison report, not only JSON validity |

## Requested human decision

Approve, request changes, or reject the **art direction** independently from the technical proof. Useful feedback identifies the component ID, desired result, and properties that must stay fixed. For example:

- `character-card`: strengthen the border to `#b59a62`; preserve its size, location, fill, and child illustration.
- `recruit-button`: include the recruitment cost; preserve the textured artwork and dimensions.
- `character-portrait`: replace the concept illustration with project-approved art while retaining its crop and bounds.

## Licensing and limitations

Original SVGs use the project's MIT license. See `public/assets/ART-LICENSE.md`; bundled fonts have their own notices. No paid API, remote image service, or external artwork is needed to open this sample.

This is one project's style study. It is not a complete game art kit, not an approved accessibility theme, and not evidence that generated UI art will meet the developer's aesthetic bar without art direction.
