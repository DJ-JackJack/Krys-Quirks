# Krys' Quirks

House rules for the Ahvantir campaign. Foundry VTT v13 or later, dnd5e 5.x. Works with or without Midi-QOL.

Each rule has its own on/off switch under **Configure Settings › Krys' Quirks**.

## Inspiring Success

When a player character rolls a natural 20 on any d20 roll (attack, save, ability check, skill, tool, concentration, death save or initiative), the player who rolled gets a pop-up listing the other player characters on the scene. They pick one, or "No one", and that character gains Heroic Inspiration. A chat message announces it.

- With Advantage or Disadvantage, only the kept die counts.
- Characters who already have Heroic Inspiration are listed but can't be picked.
- A GM must be connected so the inspiration can be granted to characters the roller doesn't own.

## Arcane Exhaustion

A player character can cast a prepared spell without a spell slot of the needed level:

1. Intelligence (Arcana) check, DC 10 + the level the spell is cast at.
2. On a failure, the spell fizzles.
3. Success or failure, the caster gains Exhaustion equal to half that level, rounded down (minimum 1). Nothing can stop it being applied; it is removed normally afterwards.

Two ways to use it:

- **Automatic:** cast a prepared spell at a level with no slots left. Instead of refusing, the module offers Arcane Exhaustion.
- **From the sheet:** right-click the spell and choose **Cast with Arcane Exhaustion** to pick any level from the spell's own level up to 9th.

## Installing

In Foundry's setup screen, open **Add-on Modules › Install Module** and paste this into the **Manifest URL** box:

```
https://github.com/DJ-JackJack/Krys-Quirks/releases/latest/download/module.json
```

Then enable **Krys' Quirks** in the world's module list. New versions show up through Foundry's normal **Update** button.

## Releasing a new version

1. Push the changes to `main`.
2. On GitHub, create a release with a tag like `v1.1.0` and publish it.
3. The **Release** workflow stamps that version into `module.json`, builds `krys-quirks.zip` with the files at the zip root, and attaches both to the release.
