// CYOA event data - converted from JSON structure
import { Event } from "./cyoa_types.ts";

// OnLoss Events
export const onLossEvents: Event[] = [
  {
    mainText: "Welcome to Ravnica! You have arrived in the city of guilds. Which guild will you join?",
    id: "start_event",
    options: [
      {
        requiredSelections: [],
        optionLabel: "Join the Simic Combine",
        postSelectionText: "The Simic welcome you with an excess of open arms and grant you tokens of membership.",
        rewards: [
          { count: "PACK", sets: ["RNA"] },
          { count: 3, query: "https://scryfall.com/search?q=game%3Aarena+r%3Dc+%28set%3Arna+or+set%3Agrn%29+wm%3Asimic+-t%3Aland&unique=cards&as=grid&order=name" },
          { count: 1, query: "https://scryfall.com/search?q=game%3Aarena+r%3Du+%28set%3Arna+or+set%3Agrn%29+wm%3Asimic&unique=cards&as=grid&order=name" },
          { count: 2, query: "https://scryfall.com/card/rna/257/simic-guildgate" },
          { count: 1, query: "https://scryfall.com/card/aa1/12/simic-signet" },
        ],
        nextEvent: "JOIN_GUILD.SIMIC",
      },
      {
        requiredSelections: [],
        optionLabel: "Join the Azorius Senate",
        postSelectionText: "After substantial deliberation, the Azorius accept your application for membership and grant you tokens of membership.",
        rewards: [
          { count: "PACK", sets: ["RNA"] },
          { count: 3, query: "https://scryfall.com/search?q=game%3Aarena+r%3Dc+%28set%3Arna+or+set%3Agrn%29+wm%3Aazorius+-t%3Aland&unique=cards&as=grid&order=name" },
          { count: 1, query: "https://scryfall.com/search?q=game%3Aarena+r%3Du+%28set%3Arna+or+set%3Agrn%29+wm%3Aazorius&unique=cards&as=grid&order=name" },
          { count: 2, query: "https://scryfall.com/card/rna/243/azorius-guildgate" },
          { count: 1, query: "https://scryfall.com/card/aa1/1/azorius-signet" },
        ],
        nextEvent: "JOIN_GUILD.AZORIUS",
      },
      {
        requiredSelections: [],
        optionLabel: "Join the Izzet League",
        postSelectionText: "The Izzet decide to let you join, just to see what will happen. They grant you tokens of membership.",
        rewards: [
          { count: "PACK", sets: ["GRN"] },
          { count: 3, query: "https://scryfall.com/search?q=game%3Aarena+r%3Dc+%28set%3Arna+or+set%3Agrn%29+wm%3Aizzet+-t%3Aland&unique=cards&as=grid&order=name" },
          { count: 1, query: "https://scryfall.com/search?q=game%3Aarena+r%3Du+%28set%3Arna+or+set%3Agrn%29+wm%3Aizzet&unique=cards&as=grid&order=name" },
          { count: 2, query: "https://scryfall.com/card/grn/251/izzet-guildgate" },
          { count: 1, query: "https://scryfall.com/card/aa1/8/izzet-signet" },
        ],
        nextEvent: "JOIN_GUILD.IZZET",
      },
      {
        requiredSelections: [],
        optionLabel: "Join House Dimir",
        postSelectionText: "You search fruitlessly for any sign of the Dimir and ultimately give up in frustration. The next morning, you wake up to find an envelope placed on the table next to where you were sleeping, containing tokens of membership.",
        rewards: [
          { count: "PACK", sets: ["GRN"] },
          { count: 3, query: "https://scryfall.com/search?q=game%3Aarena+r%3Dc+%28set%3Arna+or+set%3Agrn%29+wm%3Adimir+-t%3Aland&unique=cards&as=grid&order=name" },
          { count: 1, query: "https://scryfall.com/search?q=game%3Aarena+r%3Du+%28set%3Arna+or+set%3Agrn%29+wm%3Adimir&unique=cards&as=grid&order=name" },
          { count: 2, query: "https://scryfall.com/card/grn/245/dimir-guildgate" },
          { count: 1, query: "https://scryfall.com/card/aa1/5/dimir-signet" },
        ],
        nextEvent: "JOIN_GUILD.DIMIR",
      },
      {
        requiredSelections: [],
        optionLabel: "Join the Gruul Clans",
        postSelectionText: "The Gruul are confused at first, but a couple of bonked heads later they get the idea, and grant you tokens of membership.",
        rewards: [
          { count: "PACK", sets: ["RNA"] },
          { count: 3, query: "https://scryfall.com/search?q=game%3Aarena+r%3Dc+%28set%3Arna+or+set%3Agrn%29+wm%3Agruul+-t%3Aland&unique=cards&as=grid&order=name" },
          { count: 1, query: "https://scryfall.com/search?q=game%3Aarena+r%3Du+%28set%3Arna+or+set%3Agrn%29+wm%3Agruul&unique=cards&as=grid&order=name" },
          { count: 2, query: "https://scryfall.com/card/rna/249/gruul-guildgate" },
          { count: 1, query: "https://scryfall.com/card/aa1/7/gruul-signet" },
        ],
        nextEvent: "JOIN_GUILD.GRUUL",
      },
      {
        requiredSelections: [],
        optionLabel: "Join the Golgari Swarm",
        postSelectionText: "The Golgari welcome you back to join them once again. You're not sure what they mean by this, and you find the way they're looking at you to be a little unsettling. They grant you tokens of membership.",
        rewards: [
          { count: "PACK", sets: ["GRN"] },
          { count: 3, query: "https://scryfall.com/search?q=game%3Aarena+r%3Dc+%28set%3Arna+or+set%3Agrn%29+wm%3Agolgari+-t%3Aland&unique=cards&as=grid&order=name" },
          { count: 1, query: "https://scryfall.com/search?q=game%3Aarena+r%3Du+%28set%3Arna+or+set%3Agrn%29+wm%3Agolgari&unique=cards&as=grid&order=name" },
          { count: 2, query: "https://scryfall.com/card/grn/248/golgari-guildgate" },
          { count: 1, query: "https://scryfall.com/card/aa1/6/golgari-signet" },
        ],
        nextEvent: "JOIN_GUILD.GOLGARI",
      },
      {
        requiredSelections: [],
        optionLabel: "Join the Selesnya Conclave",
        postSelectionText: "You lift your voice in song, and the Selesnya welcome you to join their chorus. They grant you tokens of membership.",
        rewards: [
          { count: "PACK", sets: ["GRN"] },
          { count: 3, query: "https://scryfall.com/search?q=game%3Aarena+r%3Dc+%28set%3Arna+or+set%3Agrn%29+wm%3Aselesnya+-t%3Aland&unique=cards&as=grid&order=name" },
          { count: 1, query: "https://scryfall.com/search?q=game%3Aarena+r%3Du+%28set%3Arna+or+set%3Agrn%29+wm%3Aselesnya&unique=cards&as=grid&order=name" },
          { count: 2, query: "https://scryfall.com/card/grn/255/selesnya-guildgate" },
          { count: 1, query: "https://scryfall.com/card/aa1/11/selesnya-signet" },
        ],
        nextEvent: "JOIN_GUILD.SELESNYA",
      },
      {
        requiredSelections: [],
        optionLabel: "Join the Boros Legion",
        postSelectionText: "The Boros welcome you as a new recruit, and issue you the standard tokens of membership.",
        rewards: [
          { count: "PACK", sets: ["GRN"] },
          { count: 3, query: "https://scryfall.com/search?q=game%3Aarena+r%3Dc+%28set%3Arna+or+set%3Agrn%29+wm%3Aboros+-t%3Aland&unique=cards&as=grid&order=name" },
          { count: 1, query: "https://scryfall.com/search?q=game%3Aarena+r%3Du+%28set%3Arna+or+set%3Agrn%29+wm%3Aboros&unique=cards&as=grid&order=name" },
          { count: 2, query: "https://scryfall.com/card/grn/243/boros-guildgate" },
          { count: 1, query: "https://scryfall.com/card/aa1/2/boros-signet" },
        ],
        nextEvent: "JOIN_GUILD.BOROS",
      },
      {
        requiredSelections: [],
        optionLabel: "Join the Cult of Rakdos",
        postSelectionText: "After an evening best forgotten, the cult of Rakdos accepts you as a new initiate and grants you tokens of membership.",
        rewards: [
          { count: "PACK", sets: ["RNA"] },
          { count: 3, query: "https://scryfall.com/search?q=game%3Aarena+r%3Dc+%28set%3Arna+or+set%3Agrn%29+wm%3Arakdos+-t%3Aland&unique=cards&as=grid&order=name" },
          { count: 1, query: "https://scryfall.com/search?q=game%3Aarena+r%3Du+%28set%3Arna+or+set%3Agrn%29+wm%3Arakdos&unique=cards&as=grid&order=name" },
          { count: 2, query: "https://scryfall.com/card/rna/255/rakdos-guildgate" },
          { count: 1, query: "https://scryfall.com/card/aa1/10/rakdos-signet" },
        ],
        nextEvent: "JOIN_GUILD.RAKDOS",
      },
      {
        requiredSelections: [],
        optionLabel: "Join the Orzhov Syndicate",
        postSelectionText: "You pledge yourself body and soul, to the Orzhov syndicate. In exchange, they grant you tokens of membership.",
        rewards: [
          { count: "PACK", sets: ["RNA"] },
          { count: 3, query: "https://scryfall.com/search?q=game%3Aarena+r%3Dc+%28set%3Arna+or+set%3Agrn%29+wm%3Aorzhov+-t%3Aland&unique=cards&as=grid&order=name" },
          { count: 1, query: "https://scryfall.com/search?q=game%3Aarena+r%3Du+%28set%3Arna+or+set%3Agrn%29+wm%3Aorzhov&unique=cards&as=grid&order=name" },
          { count: 2, query: "https://scryfall.com/card/rna/252/orzhov-guildgate" },
          { count: 1, query: "https://scryfall.com/card/aa1/9/orzhov-signet" },
        ],
        nextEvent: "JOIN_GUILD.ORZHOV",
      },
    ],
  },
  {
    mainText: "",
    id: "JOIN_GUILD.SIMIC",
    options: [
      {
        requiredSelections: [],
        optionLabel: "TEMP_LOYAL",
        postSelectionText: "",
        rewards: [
          { count: "PACK", sets: ["RNA"] },
          { count: 1, query: "https://scryfall.com/card/rna/214/zegana-utopian-speaker" },
        ],
        nextEvent: "MORAL_CHOICE.LOYAL",
      },
      {
        requiredSelections: [],
        optionLabel: "TEMP_BETRAY",
        postSelectionText: "",
        rewards: [
          { count: "PACK", sets: ["RNA", "GRN"] },
          { count: 2, query: "https://scryfall.com/search?q=%28type%3Alegendary%29+%28set%3Arna+OR+set%3Agrn%29+rarity%3Ar&unique=cards&as=grid&order=name" },
        ],
        nextEvent: "MORAL_CHOICE.BETRAY",
      },
    ],
  },
  {
    mainText: "",
    id: "JOIN_GUILD.AZORIUS",
    options: [
      {
        requiredSelections: [],
        optionLabel: "TEMP_LOYAL",
        postSelectionText: "",
        rewards: [
          { count: "PACK", sets: ["RNA"] },
          { count: 1, query: "https://scryfall.com/card/rna/189/lavinia-azorius-renegade" },
        ],
        nextEvent: "MORAL_CHOICE.LOYAL",
      },
      {
        requiredSelections: [],
        optionLabel: "TEMP_BETRAY",
        postSelectionText: "",
        rewards: [
          { count: "PACK", sets: ["RNA", "GRN"] },
          { count: 2, query: "https://scryfall.com/search?q=%28type%3Alegendary%29+%28set%3Arna+OR+set%3Agrn%29+rarity%3Ar&unique=cards&as=grid&order=name" },
        ],
        nextEvent: "MORAL_CHOICE.BETRAY",
      },
    ],
  },
  {
    mainText: "",
    id: "JOIN_GUILD.IZZET",
    options: [
      {
        requiredSelections: [],
        optionLabel: "TEMP_LOYAL",
        postSelectionText: "",
        rewards: [
          { count: "PACK", sets: ["GRN"] },
          { count: 1, query: "https://scryfall.com/card/grn/192/niv-mizzet-parun" },
        ],
        nextEvent: "MORAL_CHOICE.LOYAL",
      },
      {
        requiredSelections: [],
        optionLabel: "TEMP_BETRAY",
        postSelectionText: "",
        rewards: [
          { count: "PACK", sets: ["RNA", "GRN"] },
          { count: 2, query: "https://scryfall.com/search?q=%28type%3Alegendary%29+%28set%3Arna+OR+set%3Agrn%29+rarity%3Ar&unique=cards&as=grid&order=name" },
        ],
        nextEvent: "MORAL_CHOICE.BETRAY",
      },
    ],
  },
  {
    mainText: "",
    id: "JOIN_GUILD.DIMIR",
    options: [
      {
        requiredSelections: [],
        optionLabel: "TEMP_LOYAL",
        postSelectionText: "",
        rewards: [
          { count: "PACK", sets: ["GRN"] },
          { count: 1, query: "https://scryfall.com/card/grn/170/etrata-the-silencer" },
        ],
        nextEvent: "MORAL_CHOICE.LOYAL",
      },
      {
        requiredSelections: [],
        optionLabel: "TEMP_BETRAY",
        postSelectionText: "",
        rewards: [
          { count: "PACK", sets: ["RNA", "GRN"] },
          { count: 2, query: "https://scryfall.com/search?q=%28type%3Alegendary%29+%28set%3Arna+OR+set%3Agrn%29+rarity%3Ar&unique=cards&as=grid&order=name" },
        ],
        nextEvent: "MORAL_CHOICE.BETRAY",
      },
    ],
  },
  {
    mainText: "",
    id: "JOIN_GUILD.GRUUL",
    options: [
      {
        requiredSelections: [],
        optionLabel: "TEMP_LOYAL",
        postSelectionText: "",
        rewards: [
          { count: "PACK", sets: ["RNA"] },
          { count: 1, query: "https://scryfall.com/card/rna/193/nikya-of-the-old-ways" },
        ],
        nextEvent: "MORAL_CHOICE.LOYAL",
      },
      {
        requiredSelections: [],
        optionLabel: "TEMP_BETRAY",
        postSelectionText: "",
        rewards: [
          { count: "PACK", sets: ["RNA", "GRN"] },
          { count: 2, query: "https://scryfall.com/search?q=%28type%3Alegendary%29+%28set%3Arna+OR+set%3Agrn%29+rarity%3Ar&unique=cards&as=grid&order=name" },
        ],
        nextEvent: "MORAL_CHOICE.BETRAY",
      },
    ],
  },
  {
    mainText: "",
    id: "JOIN_GUILD.GOLGARI",
    options: [
      {
        requiredSelections: [],
        optionLabel: "TEMP_LOYAL",
        postSelectionText: "",
        rewards: [
          { count: "PACK", sets: ["GRN"] },
          { count: 1, query: "https://scryfall.com/card/grn/180/izoni-thousand-eyed" },
        ],
        nextEvent: "MORAL_CHOICE.LOYAL",
      },
      {
        requiredSelections: [],
        optionLabel: "TEMP_BETRAY",
        postSelectionText: "",
        rewards: [
          { count: "PACK", sets: ["RNA", "GRN"] },
          { count: 2, query: "https://scryfall.com/search?q=%28type%3Alegendary%29+%28set%3Arna+OR+set%3Agrn%29+rarity%3Ar&unique=cards&as=grid&order=name" },
        ],
        nextEvent: "MORAL_CHOICE.BETRAY",
      },
    ],
  },
  {
    mainText: "",
    id: "JOIN_GUILD.SELESNYA",
    options: [
      {
        requiredSelections: [],
        optionLabel: "TEMP_LOYAL",
        postSelectionText: "",
        rewards: [
          { count: "PACK", sets: ["GRN"] },
          { count: 1, query: "https://scryfall.com/card/grn/168/emmara-soul-of-the-accord" },
        ],
        nextEvent: "MORAL_CHOICE.LOYAL",
      },
      {
        requiredSelections: [],
        optionLabel: "TEMP_BETRAY",
        postSelectionText: "",
        rewards: [
          { count: "PACK", sets: ["RNA", "GRN"] },
          { count: 2, query: "https://scryfall.com/search?q=%28type%3Alegendary%29+%28set%3Arna+OR+set%3Agrn%29+rarity%3Ar&unique=cards&as=grid&order=name" },
        ],
        nextEvent: "MORAL_CHOICE.BETRAY",
      },
    ],
  },
  {
    mainText: "",
    id: "JOIN_GUILD.BOROS",
    options: [
      {
        requiredSelections: [],
        optionLabel: "TEMP_LOYAL",
        postSelectionText: "",
        rewards: [
          { count: "PACK", sets: ["GRN"] },
          { count: 1, query: "https://scryfall.com/card/grn/204/tajic-legions-edge" },
        ],
        nextEvent: "MORAL_CHOICE.LOYAL",
      },
      {
        requiredSelections: [],
        optionLabel: "TEMP_BETRAY",
        postSelectionText: "",
        rewards: [
          { count: "PACK", sets: ["RNA", "GRN"] },
          { count: 2, query: "https://scryfall.com/search?q=%28type%3Alegendary%29+%28set%3Arna+OR+set%3Agrn%29+rarity%3Ar&unique=cards&as=grid&order=name" },
        ],
        nextEvent: "MORAL_CHOICE.BETRAY",
      },
    ],
  },
  {
    mainText: "",
    id: "JOIN_GUILD.RAKDOS",
    options: [
      {
        requiredSelections: [],
        optionLabel: "TEMP_LOYAL",
        postSelectionText: "",
        rewards: [
          { count: "PACK", sets: ["RNA"] },
          { count: 1, query: "https://scryfall.com/card/rna/185/judith-the-scourge-diva" },
        ],
        nextEvent: "MORAL_CHOICE.LOYAL",
      },
      {
        requiredSelections: [],
        optionLabel: "TEMP_BETRAY",
        postSelectionText: "",
        rewards: [
          { count: "PACK", sets: ["RNA", "GRN"] },
          { count: 2, query: "https://scryfall.com/search?q=%28type%3Alegendary%29+%28set%3Arna+OR+set%3Agrn%29+rarity%3Ar&unique=cards&as=grid&order=name" },
        ],
        nextEvent: "MORAL_CHOICE.BETRAY",
      },
    ],
  },
  {
    mainText: "",
    id: "JOIN_GUILD.ORZHOV",
    options: [
      {
        requiredSelections: [],
        optionLabel: "TEMP_LOYAL",
        postSelectionText: "",
        rewards: [
          { count: "PACK", sets: ["RNA"] },
          { count: 1, query: "https://scryfall.com/card/rna/212/teysa-karlov" },
        ],
        nextEvent: "MORAL_CHOICE.LOYAL",
      },
      {
        requiredSelections: [],
        optionLabel: "TEMP_BETRAY",
        postSelectionText: "",
        rewards: [
          { count: "PACK", sets: ["RNA", "GRN"] },
          { count: 2, query: "https://scryfall.com/search?q=%28type%3Alegendary%29+%28set%3Arna+OR+set%3Agrn%29+rarity%3Ar&unique=cards&as=grid&order=name" },
        ],
        nextEvent: "MORAL_CHOICE.BETRAY",
      },
    ],
  },
  {
    mainText: "",
    id: "MORAL_CHOICE.LOYAL",
    options: [
      {
        requiredSelections: [],
        optionLabel: "TEMP_HELP_NOW",
        postSelectionText: "",
        rewards: [],
        nextEvent: "WAR_START.LOYAL_PRESENT",
      },
      {
        requiredSelections: [],
        optionLabel: "TEMP_HELP_THE_FUTURE",
        postSelectionText: "",
        rewards: [
          { count: "PACK", sets: ["RNA", "GRN"] },
        ],
        nextEvent: "WAR_START.LOYAL_FUTURE",
      },
    ],
  },
  {
    mainText: "",
    id: "MORAL_CHOICE.BETRAY",
    options: [
      {
        requiredSelections: [],
        optionLabel: "TEMP_BETRAY_BOLAS",
        postSelectionText: "",
        rewards: [
          { count: 1, query: "https://scryfall.com/card/war/237/firemind-vessel" },
        ],
        nextEvent: "WAR_START.BETRAY_PRESENT",
      },
      {
        requiredSelections: [],
        optionLabel: "TEMP_LOYAL_TO_BOLAS",
        postSelectionText: "",
        rewards: [
          { count: "PACK", sets: ["RNA", "GRN"] },
        ],
        nextEvent: "WAR_START.BETRAY_FUTURE",
      },
    ],
  },
  {
    mainText: "",
    id: "WAR_START.LOYAL_PRESENT",
    options: [
      {
        requiredSelections: [],
        optionLabel: "→",
        postSelectionText: "",
        rewards: [
          { count: "PACK", sets: ["RNA", "GRN"] },
          { count: 1, query: "https://scryfall.com/search?q=%28type%3Alegendary%29+%28game%3Apaper%29+%28set%3Arna+OR+set%3Agrn%29+rarity%3Am+prefer%3Abest+is%3Abooster&unique=cards&as=grid&order=name" },
          { count: 1, query: "https://scryfall.com/card/war/249/mobilized-district" },
          { count: 1, query: "https://scryfall.com/card/war/6/bond-of-discipline" },
          { count: 1, query: "https://scryfall.com/card/war/155/bond-of-flourishing" },
          { count: 1, query: "https://scryfall.com/card/war/43/bond-of-insight" },
          { count: 1, query: "https://scryfall.com/card/war/116/bond-of-passion" },
          { count: 1, query: "https://scryfall.com/card/war/80/bond-of-revival" },
        ],
        nextEvent: "WAR_END.LOYAL_PRESENT",
      },
    ],
  },
  {
    mainText: "",
    id: "WAR_START.LOYAL_FUTURE",
    options: [
      {
        requiredSelections: [],
        optionLabel: "→",
        postSelectionText: "",
        rewards: [
          { count: "PACK", sets: ["RNA", "GRN"] },
          { count: 1, query: "https://scryfall.com/search?q=%28type%3Alegendary%29+%28game%3Apaper%29+%28set%3Arna+OR+set%3Agrn%29+rarity%3Am+prefer%3Abest+is%3Abooster&unique=cards&as=grid&order=name" },
          { count: 1, query: "https://scryfall.com/card/war/249/mobilized-district" },
          { count: 1, query: "https://scryfall.com/card/war/6/bond-of-discipline" },
          { count: 1, query: "https://scryfall.com/card/war/155/bond-of-flourishing" },
          { count: 1, query: "https://scryfall.com/card/war/43/bond-of-insight" },
          { count: 1, query: "https://scryfall.com/card/war/116/bond-of-passion" },
          { count: 1, query: "https://scryfall.com/card/war/80/bond-of-revival" },
        ],
        nextEvent: "WAR_END.LOYAL_FUTURE",
      },
    ],
  },
  {
    mainText: "",
    id: "WAR_START.BETRAY_PRESENT",
    options: [
      {
        requiredSelections: [],
        optionLabel: "→",
        postSelectionText: "",
        rewards: [
          { count: "PACK", sets: ["WAR"] },
          { count: 1, query: "https://scryfall.com/card/war/85/deliver-unto-evil" },
          { count: 1, query: "https://scryfall.com/search?q=r%3Ar+set%3Awar+is%3Abooster+%28t%3Azombie+or+o%3Aamass%29&unique=cards&as=grid&order=rarity" },
          { count: 2, query: "https://scryfall.com/search?q=r%3Au+set%3Awar+is%3Abooster+%28t%3Azombie+or+o%3Aamass%29&unique=cards&as=grid&order=rarity" },
          { count: 3, query: "https://scryfall.com/search?q=r%3Ac+set%3Awar+is%3Abooster+%28t%3Azombie+or+o%3Aamass%29&unique=cards&as=grid&order=rarity" },
        ],
        nextEvent: "WAR_END.BETRAY_PRESENT",
      },
    ],
  },
  {
    mainText: "",
    id: "WAR_START.BETRAY_FUTURE",
    options: [
      {
        requiredSelections: [],
        optionLabel: "→",
        postSelectionText: "",
        rewards: [
          { count: "PACK", sets: ["WAR"] },
          { count: 1, query: "https://scryfall.com/card/war/85/deliver-unto-evil" },
          { count: 1, query: "https://scryfall.com/search?q=r%3Ar+set%3Awar+is%3Abooster+%28t%3Azombie+or+o%3Aamass%29&unique=cards&as=grid&order=rarity" },
          { count: 2, query: "https://scryfall.com/search?q=r%3Au+set%3Awar+is%3Abooster+%28t%3Azombie+or+o%3Aamass%29&unique=cards&as=grid&order=rarity" },
          { count: 3, query: "https://scryfall.com/search?q=r%3Ac+set%3Awar+is%3Abooster+%28t%3Azombie+or+o%3Aamass%29&unique=cards&as=grid&order=rarity" },
        ],
        nextEvent: "WAR_END.BETRAY_FUTURE",
      },
    ],
  },
  {
    mainText: "",
    id: "WAR_END.LOYAL_PRESENT",
    options: [
      {
        requiredSelections: [],
        optionLabel: "→",
        postSelectionText: "",
        rewards: [
          { count: "PACK", sets: ["WAR"] },
          { count: 1, query: "https://scryfall.com/card/war/244/blast-zone" },
          { count: 1, query: "https://scryfall.com/search?q=set%3Awar+is%3Abooster+t%3Aplaneswalker+-t%3Abolas+r%3Ar&unique=cards&as=grid&order=rarity" },
          { count: 2, query: "https://scryfall.com/search?q=set%3Awar+is%3Abooster+t%3Aplaneswalker+-t%3Abolas+r%3Au&unique=cards&as=grid&order=rarity" },
        ],
        nextEvent: "",
      },
    ],
  },
  {
    mainText: "",
    id: "WAR_END.LOYAL_FUTURE",
    options: [
      {
        requiredSelections: [],
        optionLabel: "→",
        postSelectionText: "",
        rewards: [
          { count: "PACK", sets: ["WAR"] },
          { count: 1, query: "https://scryfall.com/card/war/121/chandras-triumph" },
          { count: 1, query: "https://scryfall.com/card/war/15/gideons-triumph" },
          { count: 1, query: "https://scryfall.com/card/war/55/jaces-triumph" },
          { count: 1, query: "https://scryfall.com/card/war/98/lilianas-triumph" },
          { count: 1, query: "https://scryfall.com/card/war/170/nissas-triumph" },
          { count: 2, query: "https://scryfall.com/search?q=set%3Awar+is%3Abooster+t%3Aplaneswalker+-t%3Abolas+r%3Ar&unique=cards&as=grid&order=rarity" },
          { count: 4, query: "https://scryfall.com/search?q=set%3Awar+is%3Abooster+t%3Aplaneswalker+-t%3Abolas+r%3Au&unique=cards&as=grid&order=rarity" },
        ],
        nextEvent: "",
      },
    ],
  },
  {
    mainText: "",
    id: "WAR_END.BETRAY_PRESENT",
    options: [
      {
        requiredSelections: [],
        optionLabel: "→",
        postSelectionText: "",
        rewards: [
          { count: "PACK", sets: ["WAR"] },
          { count: 1, query: "https://scryfall.com/card/war/208/niv-mizzet-reborn" },
        ],
        nextEvent: "",
      },
    ],
  },
  {
    mainText: "",
    id: "WAR_END.BETRAY_FUTURE",
    options: [
      {
        requiredSelections: [],
        optionLabel: "→",
        postSelectionText: "",
        rewards: [
          { count: "PACK", sets: ["WAR"] },
          { count: 1, query: "https://scryfall.com/card/war/238/god-pharaohs-statue" },
          { count: 1, query: "https://scryfall.com/search?q=set%3Awar+is%3Abooster+t%3Agod+t%3Azombie&unique=cards&as=grid&order=rarity" },
          { count: 1, query: "https://scryfall.com/search?q=set%3Awar+is%3Abooster+finale&unique=cards&as=grid&order=rarity" },
        ],
        nextEvent: "",
      },
    ],
  },
];

// OnWin Events
export const onWinEvents: Event[] = [
  {
    mainText: "",
    id: "ON_WIN_EVENTS.SIMIC_BONUS",
    options: [
      {
        requiredSelections: ["JOIN_GUILD.SIMIC"],
        optionLabel: "→",
        postSelectionText: "",
        rewards: [
          { count: 1, query: "https://scryfall.com/search?q=wm%3Asimic+%28set%3Arna+or+set%3A+grn%29+r%3Cr+t%3Acreature&unique=cards&as=grid&order=name" },
          { count: 1, query: "https://scryfall.com/search?q=wm%3Asimic+%28set%3Arna+or+set%3A+grn%29+r%3Cr+-t%3Acreature&unique=cards&as=grid&order=name" },
        ],
        nextEvent: "",
      },
      {
        requiredSelections: [],
        optionLabel: "TEMP_NONCREATURE",
        postSelectionText: "",
        rewards: [
          { count: 1, query: "https://scryfall.com/search?q=wm%3Asimic+%28set%3Arna+or+set%3A+grn%29+r%3Cr+-t%3Acreature&unique=cards&as=grid&order=name" },
        ],
        nextEvent: "",
      },
      {
        requiredSelections: [],
        optionLabel: "TEMP_CREATURE",
        postSelectionText: "",
        rewards: [
          { count: 1, query: "https://scryfall.com/search?q=wm%3Asimic+%28set%3Arna+or+set%3A+grn%29+r%3Cr+-t%3Acreature&unique=cards&as=grid&order=name" },
        ],
        nextEvent: "",
      },
    ],
  },
  {
    mainText: "",
    id: "ON_WIN_EVENTS.AZORIUS_BONUS",
    options: [
      {
        requiredSelections: ["JOIN_GUILD.AZORIUS"],
        optionLabel: "→",
        postSelectionText: "",
        rewards: [
          { count: 1, query: "https://scryfall.com/search?q=wm%3Aazorius+%28set%3Arna+or+set%3A+grn%29+r%3Cr+t%3Acreature&unique=cards&as=grid&order=name" },
          { count: 1, query: "https://scryfall.com/search?q=wm%3Aazorius+%28set%3Arna+or+set%3A+grn%29+r%3Cr+-t%3Acreature&unique=cards&as=grid&order=name" },
        ],
        nextEvent: "",
      },
      {
        requiredSelections: [],
        optionLabel: "TEMP_NONCREATURE",
        postSelectionText: "",
        rewards: [
          { count: 1, query: "https://scryfall.com/search?q=wm%3Aazorius+%28set%3Arna+or+set%3A+grn%29+r%3Cr+-t%3Acreature&unique=cards&as=grid&order=name" },
        ],
        nextEvent: "",
      },
      {
        requiredSelections: [],
        optionLabel: "TEMP_CREATURE",
        postSelectionText: "",
        rewards: [
          { count: 1, query: "https://scryfall.com/search?q=wm%3Aazorius+%28set%3Arna+or+set%3A+grn%29+r%3Cr+-t%3Acreature&unique=cards&as=grid&order=name" },
        ],
        nextEvent: "",
      },
    ],
  },
  {
    mainText: "",
    id: "ON_WIN_EVENTS.IZZET_BONUS",
    options: [
      {
        requiredSelections: ["JOIN_GUILD.IZZET"],
        optionLabel: "→",
        postSelectionText: "",
        rewards: [
          { count: 1, query: "https://scryfall.com/search?q=wm%3AIZZET+%28set%3Arna+or+set%3A+grn%29+r%3Cr+t%3Acreature&unique=cards&as=grid&order=name" },
          { count: 1, query: "https://scryfall.com/search?q=wm%3AIZZET+%28set%3Arna+or+set%3A+grn%29+r%3Cr+-t%3Acreature&unique=cards&as=grid&order=name" },
        ],
        nextEvent: "",
      },
      {
        requiredSelections: [],
        optionLabel: "TEMP_NONCREATURE",
        postSelectionText: "",
        rewards: [
          { count: 1, query: "https://scryfall.com/search?q=wm%3AIZZET+%28set%3Arna+or+set%3A+grn%29+r%3Cr+-t%3Acreature&unique=cards&as=grid&order=name" },
        ],
        nextEvent: "",
      },
      {
        requiredSelections: [],
        optionLabel: "TEMP_CREATURE",
        postSelectionText: "",
        rewards: [
          { count: 1, query: "https://scryfall.com/search?q=wm%3AIZZET+%28set%3Arna+or+set%3A+grn%29+r%3Cr+-t%3Acreature&unique=cards&as=grid&order=name" },
        ],
        nextEvent: "",
      },
    ],
  },
  {
    mainText: "",
    id: "ON_WIN_EVENTS.DIMIR_BONUS",
    options: [
      {
        requiredSelections: ["JOIN_GUILD.DIMIR"],
        optionLabel: "→",
        postSelectionText: "",
        rewards: [
          { count: 1, query: "https://scryfall.com/search?q=wm%3ADIMIR+%28set%3Arna+or+set%3A+grn%29+r%3Cr+t%3Acreature&unique=cards&as=grid&order=name" },
          { count: 1, query: "https://scryfall.com/search?q=wm%3ADIMIR+%28set%3Arna+or+set%3A+grn%29+r%3Cr+-t%3Acreature&unique=cards&as=grid&order=name" },
        ],
        nextEvent: "",
      },
      {
        requiredSelections: [],
        optionLabel: "TEMP_NONCREATURE",
        postSelectionText: "",
        rewards: [
          { count: 1, query: "https://scryfall.com/search?q=wm%3ADIMIR+%28set%3Arna+or+set%3A+grn%29+r%3Cr+-t%3Acreature&unique=cards&as=grid&order=name" },
        ],
        nextEvent: "",
      },
      {
        requiredSelections: [],
        optionLabel: "TEMP_CREATURE",
        postSelectionText: "",
        rewards: [
          { count: 1, query: "https://scryfall.com/search?q=wm%3ADIMIR+%28set%3Arna+or+set%3A+grn%29+r%3Cr+-t%3Acreature&unique=cards&as=grid&order=name" },
        ],
        nextEvent: "",
      },
    ],
  },
  {
    mainText: "",
    id: "ON_WIN_EVENTS.GRUUL_BONUS",
    options: [
      {
        requiredSelections: ["JOIN_GUILD.GRUUL"],
        optionLabel: "→",
        postSelectionText: "",
        rewards: [
          { count: 1, query: "https://scryfall.com/search?q=wm%3AGRUUL+%28set%3Arna+or+set%3A+grn%29+r%3Cr+t%3Acreature&unique=cards&as=grid&order=name" },
          { count: 1, query: "https://scryfall.com/search?q=wm%3AGRUUL+%28set%3Arna+or+set%3A+grn%29+r%3Cr+-t%3Acreature&unique=cards&as=grid&order=name" },
        ],
        nextEvent: "",
      },
      {
        requiredSelections: [],
        optionLabel: "TEMP_NONCREATURE",
        postSelectionText: "",
        rewards: [
          { count: 1, query: "https://scryfall.com/search?q=wm%3AGRUUL+%28set%3Arna+or+set%3A+grn%29+r%3Cr+-t%3Acreature&unique=cards&as=grid&order=name" },
        ],
        nextEvent: "",
      },
      {
        requiredSelections: [],
        optionLabel: "TEMP_CREATURE",
        postSelectionText: "",
        rewards: [
          { count: 1, query: "https://scryfall.com/search?q=wm%3AGRUUL+%28set%3Arna+or+set%3A+grn%29+r%3Cr+-t%3Acreature&unique=cards&as=grid&order=name" },
        ],
        nextEvent: "",
      },
    ],
  },
  {
    mainText: "",
    id: "ON_WIN_EVENTS.GOLGARI_BONUS",
    options: [
      {
        requiredSelections: ["JOIN_GUILD.GOLGARI"],
        optionLabel: "→",
        postSelectionText: "",
        rewards: [
          { count: 1, query: "https://scryfall.com/search?q=wm%3AGOLGARI+%28set%3Arna+or+set%3A+grn%29+r%3Cr+t%3Acreature&unique=cards&as=grid&order=name" },
          { count: 1, query: "https://scryfall.com/search?q=wm%3AGOLGARI+%28set%3Arna+or+set%3A+grn%29+r%3Cr+-t%3Acreature&unique=cards&as=grid&order=name" },
        ],
        nextEvent: "",
      },
      {
        requiredSelections: [],
        optionLabel: "TEMP_NONCREATURE",
        postSelectionText: "",
        rewards: [
          { count: 1, query: "https://scryfall.com/search?q=wm%3AGOLGARI+%28set%3Arna+or+set%3A+grn%29+r%3Cr+-t%3Acreature&unique=cards&as=grid&order=name" },
        ],
        nextEvent: "",
      },
      {
        requiredSelections: [],
        optionLabel: "TEMP_CREATURE",
        postSelectionText: "",
        rewards: [
          { count: 1, query: "https://scryfall.com/search?q=wm%3AGOLGARI+%28set%3Arna+or+set%3A+grn%29+r%3Cr+-t%3Acreature&unique=cards&as=grid&order=name" },
        ],
        nextEvent: "",
      },
    ],
  },
  {
    mainText: "",
    id: "ON_WIN_EVENTS.SELESNYA_BONUS",
    options: [
      {
        requiredSelections: ["JOIN_GUILD.SELESNYA"],
        optionLabel: "→",
        postSelectionText: "",
        rewards: [
          { count: 1, query: "https://scryfall.com/search?q=wm%3ASELESNYA+%28set%3Arna+or+set%3A+grn%29+r%3Cr+t%3Acreature&unique=cards&as=grid&order=name" },
          { count: 1, query: "https://scryfall.com/search?q=wm%3ASELESNYA+%28set%3Arna+or+set%3A+grn%29+r%3Cr+-t%3Acreature&unique=cards&as=grid&order=name" },
        ],
        nextEvent: "",
      },
      {
        requiredSelections: [],
        optionLabel: "TEMP_NONCREATURE",
        postSelectionText: "",
        rewards: [
          { count: 1, query: "https://scryfall.com/search?q=wm%3ASELESNYA+%28set%3Arna+or+set%3A+grn%29+r%3Cr+-t%3Acreature&unique=cards&as=grid&order=name" },
        ],
        nextEvent: "",
      },
      {
        requiredSelections: [],
        optionLabel: "TEMP_CREATURE",
        postSelectionText: "",
        rewards: [
          { count: 1, query: "https://scryfall.com/search?q=wm%3ASELESNYA+%28set%3Arna+or+set%3A+grn%29+r%3Cr+-t%3Acreature&unique=cards&as=grid&order=name" },
        ],
        nextEvent: "",
      },
    ],
  },
  {
    mainText: "",
    id: "ON_WIN_EVENTS.BOROS_BONUS",
    options: [
      {
        requiredSelections: ["JOIN_GUILD.BOROS"],
        optionLabel: "→",
        postSelectionText: "",
        rewards: [
          { count: 1, query: "https://scryfall.com/search?q=wm%3ABOROS+%28set%3Arna+or+set%3A+grn%29+r%3Cr+t%3Acreature&unique=cards&as=grid&order=name" },
          { count: 1, query: "https://scryfall.com/search?q=wm%3ABOROS+%28set%3Arna+or+set%3A+grn%29+r%3Cr+-t%3Acreature&unique=cards&as=grid&order=name" },
        ],
        nextEvent: "",
      },
      {
        requiredSelections: [],
        optionLabel: "TEMP_NONCREATURE",
        postSelectionText: "",
        rewards: [
          { count: 1, query: "https://scryfall.com/search?q=wm%3ABOROS+%28set%3Arna+or+set%3A+grn%29+r%3Cr+-t%3Acreature&unique=cards&as=grid&order=name" },
        ],
        nextEvent: "",
      },
      {
        requiredSelections: [],
        optionLabel: "TEMP_CREATURE",
        postSelectionText: "",
        rewards: [
          { count: 1, query: "https://scryfall.com/search?q=wm%3ABOROS+%28set%3Arna+or+set%3A+grn%29+r%3Cr+-t%3Acreature&unique=cards&as=grid&order=name" },
        ],
        nextEvent: "",
      },
    ],
  },
  {
    mainText: "",
    id: "ON_WIN_EVENTS.RAKDOS_BONUS",
    options: [
      {
        requiredSelections: ["JOIN_GUILD.RAKDOS"],
        optionLabel: "→",
        postSelectionText: "",
        rewards: [
          { count: 1, query: "https://scryfall.com/search?q=wm%3ARAKDOS+%28set%3Arna+or+set%3A+grn%29+r%3Cr+t%3Acreature&unique=cards&as=grid&order=name" },
          { count: 1, query: "https://scryfall.com/search?q=wm%3ARAKDOS+%28set%3Arna+or+set%3A+grn%29+r%3Cr+-t%3Acreature&unique=cards&as=grid&order=name" },
        ],
        nextEvent: "",
      },
      {
        requiredSelections: [],
        optionLabel: "TEMP_NONCREATURE",
        postSelectionText: "",
        rewards: [
          { count: 1, query: "https://scryfall.com/search?q=wm%3ARAKDOS+%28set%3Arna+or+set%3A+grn%29+r%3Cr+-t%3Acreature&unique=cards&as=grid&order=name" },
        ],
        nextEvent: "",
      },
      {
        requiredSelections: [],
        optionLabel: "TEMP_CREATURE",
        postSelectionText: "",
        rewards: [
          { count: 1, query: "https://scryfall.com/search?q=wm%3ARAKDOS+%28set%3Arna+or+set%3A+grn%29+r%3Cr+-t%3Acreature&unique=cards&as=grid&order=name" },
        ],
        nextEvent: "",
      },
    ],
  },
  {
    mainText: "",
    id: "ON_WIN_EVENTS.ORZHOV_BONUS",
    options: [
      {
        requiredSelections: ["JOIN_GUILD.ORZHOV"],
        optionLabel: "→",
        postSelectionText: "",
        rewards: [
          { count: 1, query: "https://scryfall.com/search?q=wm%3AORZHOV+%28set%3Arna+or+set%3A+grn%29+r%3Cr+t%3Acreature&unique=cards&as=grid&order=name" },
          { count: 1, query: "https://scryfall.com/search?q=wm%3AORZHOV+%28set%3Arna+or+set%3A+grn%29+r%3Cr+-t%3Acreature&unique=cards&as=grid&order=name" },
        ],
        nextEvent: "",
      },
      {
        requiredSelections: [],
        optionLabel: "TEMP_NONCREATURE",
        postSelectionText: "",
        rewards: [
          { count: 1, query: "https://scryfall.com/search?q=wm%3AORZHOV+%28set%3Arna+or+set%3A+grn%29+r%3Cr+-t%3Acreature&unique=cards&as=grid&order=name" },
        ],
        nextEvent: "",
      },
      {
        requiredSelections: [],
        optionLabel: "TEMP_CREATURE",
        postSelectionText: "",
        rewards: [
          { count: 1, query: "https://scryfall.com/search?q=wm%3AORZHOV+%28set%3Arna+or+set%3A+grn%29+r%3Cr+-t%3Acreature&unique=cards&as=grid&order=name" },
        ],
        nextEvent: "",
      },
    ],
  },
  {
    mainText: "",
    id: "ON_WIN_EVENTS.RAV_FLY_TRAMPLE",
    options: [
      {
        requiredSelections: ["MORAL_CHOICE.LOYAL"],
        optionLabel: "→",
        postSelectionText: "",
        rewards: [
          { count: 1, query: "https://scryfall.com/search?q=set%3Awar+r%3Cr+o%3Aflying&unique=cards&as=grid&order=name" },
          { count: 1, query: "https://scryfall.com/search?q=set%3Awar+r%3Cr+o%3Atrample&unique=cards&as=grid&order=name" },
        ],
        nextEvent: "",
      },
      {
        requiredSelections: [],
        optionLabel: "TEMP_FLYING",
        postSelectionText: "",
        rewards: [
          { count: 1, query: "https://scryfall.com/search?q=set%3Awar+r%3Cr+o%3Aflying&unique=cards&as=grid&order=name" },
        ],
        nextEvent: "",
      },
      {
        requiredSelections: [],
        optionLabel: "TEMP_TRAMPLE",
        postSelectionText: "",
        rewards: [
          { count: 1, query: "https://scryfall.com/search?q=set%3Awar+r%3Cr+o%3Atrample&unique=cards&as=grid&order=name" },
        ],
        nextEvent: "",
      },
    ],
  },
  {
    mainText: "",
    id: "ON_WIN_EVENTS.RAV_COUNTER_PROLIF",
    options: [
      {
        requiredSelections: ["MORAL_CHOICE.LOYAL"],
        optionLabel: "→",
        postSelectionText: "",
        rewards: [
          { count: 1, query: "https://scryfall.com/search?q=set%3Awar+r%3Cr+o%3A%2B1%2F%2B1&unique=cards&as=grid&order=name" },
          { count: 1, query: "https://scryfall.com/search?q=set%3Awar+r%3Cr+o%3Aproliferate&unique=cards&as=grid&order=name" },
        ],
        nextEvent: "",
      },
      {
        requiredSelections: [],
        optionLabel: "TEMP_+1+1COUNTER",
        postSelectionText: "",
        rewards: [
          { count: 1, query: "https://scryfall.com/search?q=set%3Awar+r%3Cr+o%3A%2B1%2F%2B1&unique=cards&as=grid&order=name" },
        ],
        nextEvent: "",
      },
      {
        requiredSelections: [],
        optionLabel: "TEMP_PROLIFERATE",
        postSelectionText: "",
        rewards: [
          { count: 1, query: "https://scryfall.com/search?q=set%3Awar+r%3Cr+o%3Aproliferate&unique=cards&as=grid&order=name" },
        ],
        nextEvent: "",
      },
    ],
  },
  {
    mainText: "",
    id: "ON_WIN_EVENTS.RAV_HASTE_VIG",
    options: [
      {
        requiredSelections: ["MORAL_CHOICE.LOYAL"],
        optionLabel: "→",
        postSelectionText: "",
        rewards: [
          { count: 1, query: "https://scryfall.com/search?q=set%3Awar+r%3Cr+o%3Ahaste+t%3Acreature&unique=cards&as=grid&order=name" },
          { count: 1, query: "https://scryfall.com/search?q=set%3Awar+r%3Cr+o%3Avigilance+t%3Acreature&unique=cards&as=grid&order=name" },
        ],
        nextEvent: "",
      },
      {
        requiredSelections: [],
        optionLabel: "TEMP_HASTE",
        postSelectionText: "",
        rewards: [
          { count: 1, query: "https://scryfall.com/search?q=set%3Awar+r%3Cr+o%3Ahaste+t%3Acreature&unique=cards&as=grid&order=name" },
        ],
        nextEvent: "",
      },
      {
        requiredSelections: [],
        optionLabel: "TEMP_VIGILANCE",
        postSelectionText: "",
        rewards: [
          { count: 1, query: "https://scryfall.com/search?q=set%3Awar+r%3Cr+o%3Avigilance+t%3Acreature&unique=cards&as=grid&order=name" },
        ],
        nextEvent: "",
      },
    ],
  },
  {
    mainText: "",
    id: "ON_WIN_EVENTS.RAV_SMALL_LARGE",
    options: [
      {
        requiredSelections: ["MORAL_CHOICE.LOYAL"],
        optionLabel: "→",
        postSelectionText: "",
        rewards: [
          { count: 1, query: "https://scryfall.com/search?q=set%3Awar+r%3Cr+t%3Acreature+toughness%3D1&unique=cards&as=grid&order=name" },
          { count: 1, query: "https://scryfall.com/search?q=set%3Awar+r%3Cr+t%3Acreature+toughness%3E%3D4&unique=cards&as=grid&order=name" },
        ],
        nextEvent: "",
      },
      {
        requiredSelections: [],
        optionLabel: "TEMP_SMALL_CREATURE",
        postSelectionText: "",
        rewards: [
          { count: 1, query: "https://scryfall.com/search?q=set%3Awar+r%3Cr+t%3Acreature+toughness%3D1&unique=cards&as=grid&order=name" },
        ],
        nextEvent: "",
      },
      {
        requiredSelections: [],
        optionLabel: "TEMP_LARGE_CREATURE",
        postSelectionText: "",
        rewards: [
          { count: 1, query: "https://scryfall.com/search?q=set%3Awar+r%3Cr+t%3Acreature+toughness%3E%3D4&unique=cards&as=grid&order=name" },
        ],
        nextEvent: "",
      },
    ],
  },
  {
    mainText: "",
    id: "ON_WIN_EVENTS.BOLAS_CHEAP_EXPENSIVE",
    options: [
      {
        requiredSelections: ["MORAL_CHOICE.BETRAY"],
        optionLabel: "→",
        postSelectionText: "",
        rewards: [
          { count: 1, query: "https://scryfall.com/search?q=set%3Awar+r%3Cr+%28t%3Ainstant+or+t%3Asorcery%29+mv%3E%3D4&unique=cards&as=grid&order=set" },
          { count: 1, query: "https://scryfall.com/search?q=set%3Awar+r%3Cr+%28t%3Ainstant+or+t%3Asorcery%29+mv%3C%3D2&unique=cards&as=grid&order=set" },
        ],
        nextEvent: "",
      },
      {
        requiredSelections: [],
        optionLabel: "TEMP_EXPENSIVE",
        postSelectionText: "",
        rewards: [
          { count: 1, query: "https://scryfall.com/search?q=set%3Awar+r%3Cr+%28t%3Ainstant+or+t%3Asorcery%29+mv%3E%3D4&unique=cards&as=grid&order=set" },
        ],
        nextEvent: "",
      },
      {
        requiredSelections: [],
        optionLabel: "TEMP_CHEAP",
        postSelectionText: "",
        rewards: [
          { count: 1, query: "https://scryfall.com/search?q=set%3Awar+r%3Cr+%28t%3Ainstant+or+t%3Asorcery%29+mv%3C%3D2&unique=cards&as=grid&order=set" },
        ],
        nextEvent: "",
      },
    ],
  },
  {
    mainText: "",
    id: "ON_WIN_EVENTS.BOLAS_ZOMBIE_AMASS",
    options: [
      {
        requiredSelections: ["MORAL_CHOICE.BETRAY"],
        optionLabel: "→",
        postSelectionText: "",
        rewards: [
          { count: 1, query: "https://scryfall.com/search?q=set%3Awar+r%3Cr+t%3Azombie+-o%3Aamass&unique=cards&as=grid&order=set" },
          { count: 1, query: "https://scryfall.com/search?q=set%3Awar+r%3Cr+-t%3Azombie+o%3Aamass+-t%3Aplaneswalker&unique=cards&as=grid&order=set" },
        ],
        nextEvent: "",
      },
      {
        requiredSelections: [],
        optionLabel: "TEMP_ZOMBIE",
        postSelectionText: "",
        rewards: [
          { count: 1, query: "https://scryfall.com/search?q=set%3Awar+r%3Cr+t%3Azombie+-o%3Aamass&unique=cards&as=grid&order=set" },
        ],
        nextEvent: "",
      },
      {
        requiredSelections: [],
        optionLabel: "TEMP_AMASS",
        postSelectionText: "",
        rewards: [
          { count: 1, query: "https://scryfall.com/search?q=set%3Awar+r%3Cr+-t%3Azombie+o%3Aamass+-t%3Aplaneswalker&unique=cards&as=grid&order=set" },
        ],
        nextEvent: "",
      },
    ],
  },
  {
    mainText: "",
    id: "ON_WIN_EVENTS.BOLAS_HUMAN_NONHUMAN",
    options: [
      {
        requiredSelections: ["MORAL_CHOICE.BETRAY"],
        optionLabel: "→",
        postSelectionText: "",
        rewards: [
          { count: 1, query: "https://scryfall.com/search?q=set%3Awar+t%3Ahuman+r%3Cr+game%3Aarena&unique=cards&as=grid&order=name" },
          { count: 1, query: "https://scryfall.com/search?q=set%3Awar+t%3Acreature+-t%3Ahuman+r%3Cr+game%3Aarena&unique=cards&as=grid&order=name" },
        ],
        nextEvent: "",
      },
      {
        requiredSelections: [],
        optionLabel: "TEMP_HUMAN",
        postSelectionText: "",
        rewards: [
          { count: 1, query: "https://scryfall.com/search?q=set%3Awar+t%3Ahuman+r%3Cr+game%3Aarena&unique=cards&as=grid&order=name" },
        ],
        nextEvent: "",
      },
      {
        requiredSelections: [],
        optionLabel: "TEMP_NONHUMAN",
        postSelectionText: "",
        rewards: [
          { count: 1, query: "https://scryfall.com/search?q=set%3Awar+t%3Acreature+-t%3Ahuman+r%3Cr+game%3Aarena&unique=cards&as=grid&order=name" },
        ],
        nextEvent: "",
      },
    ],
  },
  {
    mainText: "",
    id: "ON_WIN_EVENTS.BOLAS_HIGH_LOW_POWER",
    options: [
      {
        requiredSelections: ["MORAL_CHOICE.BETRAY"],
        optionLabel: "→",
        postSelectionText: "",
        rewards: [
          { count: 1, query: "https://scryfall.com/search?q=set%3Awar+t%3Acreature+power%3E%3D4+r%3Cr+game%3Aarena&unique=cards&as=grid&order=name" },
          { count: 1, query: "https://scryfall.com/search?q=set%3Awar+t%3Acreature+power%3C%3D1+r%3Cr+game%3Aarena&unique=cards&as=grid&order=name" },
        ],
        nextEvent: "",
      },
      {
        requiredSelections: [],
        optionLabel: "TEMP_HIGH_POWER",
        postSelectionText: "",
        rewards: [
          { count: 1, query: "https://scryfall.com/search?q=set%3Awar+t%3Acreature+power%3E%3D4+r%3Cr+game%3Aarena&unique=cards&as=grid&order=name" },
        ],
        nextEvent: "",
      },
      {
        requiredSelections: [],
        optionLabel: "TEMP_LOW_POWER",
        postSelectionText: "",
        rewards: [
          { count: 1, query: "https://scryfall.com/search?q=set%3Awar+t%3Acreature+power%3C%3D1+r%3Cr+game%3Aarena&unique=cards&as=grid&order=name" },
        ],
        nextEvent: "",
      },
    ],
  },
  {
    mainText: "",
    id: "ON_WIN_EVENTS.BOLAS_INSTANT_SORCERY",
    options: [
      {
        requiredSelections: ["MORAL_CHOICE.BETRAY"],
        optionLabel: "→",
        postSelectionText: "",
        rewards: [
          { count: 1, query: "https://scryfall.com/search?q=set%3Awar+t%3Ainstant+r%3Cr+game%3Aarena&unique=cards&as=grid&order=name" },
          { count: 1, query: "https://scryfall.com/search?q=set%3Awar+t%3Asorcery+r%3Cr+game%3Aarena&unique=cards&as=grid&order=name" },
        ],
        nextEvent: "",
      },
      {
        requiredSelections: [],
        optionLabel: "TEMP_INSTANT",
        postSelectionText: "",
        rewards: [
          { count: 1, query: "https://scryfall.com/search?q=set%3Awar+t%3Ainstant+r%3Cr+game%3Aarena&unique=cards&as=grid&order=name" },
        ],
        nextEvent: "",
      },
      {
        requiredSelections: [],
        optionLabel: "TEMP_SORCERY",
        postSelectionText: "",
        rewards: [
          { count: 1, query: "https://scryfall.com/search?q=set%3Awar+t%3Asorcery+r%3Cr+game%3Aarena&unique=cards&as=grid&order=name" },
        ],
        nextEvent: "",
      },
    ],
  },
];
