# Character portrait contract

- Stable URL: `/assets/characters/<character-id>.webp`
- Runtime portrait: 512×512 WebP. Authored framed art keeps its complete border and composition; unframed art may use a face-focused crop.
- Framed art is normalized to one transparent 496×496 visible canvas inside the 512×512 asset, and declares its presentation shape through `portraitShape`.
- Full approved art and crop provenance live under `work/art-source/<drop>/`.
- The game keeps glyph fallback for characters whose final portrait has not arrived.
- CSS owns faction color, role silhouette, stars, health/energy bars and input hitboxes.
- Missing files fall back to the registered glyph inside the same non-interactive image container.

Current delivery coverage is 25 of 25 playable philosophers. Every roster entry
now resolves to an approved framed WebP portrait; glyphs remain as load-failure
fallbacks only.
