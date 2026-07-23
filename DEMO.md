# Philosophy Auto Chess — 往哲荣耀 v0.2

## Goal

Build a team of philosophers, defend three fixed routes, and keep the Philosopher's Stone alive through all ten waves. A coherent resonance setup and sensible positioning are required for the later waves.

## Basic controls

1. Buy a philosopher from the Idea Market.
2. Click or drag a reserve piece onto a compatible deployment slot.
3. Ground units stand on road slots and block enemies up to their weight capacity; highland units attack from off-road platforms.
4. Drag a piece into the market area to sell it.
5. Spend gold on pieces, rerolls or experience, then start the next wave from the right command rail.
6. Open resonance details to inspect members, thresholds and live triggers.

## Demo content

- 25 philosophers
- Four major factions and six smaller resonances
- Eight-unit population cap
- Ten waves, including Cave Shadow on W5 and Absolute Spirit on W10
- Preparation decisions for Greece, France, Britain and Enlightenment
- Philosopher King and Royal Barrier
- Historical events, ideology choices and deterministic war-machine encounters
- Automatic V7 local saves, V1–V6 migration and wave retry checkpoints
- Player-facing save export/import with an automatic pre-import backup
- Desktop and landscape-phone browser layouts sharing one game core
- Installable PWA metadata and an online-first update strategy

## Feedback

Open **Settings → Feedback Tools** to copy or export the balance report. Useful feedback includes:

- final formation and active resonances
- wave reached and Philosopher's Stone health
- economy choices and upgrade timing
- units or research choices that felt mandatory or ineffective
- unexpected blocking, targeting or save behavior

## Current limitations

- The interface is currently in Simplified Chinese.
- The current repository does not include final music or recorded sound files; the defensive synthesized fallback can be muted independently.
- Equipment, online play, cloud saves and additional factions are outside the v0.2 scope.
- Balance is intended for external playtesting and is not final competitive tuning.

## Validation baseline

The release baseline passes TypeScript, ESLint, production build, deterministic engine tests, rendered-HTML tests and a clean-profile portable release smoke test.
