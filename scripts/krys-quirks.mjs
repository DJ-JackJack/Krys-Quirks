/**
 * Krys' Quirks: house rules for the Ahvantir campaign (dnd5e 5.x, Foundry v13+).
 *
 *  - Inspiring Success: a natural 20 on any d20 roll lets the roller give
 *    Heroic Inspiration to one other player character on the scene.
 *  - Arcane Exhaustion: with no spell slot of the needed level, a caster can
 *    still cast a prepared spell at that level after an Intelligence (Arcana)
 *    check (DC 10 + level). Failure fizzles the spell. Either way the caster
 *    gains Exhaustion equal to half the level, rounded down (minimum 1), and
 *    nothing prevents it being applied.
 */

const ID = "krys-quirks";
const SOCKET = `module.${ID}`;
const DialogV2 = foundry.applications.api.DialogV2;

/* -------------------------------------------- */
/*  Settings and socket                          */
/* -------------------------------------------- */

Hooks.once("init", () => {
  game.settings.register(ID, "inspiringSuccess", {
    name: "Inspiring Success",
    hint: "When a player character rolls a natural 20 on any d20 roll, its player can give Heroic Inspiration to another player character on the scene.",
    scope: "world", config: true, type: Boolean, default: true
  });
  game.settings.register(ID, "arcaneExhaustion", {
    name: "Arcane Exhaustion",
    hint: "Player characters can cast a prepared spell without a slot of that level: Intelligence (Arcana) check against DC 10 + spell level, failure fizzles, and either way they gain Exhaustion equal to half the spell level (minimum 1).",
    scope: "world", config: true, type: Boolean, default: true
  });
});

Hooks.once("ready", () => {
  game.socket.on(SOCKET, async (data) => {
    if (game.user !== game.users.activeGM) return;
    if (data?.action === "inspire") await grantInspiration(data.targetUuid);
  });
});

/* -------------------------------------------- */
/*  Inspiring Success                            */
/* -------------------------------------------- */

const seenRolls = new Set();

Hooks.on("createChatMessage", (message) => checkForNatural20(message));
Hooks.on("updateChatMessage", (message, changes) => {
  if ("rolls" in changes) checkForNatural20(message);
});

function checkForNatural20(message) {
  if (!game.settings.get(ID, "inspiringSuccess")) return;
  if (message.author?.id !== game.user.id) return;
  const actor = ChatMessage.getSpeakerActor(message.speaker);
  if (!actor || actor.type !== "character") return;

  (message.rolls ?? []).forEach((roll, index) => {
    const key = `${message.id}:${index}:${roll.formula}:${roll.total}`;
    if (seenRolls.has(key) || !isNatural20(roll)) return;
    seenRolls.add(key);
    promptInspiration(actor, message);
  });
}

function isNatural20(roll) {
  const D20Roll = CONFIG.Dice.D20Roll ?? globalThis.dnd5e?.dice?.D20Roll;
  const isD20Test = (D20Roll && roll instanceof D20Roll) || roll.constructor?.name === "D20Roll";
  if (!isD20Test) return false;
  const die = roll.dice.find((d) => d.faces === 20);
  return !!die?.results.some((r) => r.active !== false && !r.discarded && r.result === 20);
}

function witnessesFor(actor, message) {
  const scene = game.scenes.get(message.speaker?.scene) ?? canvas.scene;
  const found = new Map();
  for (const token of scene?.tokens ?? []) {
    const other = token.actor;
    if (!other || other.type !== "character" || !other.hasPlayerOwner) continue;
    if (other.id === actor.id || token.hidden) continue;
    found.set(other.uuid, {
      uuid: other.uuid,
      name: token.name,
      inspired: !!other.system.attributes?.inspiration
    });
  }
  return [...found.values()];
}

async function promptInspiration(actor, message) {
  const witnesses = witnessesFor(actor, message);
  const available = witnesses.filter((w) => !w.inspired);
  const already = witnesses.filter((w) => w.inspired).map((w) => w.name);

  let content = `<p><strong>${actor.name}</strong> rolled a natural 20. Choose one character who witnessed it to gain Heroic Inspiration.</p>`;
  if (already.length) content += `<p><em>Already inspired:</em> ${already.join(", ")}</p>`;
  if (!available.length) content += "<p>No other character on the scene can gain Heroic Inspiration right now.</p>";

  const buttons = available.map((w, i) => ({ action: `pick${i}`, label: w.name }));
  buttons.push({ action: "none", label: "No one", default: true });

  const choice = await DialogV2.wait({
    window: { title: "Inspiring Success", icon: "fa-solid fa-star" },
    content,
    buttons,
    rejectClose: false
  });
  if (!choice || choice === "none") return;

  const target = available[Number(choice.replace("pick", ""))];
  if (!target) return;

  if (game.user.isGM) await grantInspiration(target.uuid);
  else if (game.users.activeGM) game.socket.emit(SOCKET, { action: "inspire", targetUuid: target.uuid });
  else return ui.notifications.warn("Inspiring Success: a GM must be connected to grant Heroic Inspiration.");

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<p><strong>Inspiring Success.</strong> ${actor.name}'s success inspires ${target.name}, who gains Heroic Inspiration.</p>`
  });
}

async function grantInspiration(targetUuid) {
  const target = await fromUuid(targetUuid);
  if (target && !target.system.attributes?.inspiration) {
    await target.update({ "system.attributes.inspiration": true });
  }
}

/* -------------------------------------------- */
/*  Arcane Exhaustion                            */
/* -------------------------------------------- */

const exhaustionCost = (level) => Math.max(1, Math.floor(level / 2));

function isPreparedLeveledSpell(item) {
  if (item?.type !== "spell" || !(item.system.level > 0)) return false;
  if (item.actor?.type !== "character") return false;
  const s = item.system;
  const method = s.method ?? s.preparation?.mode ?? "spell";
  if (!["spell", "pact", "prepared", "always"].includes(method)) return false;
  if (typeof s.prepared === "number") return s.prepared > 0;
  return !!(s.preparation?.prepared || s.preparation?.mode === "always");
}

// Intercept a cast that would fail for lack of a slot and offer the house rule instead.
Hooks.on("dnd5e.preActivityConsumption", (activity, usageConfig) => {
  if (!game.settings.get(ID, "arcaneExhaustion")) return;
  const item = activity.item;
  const actor = activity.actor;
  if (!actor?.isOwner || !isPreparedLeveledSpell(item)) return;
  if (usageConfig.consume?.spellSlot === false) return;
  const slot = usageConfig.spell?.slot;
  const slotData = slot ? actor.system.spells?.[slot] : null;
  if (!slotData || (slotData.value ?? 0) > 0) return;
  const level = slotData.level || Number(String(slot).replace(/\D/g, "")) || item.system.level;
  // dnd5e runs consumption on a temporary clone of the item. Re-run the cast from the real one.
  const original = actor.items.get(item.id)?.system.activities?.get(activity.id) ?? activity;
  setTimeout(() => offerArcaneExhaustion(original, level), 0);
  return false;
});

// A sheet entry for casting at any level directly, slot or no slot.
Hooks.on("dnd5e.getItemContextOptions", (item, options) => {
  if (!game.settings.get(ID, "arcaneExhaustion")) return;
  if (!isPreparedLeveledSpell(item) || !item.actor?.isOwner) return;
  options.push({
    name: "Cast with Arcane Exhaustion",
    icon: '<i class="fa-solid fa-bolt"></i>',
    callback: () => chooseArcaneExhaustion(item)
  });
});

async function offerArcaneExhaustion(activity, level) {
  const actor = activity.actor;
  const dc = 10 + level;
  const cost = exhaustionCost(level);
  const current = actor.system.attributes?.exhaustion ?? 0;
  const confirmed = await DialogV2.confirm({
    window: { title: "Arcane Exhaustion", icon: "fa-solid fa-bolt" },
    content: `<p>${actor.name} has no level ${level} spell slot left. Attempt to cast <strong>${activity.item.name}</strong> anyway?</p>`
      + `<p>Intelligence (Arcana) check, DC ${dc}. Success or failure, ${actor.name} gains ${cost} Exhaustion (${current} → ${Math.min(6, current + cost)}).</p>`,
    rejectClose: false
  });
  if (confirmed) await attemptArcaneExhaustion(activity, level);
}

async function chooseArcaneExhaustion(item) {
  const actor = item.actor;
  const activities = item.system.activities?.contents ?? [];
  if (!activities.length) return ui.notifications.warn(`${item.name} has no activity to cast.`);
  const current = actor.system.attributes?.exhaustion ?? 0;

  const levelOptions = [];
  for (let l = item.system.level; l <= 9; l++) {
    const cost = exhaustionCost(l);
    levelOptions.push(`<option value="${l}">Level ${l}: DC ${10 + l}, ${cost} Exhaustion (${current} → ${Math.min(6, current + cost)})</option>`);
  }
  const activityField = activities.length > 1
    ? `<div class="form-group"><label>Activity</label><select name="activity">${activities.map((a) => `<option value="${a.id}">${a.name}</option>`).join("")}</select></div>`
    : "";

  const result = await DialogV2.prompt({
    window: { title: `Arcane Exhaustion: ${item.name}`, icon: "fa-solid fa-bolt" },
    content: `<p>Cast <strong>${item.name}</strong> without spending a spell slot. The Arcana check and Exhaustion use the level you choose.</p>`
      + `<div class="form-group"><label>Cast at</label><select name="level">${levelOptions.join("")}</select></div>${activityField}`,
    ok: {
      label: "Attempt",
      callback: (event, button) => ({
        level: Number(button.form.elements.level.value),
        activityId: button.form.elements.activity?.value ?? activities[0].id
      })
    },
    rejectClose: false
  });
  if (!result) return;
  const activity = item.system.activities.get(result.activityId);
  if (activity) await attemptArcaneExhaustion(activity, result.level);
}

async function attemptArcaneExhaustion(activity, level) {
  const actor = activity.actor;
  const item = activity.item;
  const dc = 10 + level;
  const cost = exhaustionCost(level);

  // dnd5e 5.x takes chat message fields under `data`; a top-level `flavor` is ignored.
  const rolls = await actor.rollSkill(
    { skill: "arc", ability: "int", target: dc },
    { configure: false },
    { data: { flavor: `Arcane Exhaustion: ${item.name} at level ${level} (DC ${dc})` } }
  );
  const roll = Array.isArray(rolls) ? rolls[0] : rolls;
  const success = !!roll && roll.total >= dc;

  // The house rule: this Exhaustion is applied no matter what.
  const before = actor.system.attributes?.exhaustion ?? 0;
  const after = Math.min(6, before + cost);
  await actor.update({ "system.attributes.exhaustion": after });

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<p><strong>Arcane Exhaustion.</strong> ${actor.name} reaches past their spent magic for <em>${item.name}</em> at level ${level}. `
      + (success ? "The spell holds." : "The spell fizzles and has no effect.")
      + ` ${actor.name} gains ${cost} Exhaustion (now ${after}).</p>`
  });
  if (!success) return;

  const usage = { spell: { slot: `spell${level}` }, consume: { spellSlot: false } };
  if (game.modules.get("midi-qol")?.active && globalThis.MidiQOL?.completeActivityUse) {
    await MidiQOL.completeActivityUse(activity, usage, { configure: false }, {});
  } else {
    await activity.use(usage, { configure: false }, {});
  }
}
