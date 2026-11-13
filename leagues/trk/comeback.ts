import * as djs from "discord.js";
import { z } from "zod";
import { CONFIG } from "../../config.ts";
import type { Handler } from "../../dispatch.ts";
import { mutex } from "../../mutex.ts";
import type { ScryfallCard } from "../../scryfall.ts";
import { makeSealedDeck } from "../../sealeddeck.ts";
import { sheets, sheetsRead, sheetsWrite } from "../../sheets.ts";
import {
  type LeagueSheet,
  rebuildPoolContents,
  ROWNUM,
} from "../../standings.ts";
import {
  hasValidTrkAssimilation,
  validTrkAssimilations,
} from "./assimilation.ts";
import { DM_SENT_COLUMN, trkSheet } from "./constants.ts";
import {
  ensureTrkLossPack,
  lossPackRolled,
  recordedLoss,
} from "./loss-pack.ts";
import {
  chargeCounts,
  ferenginarStationed,
  fetchScryfallCard,
  picksForNewStation,
  type Planet,
  planetByName,
  PLANETS,
  type PlanetSheetRow,
  readPlanetStatus,
  rollPlanetCards,
  writePlanetCharges,
} from "./planets.ts";

const BORG_CARD_FORM_URL =
  "https://docs.google.com/forms/d/e/1FAIpQLSdnhrqltBJDsDWKErTIykbYjVTSR7WX0wUGpeWfgrPnVXs_rg/viewform?usp=dialog";

const BORG_CARD_DM = [
  "You lost your first match, and you have not selected a Borg card.",
  "Choose one card from your starting pool to add to your Borg pool:",
  BORG_CARD_FORM_URL,
].join("\n");

/** Older Pool Changes rows that recorded the planet menu before Matches!DM Sent. */
const PLANET_OFFER = "planet offer";
/** Pool Changes column G on the loss pack row: the planet chosen for that loss. */
const PLANET_COLUMN = "Planet Stationed";
/** Pool Changes type: two Scryfall ids waiting on a Ferenginar pick. */
const CARD_OFFER = "card offer";
/** Pool Changes type: the loss pack. Value stays `pending` until the pack id is written. */
const LOSS_PACK = "loss pack";
const ADD_CARD = "add card";
const SENT_MARK = "[sent]";
const PLANET_PREFIX = "trk-planet";
const PLANET_SUBMIT = "trk-planet-submit";
const CARD_PREFIX = "trk-planet-card";
const CARD_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const acquirePlanetLock = mutex();
const inFlight = new Set<string>();

function withPlanetLock<T>(body: () => Promise<T>): Promise<T> {
  return (async () => {
    using _lock = await acquirePlanetLock();
    return await body();
  })();
}

async function rollPendingPack(
  client: djs.Client,
  sheet: LeagueSheet,
  identification: string,
  discordId: string,
  matchRow: number,
  pack: ChangeRow,
): Promise<string | undefined> {
  if (lossPackRolled(pack.Value)) return undefined;
  if (!await hasValidTrkAssimilation(sheet, identification)) return undefined;
  try {
    return await ensureTrkLossPack({
      client,
      sheet,
      identification,
      discordId,
      matchRow,
      packRow: pack[ROWNUM],
      value: pack.Value,
      comment: pack.Comment ?? "",
      withLock: withPlanetLock,
    });
  } catch (err) {
    console.error(`[trk] loss pack failed for match ${matchRow}:`, err);
  }
  return undefined;
}

type ChangeRow =
  & Awaited<
    ReturnType<LeagueSheet["getPoolChanges"]>
  >["rows"][number]
  & {
    readonly "Planet Stationed"?: string | null;
  };

interface PlanetView {
  readonly content: string;
  readonly components: djs.ActionRowBuilder<
    djs.StringSelectMenuBuilder | djs.ButtonBuilder
  >[];
  readonly embeds: djs.EmbedBuilder[];
  readonly publicNote?: string;
  /** Pool Changes row whose comment should gain `[sent]` after delivery. */
  readonly markSent?: { readonly row: number; readonly comment: string };
}

interface PlanetOfferRequest {
  readonly client: djs.Client;
  readonly channel: djs.TextChannel;
  readonly sheet: LeagueSheet;
  readonly identification: string;
  readonly discordId: string;
  readonly opponent: string;
  readonly matchRow: number;
}

interface PlanetClick {
  readonly kind: "preview" | "planet" | "card";
  readonly matchRow: number;
  readonly discordId: string;
  readonly cardId?: string;
  readonly planet?: string;
}

/**
 * A first loss whose player has no Valid? row on the Assimilation tab.
 * Losses already includes the match being announced.
 */
export async function trkNeedsBorgCardReminder(
  sheet: LeagueSheet,
  identification: string,
  losses: number,
): Promise<boolean> {
  if (losses !== 1) return false;
  return !await hasValidTrkAssimilation(sheet, identification);
}

/**
 * Asks the player to submit a Borg card. Falls back to `fallback` when the
 * DM cannot be delivered. Does not throw.
 */
export async function remindTrkBorgCard(
  client: djs.Client,
  discordId: string,
  fallback: djs.TextChannel,
): Promise<void> {
  try {
    const user = await client.users.fetch(discordId);
    await user.send(BORG_CARD_DM);
    console.log(`[trk] DM'd ${discordId} to select a Borg card`);
    return;
  } catch (err) {
    console.error(
      `[trk] Could not DM ${discordId} about Borg selection:`,
      err,
    );
  }
  try {
    await fallback.send(
      `<@${discordId}> I couldn't reach you by DM. You still need to select a Borg card:\n${BORG_CARD_FORM_URL}`,
    );
  } catch (err) {
    console.error(
      `[trk] Borg card reminder fallback failed for ${discordId}:`,
      err,
    );
  }
}

/**
 * Sends the planet menu for a loss that is not an elimination, once the
 * player has a valid Borg card. Matches!DM Sent records delivery. Until
 * then the pack stays held. A failed DM is retried by {@link resumeTrkPlanets}.
 * Does not throw.
 */
export async function offerTrkPlanet(
  request: PlanetOfferRequest,
): Promise<void> {
  try {
    using _lock = await acquirePlanetLock();
    await deliverPlanetOffer(request);
  } catch (err) {
    console.error(
      `[trk] planet offer failed for match ${request.matchRow}:`,
      err,
    );
  }
}

/**
 * Delivers planet menus that never went out, and finishes stations whose
 * card or notification was interrupted.
 */
export async function resumeTrkPlanets(
  client: djs.Client,
  sheet: LeagueSheet,
  channel: djs.TextChannel,
): Promise<void> {
  let rows: readonly ChangeRow[];
  let waiting: readonly PlanetOfferRequest[];
  try {
    using _lock = await acquirePlanetLock();
    const synced = await syncCharges(sheet);
    rows = synced.rows;
    try {
      waiting = await menusWaiting(client, sheet, channel, rows);
    } catch (err) {
      console.error("[trk] could not read DM Sent:", err);
      waiting = [];
    }
  } catch (err) {
    console.error("[trk] planet resume could not read Pool Changes:", err);
    return;
  }
  for (const request of waiting) {
    try {
      using _lock = await acquirePlanetLock();
      await deliverPlanetOffer(request);
    } catch (err) {
      console.error(
        `[trk] planet menu failed for match ${request.matchRow}:`,
        err,
      );
    }
  }
  let matches: Awaited<ReturnType<LeagueSheet["getMatches"]>>;
  try {
    matches = await sheet.getMatches({ "Match Announced": z.unknown() });
  } catch (err) {
    console.error("[trk] planet resume could not read Matches:", err);
    return;
  }
  const matchRows = new Set<number>();
  for (const row of rows) {
    if (
      row.Type !== PLANET_OFFER && row.Type !== "planet" &&
      row.Type !== "station" &&
      row.Type !== CARD_OFFER && row.Type !== ADD_CARD &&
      row.Type !== LOSS_PACK
    ) continue;
    const matchRow = linkedMatch(row, matches.rows);
    if (matchRow !== undefined) matchRows.add(matchRow);
  }
  for (const matchRow of matchRows) {
    const key = lossKey(matches.rows, matchRow);
    if (!key || !needsResume(rows, key)) continue;
    try {
      using _lock = await acquirePlanetLock();
      await resumeMatch(client, sheet, channel, matchRow);
    } catch (err) {
      console.error(`[trk] planet resume failed for match ${matchRow}:`, err);
    }
  }
}

/** Planet select menu and the two-card buttons. */
export const trkPlanetHandler: Handler<djs.Interaction> = async (
  interaction,
  handle,
) => {
  if (!interaction.isButton() && !interaction.isStringSelectMenu()) return;
  const click = parseClick(interaction);
  if (!click) return;
  handle.claim();

  if (interaction.user.id !== click.discordId) {
    await interaction.reply({
      content: "This choice belongs to another player.",
      ephemeral: true,
    });
    return;
  }
  const sheet = trkSheet();
  const key = interaction.message.id;
  if (inFlight.has(key)) {
    await interaction.reply({
      content: "Still working on that choice.",
      ephemeral: true,
    });
    return;
  }
  inFlight.add(key);
  let replaced = false;
  const locked = click.kind === "planet"
    ? lockedSubmit(interaction.message)
    : undefined;
  const original = locked
    ? interaction.message.components.map((row) =>
      "toJSON" in row ? row.toJSON() : row
    )
    : undefined;
  try {
    if (
      click.kind !== "preview" &&
      await earlierLossInProgress(sheet, click.matchRow)
    ) {
      await interaction.reply({
        content:
          "Your earlier loss still needs its planet and pack. Finish that one first.",
        ephemeral: true,
      });
      return;
    }
    if (locked) {
      await interaction.update({ components: locked });
    } else {
      await interaction.deferUpdate();
    }
    const present = async (view: PlanetView) => {
      await interaction.editReply(viewPayload(view));
      replaced = true;
      if (!view.publicNote) return;
      if (interaction.channelId === CONFIG.PACKGEN_CHANNEL_ID) return;
      await postPublic(interaction.client, view.publicNote);
    };
    if (click.kind === "preview") {
      const selected = interaction.isStringSelectMenu()
        ? interaction.values[0] ?? ""
        : "";
      await presentPlanetPreview(sheet, click, selected, present);
    } else if (click.kind === "planet") {
      await applyPlanetChoice(
        interaction.client,
        sheet,
        click,
        click.planet ?? "",
        present,
      );
    } else {
      await applyCardChoice(interaction.client, sheet, click, present);
    }
  } catch (err) {
    console.error("[trk] planet choice failed:", err);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content:
          "Something went wrong finishing that planet. I'll try again shortly.",
        ephemeral: true,
      }).catch((replyErr) => {
        console.error("[trk] planet reply failed:", replyErr);
      });
      return;
    }
    if (original && !replaced) {
      await interaction.editReply({ components: original }).catch((editErr) => {
        console.error("[trk] could not restore the planet menu:", editErr);
      });
    }
    await interaction.followUp({
      content:
        "Something went wrong finishing that planet. I'll try again shortly.",
    }).catch((followErr) => {
      console.error("[trk] planet follow-up failed:", followErr);
    });
  } finally {
    inFlight.delete(key);
  }
};

async function presentPlanetPreview(
  sheet: LeagueSheet,
  click: PlanetClick,
  selected: string,
  present: (view: PlanetView) => Promise<void>,
): Promise<void> {
  if (!planetByName(selected)) {
    await present(plainView("That planet isn't one of the eight."));
    return;
  }
  const loaded = await loadMatch(sheet, click.matchRow, click.discordId);
  if ("error" in loaded) {
    await present(plainView(loaded.error));
    return;
  }
  await present(
    await menuView(
      sheet,
      click.matchRow,
      click.discordId,
      loaded.opponent,
      undefined,
      selected,
    ),
  );
}

/**
 * Announced losses whose planet menu has not been delivered. An old
 * `planet offer` row marked `[sent]` is copied onto DM Sent instead of
 * prompting again.
 */
async function menusWaiting(
  client: djs.Client,
  sheet: LeagueSheet,
  channel: djs.TextChannel,
  rows: readonly ChangeRow[],
): Promise<PlanetOfferRequest[]> {
  const [matches, players] = await Promise.all([
    sheet.getMatches({
      "Match Announced": z.unknown(),
      [DM_SENT_COLUMN]: z.unknown(),
    }),
    sheet.getPlayers(),
  ]);
  const ordinals = lossOrdinals(matches.rows);
  let validBorg: ReadonlySet<string> | undefined;
  try {
    validBorg = await validTrkAssimilations(sheet);
  } catch (err) {
    console.error("[trk] could not read Assimilation:", err);
  }
  const waiting: PlanetOfferRequest[] = [];
  for (const match of matches.rows) {
    if (!cellIsTrue(matchCell(match, "Match Announced"))) continue;
    const matchRow = match[ROWNUM];
    const ordinal = ordinals.get(matchRow);
    if (ordinal === undefined || ordinal >= CONFIG.MAX_LOSSES) continue;
    const key = {
      matchRow,
      identification: match["Loser Name"],
      loss: ordinal,
    };
    if (chosenPlanet(rows, key)) continue;
    const legacy = findChange(rows, PLANET_OFFER, key);
    if (
      cellIsTrue(matchCell(match, DM_SENT_COLUMN)) ||
      (legacy && isSent(legacy))
    ) {
      if (!cellIsTrue(matchCell(match, DM_SENT_COLUMN))) {
        await markDmSent(sheet, matchRow);
      }
      continue;
    }
    const identification = match["Loser Name"];
    const player = players.rows.find((row) =>
      row.Identification === identification
    );
    const discordId = `${player?.["Discord ID"] ?? ""}`.trim();
    if (!discordId) {
      console.error(
        `[trk] ${identification} has no Discord ID for match ${matchRow}`,
      );
      continue;
    }
    if (validBorg && !validBorg.has(identification)) continue;
    const open = earliestOpenLoss(matches.rows, rows, identification);
    if (open !== matchRow) continue;
    waiting.push({
      client,
      channel,
      sheet,
      identification,
      discordId,
      opponent: match["Your Name"],
      matchRow,
    });
  }
  return waiting;
}

async function deliverPlanetOffer(request: PlanetOfferRequest): Promise<void> {
  const [changes, matches] = await Promise.all([
    trkPoolChanges(request.sheet),
    request.sheet.getMatches({ "Match Announced": z.unknown() }),
  ]);
  const key = lossKey(matches.rows, request.matchRow);
  if (!key) return;
  const open = earliestOpenLoss(
    matches.rows,
    changes.rows,
    request.identification,
  );
  if (open !== request.matchRow) {
    console.log(
      `[trk] holding match ${request.matchRow} for ${request.identification} until match ${open} is finished`,
    );
    return;
  }
  if (chosenPlanet(changes.rows, key)) return;
  const legacy = findChange(changes.rows, PLANET_OFFER, key);
  if (legacy && isSent(legacy)) {
    await markDmSent(request.sheet, request.matchRow);
    return;
  }
  if (await dmWasSent(request.sheet, request.matchRow)) return;
  if (!await hasValidTrkAssimilation(request.sheet, request.identification)) {
    console.log(
      `[trk] holding the planet and pack for ${request.identification} match ${request.matchRow} until a Borg card is valid`,
    );
    return;
  }
  const view = await menuView(
    request.sheet,
    request.matchRow,
    request.discordId,
    request.opponent,
  );
  await deliver(request.client, request.discordId, request.channel, view);
  await markDmSent(request.sheet, request.matchRow);
}

async function resumeMatch(
  client: djs.Client,
  sheet: LeagueSheet,
  channel: djs.TextChannel,
  matchRow: number,
): Promise<void> {
  const [changes, matches] = await Promise.all([
    trkPoolChanges(sheet),
    sheet.getMatches({ "Match Announced": z.unknown() }),
  ]);
  const rows = changes.rows;
  const key = lossKey(matches.rows, matchRow);
  if (!key) return;
  const open = earliestOpenLoss(matches.rows, rows, key.identification);
  if (open !== matchRow) return;
  const chosen = chosenPlanet(rows, key);
  const card = findChange(rows, ADD_CARD, key);
  const pack = findChange(rows, LOSS_PACK, key);
  const cardOffer = findChange(rows, CARD_OFFER, key);

  if (!chosen) return;

  const planet = chosen.planet;
  const discordId = await discordIdFor(sheet, chosen.identification);
  if (!discordId) return;
  const counts = chargeCounts(rows);

  if (card) {
    const packRow = pack ??
      await appendChange(
        sheet,
        chosen.identification,
        LOSS_PACK,
        "pending",
        lossLabel(key.loss),
      );
    const fullPoolId = await rollPendingPack(
      client,
      sheet,
      chosen.identification,
      discordId,
      matchRow,
      packRow,
    );
    if (isSent(packRow)) return;
    const poolId = fullPoolId ?? card["Full Pool"] ?? "";
    const view = doneView({
      planet,
      cardName: card.Value,
      poolId,
      discordId,
      announce: true,
      markSent: { row: packRow[ROWNUM], comment: packRow.Comment ?? "" },
    });
    await deliver(client, discordId, channel, view);
    await markSent(sheet, packRow[ROWNUM], packRow.Comment ?? "");
    return;
  }

  if (ferenginarStationed(counts)) {
    const offerRow = cardOffer ?? await createCardOffer(sheet, planet, key);
    if (isSent(offerRow)) return;
    const cards = await cardsFromOffer(offerRow);
    const view = chooseView({
      planet,
      cards,
      matchRow,
      discordId,
      announce: !cardOffer,
      markSent: { row: offerRow[ROWNUM], comment: offerRow.Comment ?? "" },
    });
    await deliver(client, discordId, channel, view);
    await markSent(sheet, offerRow[ROWNUM], offerRow.Comment ?? "");
    return;
  }

  const [rolled] = await rollPlanetCards(planet, 1);
  if (!rolled) throw new Error(`No card for ${planet.name}`);
  const packRow = pack ?? await appendChange(
    sheet,
    chosen.identification,
    LOSS_PACK,
    "pending",
    lossLabel(key.loss),
  );
  await rollPendingPack(
    client,
    sheet,
    chosen.identification,
    discordId,
    matchRow,
    packRow,
  );
  const granted = await grantCard(sheet, key, planet, rolled);
  const view = doneView({
    planet,
    cardName: granted.cardName,
    card: granted.created ? granted.card : undefined,
    poolId: granted.poolId,
    discordId,
    announce: granted.created,
    markSent: { row: packRow[ROWNUM], comment: packRow.Comment ?? "" },
  });
  await deliver(client, discordId, channel, view);
  await markSent(sheet, packRow[ROWNUM], packRow.Comment ?? "");
}

async function applyPlanetChoice(
  client: djs.Client,
  sheet: LeagueSheet,
  click: PlanetClick,
  selected: string,
  present: (view: PlanetView) => Promise<void>,
): Promise<void> {
  using _lock = await acquirePlanetLock();
  const loaded = await loadMatch(sheet, click.matchRow, click.discordId);
  if ("error" in loaded) {
    await present(plainView(loaded.error));
    return;
  }
  const chosen = chosenPlanet(loaded.changes, loaded);
  if (!chosen) {
    if (!await hasValidTrkAssimilation(sheet, loaded.identification)) {
      await present(plainView(
        [
          "Choose a Borg card before you station a planet.",
          BORG_CARD_FORM_URL,
        ].join("\n"),
      ));
      return;
    }
    const planet = planetByName(selected);
    if (!planet) {
      await present(
        await menuView(
          sheet,
          click.matchRow,
          click.discordId,
          loaded.opponent,
          "That planet isn't one of the eight. Choose again.",
        ),
      );
      return;
    }
    const counts = chargeCounts(loaded.changes);
    const picks = picksForNewStation(counts, planet.name);
    let cards: readonly ScryfallCard[];
    try {
      cards = await rollPlanetCards(planet, picks);
    } catch (err) {
      console.error(`[trk] card roll failed for ${planet.name}:`, err);
      await present(
        await menuView(
          sheet,
          click.matchRow,
          click.discordId,
          loaded.opponent,
          `I couldn't roll a card for **${planet.name}**. Choose again.`,
          selected,
        ),
      );
      return;
    }
    await recordPlanetChoice(sheet, loaded, planet.name);
    await syncCharges(sheet);
    const rolled = cards[0];
    if (!rolled) throw new Error(`No card for ${planet.name}`);
    const view = cards.length >= 2
      ? await offeredChoice(sheet, loaded, planet, cards)
      : await grantedCard(client, sheet, loaded, planet, rolled, picks === 2);
    await present(view);
    if (view.markSent) {
      await markSent(sheet, view.markSent.row, view.markSent.comment);
    }
    return;
  }

  const view = await viewForExistingStation(
    client,
    sheet,
    loaded,
    chosen.planet,
  );
  await present(view);
  if (view.markSent) {
    await markSent(sheet, view.markSent.row, view.markSent.comment);
  }
}

async function applyCardChoice(
  client: djs.Client,
  sheet: LeagueSheet,
  click: PlanetClick,
  present: (view: PlanetView) => Promise<void>,
): Promise<void> {
  using _lock = await acquirePlanetLock();
  const loaded = await loadMatch(sheet, click.matchRow, click.discordId);
  if ("error" in loaded) {
    await present(plainView(loaded.error));
    return;
  }
  const chosen = chosenPlanet(loaded.changes, loaded);
  if (!chosen) {
    await present(plainView("Choose a planet first."));
    return;
  }
  const planet = chosen.planet;
  const existing = findChange(loaded.changes, ADD_CARD, loaded);
  if (existing) {
    await present(alreadyGrantedView(loaded, planet, existing));
    return;
  }
  const offer = findChange(loaded.changes, CARD_OFFER, loaded);
  const ids = offer ? offeredIds(offer) : [];
  if (!click.cardId || !ids.includes(click.cardId)) {
    await present(
      plainView("That card isn't one of the two you were offered."),
    );
    return;
  }
  const card = await fetchScryfallCard(click.cardId);
  if (!card) {
    await present(
      plainView("I couldn't read that card from Scryfall. Try again."),
    );
    return;
  }
  const view = await grantedCard(client, sheet, loaded, planet, card);
  await present(view);
  if (view.markSent) {
    await markSent(sheet, view.markSent.row, view.markSent.comment);
  }
}

async function offeredChoice(
  sheet: LeagueSheet,
  loaded: LoadedMatch,
  planet: Planet,
  cards: readonly ScryfallCard[],
): Promise<PlanetView> {
  const offer = await appendChange(
    sheet,
    loaded.identification,
    CARD_OFFER,
    cards.map((card) => card.id).join(","),
    lossLabel(loaded.loss),
  );
  return chooseView({
    planet,
    cards,
    matchRow: loaded.matchRow,
    discordId: loaded.discordId,
    announce: true,
    markSent: { row: offer[ROWNUM], comment: offer.Comment ?? "" },
  });
}

async function grantedCard(
  client: djs.Client,
  sheet: LeagueSheet,
  loaded: LoadedMatch,
  planet: Planet,
  card: ScryfallCard,
  onlyCard = false,
): Promise<PlanetView> {
  const existingPack = findChange(
    (await trkPoolChanges(sheet)).rows,
    LOSS_PACK,
    loaded,
  );
  const pack = existingPack ?? await appendChange(
    sheet,
    loaded.identification,
    LOSS_PACK,
    "pending",
    lossLabel(loaded.loss),
  );
  await rollPendingPack(
    client,
    sheet,
    loaded.identification,
    loaded.discordId,
    loaded.matchRow,
    pack,
  );
  const granted = await grantCard(sheet, loaded, planet, card);
  return doneView({
    planet,
    cardName: granted.cardName,
    card: granted.created ? granted.card : undefined,
    poolId: granted.poolId,
    discordId: loaded.discordId,
    announce: granted.created,
    onlyCard: onlyCard && granted.created,
    markSent: isSent(pack)
      ? undefined
      : { row: pack[ROWNUM], comment: pack.Comment ?? "" },
  });
}

async function viewForExistingStation(
  client: djs.Client,
  sheet: LeagueSheet,
  loaded: LoadedMatch,
  planet: Planet,
): Promise<PlanetView> {
  const changes = await trkPoolChanges(sheet);
  const card = findChange(changes.rows, ADD_CARD, loaded);
  if (card) {
    const pack = findChange(changes.rows, LOSS_PACK, loaded) ??
      await appendChange(
        sheet,
        loaded.identification,
        LOSS_PACK,
        "pending",
        lossLabel(loaded.loss),
      );
    const fullPoolId = await rollPendingPack(
      client,
      sheet,
      loaded.identification,
      loaded.discordId,
      loaded.matchRow,
      pack,
    );
    return alreadyGrantedView(loaded, planet, card, fullPoolId);
  }
  if (ferenginarStationed(chargeCounts(changes.rows))) {
    const existingOffer = findChange(changes.rows, CARD_OFFER, loaded);
    const offer = existingOffer ??
      await createCardOffer(sheet, planet, loaded);
    const cards = await cardsFromOffer(offer);
    return chooseView({
      planet,
      cards,
      matchRow: loaded.matchRow,
      discordId: loaded.discordId,
      announce: !existingOffer,
      markSent: isSent(offer)
        ? undefined
        : { row: offer[ROWNUM], comment: offer.Comment ?? "" },
    });
  }
  const [rolled] = await rollPlanetCards(planet, 1);
  if (!rolled) throw new Error(`No card for ${planet.name}`);
  return await grantedCard(client, sheet, loaded, planet, rolled);
}

function alreadyGrantedView(
  loaded: LoadedMatch,
  planet: Planet,
  card: ChangeRow,
  fullPoolId?: string,
): PlanetView {
  return doneView({
    planet,
    cardName: card.Value,
    poolId: fullPoolId ?? card["Full Pool"] ?? "",
    discordId: loaded.discordId,
    announce: false,
  });
}

async function createCardOffer(
  sheet: LeagueSheet,
  planet: Planet,
  key: LossKey,
): Promise<ChangeRow> {
  const cards = await rollPlanetCards(planet, 2);
  return await appendChange(
    sheet,
    key.identification,
    CARD_OFFER,
    cards.map((card) => card.id).join(","),
    lossLabel(key.loss),
  );
}

interface LossKey {
  readonly matchRow: number;
  readonly identification: string;
  readonly loss: number;
}

interface LoadedMatch extends LossKey {
  readonly changes: readonly ChangeRow[];
  readonly discordId: string;
  readonly opponent: string;
}

async function loadMatch(
  sheet: LeagueSheet,
  matchRow: number,
  discordId: string,
): Promise<LoadedMatch | { error: string }> {
  const matches = await sheet.getMatches({ "Match Announced": z.unknown() });
  const players = await sheet.getPlayers();
  const changes = await trkPoolChanges(sheet);
  const match = matches.rows.find((row) => row[ROWNUM] === matchRow);
  if (!match) return { error: "I can't find that loss anymore." };
  if (!matchOpen(match["Match Announced"])) {
    return {
      error: "That match was rejected, so there's no planet to station.",
    };
  }
  const player = players.rows.find((row) =>
    row.Identification === match["Loser Name"]
  );
  if (!player || `${player["Discord ID"] ?? ""}`.trim() !== discordId) {
    return { error: "This choice belongs to another player." };
  }
  const key = lossKey(matches.rows, matchRow);
  if (!key) return { error: "That match is not a counted loss." };
  return {
    changes: changes.rows,
    discordId,
    opponent: match["Your Name"],
    ...key,
  };
}

async function grantCard(
  sheet: LeagueSheet,
  key: LossKey,
  planet: Planet,
  card: ScryfallCard,
): Promise<{
  card: ScryfallCard;
  cardName: string;
  poolId: string;
  created: boolean;
}> {
  const changes = await trkPoolChanges(sheet);
  const existing = findChange(changes.rows, ADD_CARD, key);
  if (existing) {
    return {
      card,
      cardName: existing.Value,
      poolId: existing["Full Pool"] ?? "",
      created: false,
    };
  }
  const prior = changes.rows.filter((row) => row.Name === key.identification);
  const sideboard = await rebuildPoolContents(
    prior.map((row) => [row.Timestamp, row.Name, row.Type, row.Value]),
  );
  const count = sideboard.find((entry) => entry.name === card.name)?.count ??
    0;
  const poolId = await makeSealedDeck({
    sideboard: [
      ...sideboard.filter((entry) => entry.name !== card.name),
      { name: card.name, set: card.set, count: count + 1 },
    ],
  });
  await sheet.addPoolChange(
    key.identification,
    ADD_CARD,
    card.name,
    `${planet.name} (${lossLabel(key.loss)})`,
    poolId,
  );
  return { card, cardName: card.name, poolId, created: true };
}

async function appendChange(
  sheet: LeagueSheet,
  name: string,
  type: string,
  value: string,
  comment: string,
): Promise<ChangeRow> {
  await sheet.addPoolChange(name, type, value, comment);
  const changes = await trkPoolChanges(sheet);
  const row = changes.rows.findLast((entry) =>
    entry.Name === name && entry.Type === type && entry.Value === value &&
    (entry.Comment ?? "") === comment
  );
  if (!row) {
    throw new Error(`Recorded ${type} did not read back (${comment})`);
  }
  return row;
}

function lockedSubmit(
  message: djs.Message | djs.APIMessage,
): [
  djs.ActionRowBuilder<djs.StringSelectMenuBuilder>,
  djs.ActionRowBuilder<djs.ButtonBuilder>,
] | undefined {
  const components = message.components ?? [];
  const selectRow = components[0];
  const buttonRow = components[1];
  if (
    !selectRow || selectRow.type !== djs.ComponentType.ActionRow ||
    !buttonRow || buttonRow.type !== djs.ComponentType.ActionRow
  ) return undefined;
  const selectJson = "toJSON" in selectRow ? selectRow.toJSON() : selectRow;
  const buttonJson = "toJSON" in buttonRow ? buttonRow.toJSON() : buttonRow;
  const select = selectJson.components[0];
  const button = buttonJson.components[0];
  if (
    !select || select.type !== djs.ComponentType.StringSelect ||
    !button || button.type !== djs.ComponentType.Button
  ) return undefined;
  return [
    new djs.ActionRowBuilder<djs.StringSelectMenuBuilder>().addComponents(
      djs.StringSelectMenuBuilder.from(select),
    ),
    new djs.ActionRowBuilder<djs.ButtonBuilder>().addComponents(
      djs.ButtonBuilder.from(button).setDisabled(true),
    ),
  ];
}

async function menuView(
  sheet: LeagueSheet,
  matchRow: number,
  discordId: string,
  opponent: string,
  preface?: string,
  selected?: string,
): Promise<PlanetView> {
  const status = await bonusRows(sheet);
  const lines = [
    preface,
    `You lost to **${
      opponent || "your opponent"
    }**. The Borg press the advantage.`,
    "Station a planet to hold the line. That world gains one charge counter against the Collective, and you receive a card from its reserves.",
    "Press Submit to station it.",
  ].filter((line): line is string => Boolean(line));
  const chosen = planetByName(selected ?? "");
  const menu = new djs.StringSelectMenuBuilder()
    .setCustomId(`${PLANET_PREFIX}:${matchRow}:${discordId}`)
    .setPlaceholder("Choose a planet")
    .addOptions(PLANETS.map((planet) => {
      const bonus = sheetBonus(status, planet) || planet.planetBonus;
      return {
        label: planet.name,
        value: planet.name,
        description: optionDescription(bonus),
        default: planet.name === chosen?.name,
      };
    }));
  const submit = new djs.ButtonBuilder()
    .setCustomId(
      chosen
        ? `${PLANET_SUBMIT}:${matchRow}:${discordId}:${chosen.name}`
        : `${PLANET_SUBMIT}:${matchRow}:${discordId}`,
    )
    .setLabel("Submit")
    .setStyle(djs.ButtonStyle.Primary)
    .setDisabled(!chosen);
  return {
    content: lines.join("\n\n"),
    components: [
      new djs.ActionRowBuilder<djs.StringSelectMenuBuilder>().addComponents(
        menu,
      ),
      new djs.ActionRowBuilder<djs.ButtonBuilder>().addComponents(submit),
    ],
    embeds: [],
  };
}

function chooseView(args: {
  readonly planet: Planet;
  readonly cards: readonly ScryfallCard[];
  readonly matchRow: number;
  readonly discordId: string;
  readonly announce: boolean;
  readonly markSent?: PlanetView["markSent"];
}): PlanetView {
  const row = new djs.ActionRowBuilder<djs.ButtonBuilder>().addComponents(
    args.cards.map((card) =>
      new djs.ButtonBuilder()
        .setCustomId(
          `${CARD_PREFIX}:${args.matchRow}:${card.id}:${args.discordId}`,
        )
        .setLabel(buttonLabel(card.name))
        .setStyle(djs.ButtonStyle.Primary)
    ),
  );
  return {
    content: [
      `You stationed **${args.planet.name}**.`,
      "Choose one card to add to your pool.",
    ].join("\n"),
    components: [row],
    embeds: args.cards.map(cardEmbed),
    publicNote: args.announce
      ? `<@${args.discordId}> stationed **${args.planet.name}**.`
      : undefined,
    markSent: args.markSent,
  };
}

function doneView(args: {
  readonly planet: Planet;
  readonly cardName: string;
  readonly card?: ScryfallCard;
  readonly poolId: string;
  readonly discordId: string;
  readonly announce: boolean;
  readonly onlyCard?: boolean;
  readonly markSent?: PlanetView["markSent"];
}): PlanetView {
  const pool = args.poolId ? `https://sealeddeck.tech/${args.poolId}` : "";
  const lines = [
    `You stationed **${args.planet.name}**.`,
    args.onlyCard
      ? "That search only produced one card, so it was added directly."
      : undefined,
    `Added **${args.cardName}**${
      args.card ? ` (${args.card.set.toUpperCase()})` : ""
    } to your pool.`,
    pool,
  ].filter((line): line is string => Boolean(line));
  return {
    content: lines.join("\n"),
    components: [],
    embeds: args.card ? [cardEmbed(args.card)] : [],
    publicNote: args.announce
      ? `<@${args.discordId}> stationed **${args.planet.name}** and added **${args.cardName}**.${
        pool ? ` ${pool}` : ""
      }`
      : undefined,
    markSent: args.markSent,
  };
}

function plainView(content: string): PlanetView {
  return { content, components: [], embeds: [] };
}

function sheetBonus(
  status: readonly PlanetSheetRow[],
  planet: Planet,
): string {
  const row = status.find((entry) => planetByName(entry.name) === planet);
  return row?.planetBonus ?? "";
}

function optionDescription(bonus: string): string {
  const text = bonus.trim() || "Planet card";
  return text.length <= 100 ? text : `${text.slice(0, 99)}…`;
}

function buttonLabel(name: string): string {
  return name.length <= 80 ? name : `${name.slice(0, 79)}…`;
}

function cardEmbed(card: ScryfallCard): djs.EmbedBuilder {
  const image = card.image_uris?.normal ??
    card.card_faces?.[0]?.image_uris?.normal;
  const embed = new djs.EmbedBuilder()
    .setTitle(card.name)
    .setURL(
      card.scryfall_uri ??
        `https://scryfall.com/card/${card.set}/${card.collector_number}`,
    );
  if (image) embed.setImage(image);
  return embed;
}

function viewPayload(view: PlanetView): djs.InteractionEditReplyOptions {
  return {
    content: view.content,
    components: view.components,
    embeds: view.embeds,
  };
}

async function deliver(
  client: djs.Client,
  discordId: string,
  channel: djs.TextChannel,
  view: PlanetView,
): Promise<void> {
  const payload = {
    content: view.content,
    components: view.components,
    embeds: view.embeds,
  };
  try {
    const user = await client.users.fetch(discordId);
    await user.send(payload);
    if (view.publicNote) await postToChannel(channel, view.publicNote);
    return;
  } catch (err) {
    console.error(`[trk] Could not DM ${discordId} about a planet:`, err);
  }
  const content = view.publicNote
    ? `<@${discordId}>\n${view.publicNote}\n${view.content}`
    : `<@${discordId}>\n${view.content}`;
  await channel.send({ ...payload, content });
}

async function postPublic(client: djs.Client, text: string): Promise<void> {
  try {
    const channel = await client.channels.fetch(CONFIG.PACKGEN_CHANNEL_ID);
    if (!(channel instanceof djs.TextChannel)) return;
    await channel.send(text);
  } catch (err) {
    console.error("[trk] planet announcement failed:", err);
  }
}

function postToChannel(
  channel: djs.TextChannel,
  text: string,
): Promise<unknown> {
  return channel.send(text).catch((err) => {
    console.error("[trk] planet announcement failed:", err);
  });
}

/**
 * Recounts planets named in Pool Changes and writes each planet's Charge
 * Counters cell on Planet Status.
 */
async function syncCharges(
  sheet: LeagueSheet,
): Promise<{
  counts: ReadonlyMap<string, number>;
  status: readonly PlanetSheetRow[];
  rows: readonly ChangeRow[];
}> {
  const changes = await trkPoolChanges(sheet);
  const counts = chargeCounts(changes.rows);
  try {
    const status = await writePlanetCharges(sheet, counts);
    return { counts, status, rows: changes.rows };
  } catch (err) {
    console.error("[trk] could not write Planet Status charges:", err);
    return { counts, status: await bonusRows(sheet), rows: changes.rows };
  }
}

async function bonusRows(
  sheet: LeagueSheet,
): Promise<readonly PlanetSheetRow[]> {
  try {
    return await readPlanetStatus(sheet);
  } catch (err) {
    console.error("[trk] Planet Status unreadable:", err);
    return [];
  }
}

async function discordIdFor(
  sheet: LeagueSheet,
  identification: string,
): Promise<string | undefined> {
  const players = await sheet.getPlayers();
  const player = players.rows.find((row) =>
    row.Identification === identification
  );
  const discordId = `${player?.["Discord ID"] ?? ""}`.trim();
  if (!discordId) {
    console.error(`[trk] ${identification} has no Discord ID for a planet`);
    return undefined;
  }
  return discordId;
}

async function cardsFromOffer(offer: ChangeRow): Promise<ScryfallCard[]> {
  const cards: ScryfallCard[] = [];
  for (const id of offeredIds(offer)) {
    const card = await fetchScryfallCard(id);
    if (!card) throw new Error(`Offered card ${id} is not on Scryfall`);
    cards.push(card);
  }
  if (cards.length === 0) throw new Error("Card offer is empty");
  return cards;
}

function offeredIds(offer: ChangeRow): string[] {
  return offer.Value.split(",").map((id) => id.trim()).filter((id) =>
    CARD_ID.test(id)
  );
}

async function markSent(
  sheet: LeagueSheet,
  row: number,
  comment: string,
): Promise<void> {
  const changes = await sheet.getPoolChanges();
  const current =
    changes.rows.find((entry) => entry[ROWNUM] === row)?.Comment ??
      comment;
  if (current.includes(SENT_MARK)) return;
  await sheetsWrite(
    sheets,
    sheet.sheetId,
    `Pool Changes!E${row}`,
    [[`${current} ${SENT_MARK}`]],
  );
}

function needsResume(
  rows: readonly ChangeRow[],
  key: LossKey,
): boolean {
  const chosen = chosenPlanet(rows, key);
  const card = findChange(rows, ADD_CARD, key);
  const pack = findChange(rows, LOSS_PACK, key);
  const cardOffer = findChange(rows, CARD_OFFER, key);
  if (!chosen) return false;
  if (!card) return !cardOffer || !isSent(cardOffer);
  if (!pack || !lossPackRolled(pack.Value)) return true;
  return !isSent(pack);
}

const planetHeaderReady = new WeakSet<LeagueSheet>();

/** Pool Changes including column G. The header is created if that cell is empty. */
async function trkPoolChanges(sheet: LeagueSheet) {
  await ensurePlanetHeader(sheet);
  return await sheet.getPoolChanges(
    "Pool Changes",
    z.object({ "Planet Stationed": z.string().optional() }),
  );
}

async function ensurePlanetHeader(sheet: LeagueSheet): Promise<void> {
  if (planetHeaderReady.has(sheet)) return;
  const data = await sheetsRead(sheets, sheet.sheetId, "Pool Changes!G1");
  const current = data.values?.[0]?.[0];
  if (current === PLANET_COLUMN) {
    planetHeaderReady.add(sheet);
    return;
  }
  if (current !== undefined && `${current}`.trim() !== "") {
    throw new Error(
      `Pool Changes G1 is "${current}", expected ${PLANET_COLUMN}`,
    );
  }
  await sheetsWrite(
    sheets,
    sheet.sheetId,
    "Pool Changes!G1",
    [[PLANET_COLUMN]],
  );
  planetHeaderReady.add(sheet);
}

/** Planet recorded on this loss, from column G or an older planet/station row. */
function chosenPlanet(
  rows: readonly ChangeRow[],
  key: LossKey,
): { planet: Planet; identification: string } | undefined {
  const pack = findChange(rows, LOSS_PACK, key);
  const fromPack = planetByName(`${pack?.["Planet Stationed"] ?? ""}`);
  if (pack && fromPack) {
    return { planet: fromPack, identification: pack.Name };
  }
  const legacy = findChange(rows, "planet", key) ??
    findChange(rows, "station", key);
  const fromLegacy = legacy ? planetByName(legacy.Value) : undefined;
  if (legacy && fromLegacy) {
    return { planet: fromLegacy, identification: legacy.Name };
  }
  return undefined;
}

/**
 * Writes the chosen planet onto the loss pack row. The row is created when
 * the planet is chosen, with Value still `pending`, so the charge exists
 * before the card is granted and before the pack is rolled.
 */
async function recordPlanetChoice(
  sheet: LeagueSheet,
  key: LossKey,
  planetName: string,
): Promise<void> {
  const existing = findChange(
    (await trkPoolChanges(sheet)).rows,
    LOSS_PACK,
    key,
  );
  const pack = existing ?? await appendChange(
    sheet,
    key.identification,
    LOSS_PACK,
    "pending",
    lossLabel(key.loss),
  );
  if (planetByName(`${pack["Planet Stationed"] ?? ""}`)?.name === planetName) {
    return;
  }
  await sheetsWrite(
    sheets,
    sheet.sheetId,
    `Pool Changes!G${pack[ROWNUM]}`,
    [[planetName]],
  );
}

function lossLabel(loss: number): string {
  return `Loss: ${loss}`;
}

function findChange(
  rows: readonly ChangeRow[],
  type: string,
  key: LossKey,
): ChangeRow | undefined {
  return rows.findLast((row) => row.Type === type && rowOnLoss(row, key));
}

function rowOnLoss(
  row: { Type: string; Name: string; Value: string; Comment: string | null },
  key: LossKey,
): boolean {
  const text = row.Type === PLANET_OFFER ? row.Value : (row.Comment ?? "");
  const loss = recordedLoss(text);
  if (loss !== undefined) {
    return loss === key.loss && row.Name === key.identification;
  }
  return trackedMatch(row) === key.matchRow;
}

function trackedMatch(
  row: { Type: string; Value: string; Comment: string | null },
): number | undefined {
  const text = row.Type === PLANET_OFFER ? row.Value : (row.Comment ?? "");
  const found = text.match(/match:(\d+)/);
  return found ? Number(found[1]) : undefined;
}

function isSent(row: ChangeRow): boolean {
  return (row.Comment ?? "").includes(SENT_MARK);
}

function cellIsTrue(value: unknown): boolean {
  return value === true || String(value ?? "").trim().toUpperCase() === "TRUE";
}

function matchCell(row: object, column: string): unknown {
  return (row as Record<string, unknown>)[column];
}

async function markDmSent(
  sheet: LeagueSheet,
  matchRow: number,
): Promise<void> {
  await sheet.updateMatchCell(matchRow, DM_SENT_COLUMN, true);
}

async function dmWasSent(
  sheet: LeagueSheet,
  matchRow: number,
): Promise<boolean> {
  const matches = await sheet.getMatches({ [DM_SENT_COLUMN]: z.unknown() });
  const match = matches.rows.find((row) => row[ROWNUM] === matchRow);
  return cellIsTrue(match ? matchCell(match, DM_SENT_COLUMN) : undefined);
}

interface CountedMatch {
  readonly [ROWNUM]: number;
  readonly Timestamp: number;
  readonly "Loser Name": string;
  readonly "Match Announced": unknown;
}

/** Planet chosen, card granted, and the loss pack rolled. */
function lossSettled(
  rows: readonly ChangeRow[],
  key: LossKey,
): boolean {
  if (!chosenPlanet(rows, key)) return false;
  const card = findChange(rows, ADD_CARD, key);
  const pack = findChange(rows, LOSS_PACK, key);
  return Boolean(card && pack && lossPackRolled(pack.Value));
}

/**
 * The player's earliest loss that still needs a planet or a pack.
 * Later losses wait so each full pool is written onto the latest row.
 */
function earliestOpenLoss(
  matches: readonly CountedMatch[],
  rows: readonly ChangeRow[],
  identification: string,
): number | undefined {
  const ordinals = lossOrdinals(matches);
  const losses = matches.filter((match) => {
    if (match["Loser Name"] !== identification) return false;
    const ordinal = ordinals.get(match[ROWNUM]);
    return ordinal !== undefined && ordinal < CONFIG.MAX_LOSSES;
  });
  losses.sort((a, b) =>
    (ordinals.get(a[ROWNUM]) ?? 0) - (ordinals.get(b[ROWNUM]) ?? 0)
  );
  for (const match of losses) {
    const loss = ordinals.get(match[ROWNUM]);
    if (loss === undefined) continue;
    const key = {
      matchRow: match[ROWNUM],
      identification,
      loss,
    };
    if (!lossSettled(rows, key)) return match[ROWNUM];
  }
  return undefined;
}

async function earlierLossInProgress(
  sheet: LeagueSheet,
  matchRow: number,
): Promise<boolean> {
  const [changes, matches] = await Promise.all([
    trkPoolChanges(sheet),
    sheet.getMatches({ "Match Announced": z.unknown() }),
  ]);
  const key = lossKey(matches.rows, matchRow);
  if (!key) return false;
  const open = earliestOpenLoss(
    matches.rows,
    changes.rows,
    key.identification,
  );
  return open !== undefined && open !== matchRow;
}

function lossKey(
  rows: readonly CountedMatch[],
  matchRow: number,
): LossKey | undefined {
  const match = rows.find((row) => row[ROWNUM] === matchRow);
  const loss = lossOrdinals(rows).get(matchRow);
  if (!match || loss === undefined) return undefined;
  return { matchRow, identification: match["Loser Name"], loss };
}

function matchForLoss(
  rows: readonly CountedMatch[],
  identification: string,
  loss: number,
): number | undefined {
  const ordinals = lossOrdinals(rows);
  for (const row of rows) {
    if (row["Loser Name"] !== identification) continue;
    if (ordinals.get(row[ROWNUM]) === loss) return row[ROWNUM];
  }
  return undefined;
}

function linkedMatch(
  row: ChangeRow,
  matches: readonly CountedMatch[],
): number | undefined {
  const text = row.Type === PLANET_OFFER ? row.Value : (row.Comment ?? "");
  const loss = recordedLoss(text);
  if (loss !== undefined) return matchForLoss(matches, row.Name, loss);
  return trackedMatch(row);
}

function lossOrdinals(
  rows: readonly CountedMatch[],
): Map<number, number> {
  const byLoser = new Map<string, typeof rows[number][]>();
  for (const row of rows) {
    if (!matchOpen(row["Match Announced"])) continue;
    const group = byLoser.get(row["Loser Name"]) ?? [];
    group.push(row);
    byLoser.set(row["Loser Name"], group);
  }
  const ordinals = new Map<number, number>();
  for (const group of byLoser.values()) {
    group.sort((a, b) => a.Timestamp - b.Timestamp || a[ROWNUM] - b[ROWNUM]);
    group.forEach((row, index) => ordinals.set(row[ROWNUM], index + 1));
  }
  return ordinals;
}

function matchOpen(value: unknown): boolean {
  if (
    value === true || value === false || value === undefined ||
    value === null ||
    value === ""
  ) return true;
  return typeof value === "string" && value.trim().toUpperCase() === "TRUE";
}

function parseClick(interaction: djs.Interaction): PlanetClick | undefined {
  if (!interaction.isButton() && !interaction.isStringSelectMenu()) return;
  const id = interaction.customId;
  if (id.startsWith(`${CARD_PREFIX}:`)) {
    const [, matchRow, cardId, discordId] = id.split(":");
    const row = parseRow(matchRow);
    if (row === undefined || !discordId || !/^\d+$/.test(discordId)) return;
    if (!cardId || !CARD_ID.test(cardId)) return;
    return { kind: "card", matchRow: row, discordId, cardId };
  }
  if (id.startsWith(`${PLANET_SUBMIT}:`)) {
    const [, matchRow, discordId, ...planetParts] = id.split(":");
    const row = parseRow(matchRow);
    const planet = planetParts.join(":");
    if (row === undefined || !discordId || !/^\d+$/.test(discordId)) return;
    if (!planetByName(planet)) return;
    return { kind: "planet", matchRow: row, discordId, planet };
  }
  if (id.startsWith(`${PLANET_PREFIX}:`)) {
    const [, matchRow, discordId] = id.split(":");
    const row = parseRow(matchRow);
    if (row === undefined || !discordId || !/^\d+$/.test(discordId)) return;
    return { kind: "preview", matchRow: row, discordId };
  }
  return undefined;
}

function parseRow(value: string | undefined): number | undefined {
  if (!value || !/^\d+$/.test(value)) return undefined;
  const row = Number(value);
  return Number.isSafeInteger(row) ? row : undefined;
}
