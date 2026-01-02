// CYOA event data - converted from JSON structure
import { Event } from "./cyoa_types.ts";

// OnLoss Events
export const onLossEvents: Event[] = [
  {
    mainText: `Ravnica isn't as as you remember it from years past. There's a paranoid chill in the air. Strangers avoid making eye contact, doors are locked tight, and nobody goes out after dark if they can avoid it. Instead, there's a nervous energy underlying even simple interactions. Behind the rhythms of everyday life now lie unspoken questions. 'Are you with the cult? The senate? The real senate, or those pretenders?' Whatever it is, most people just want to be left out of it.

Something big is on the horizon. Everyone knows it. The guilds know it. Their actions admit it, even if their words don't. Why else have the Golgari cut food shipments? Why else have the legion tripled patrols? Why else have the explosions coming from the Izzet workshops gotten even louder lately?

The guilds don't know the shape of what's coming. If they did, their preparations would be more carefully directed. Instead, they all look like a bunch of blind men trying to see the future - reaching in all directions for any hint of what's got everyone else so nervous.

And here you are, about to jump back into the middle of this stirred up nest of snakes. You know you're going to need a home. When the storm comes, it's always the guildless left out in the cold. Proximity to power brings danger, but also opportunity. No sense consigning yourself to being just a passenger. You feel like you're going to have a part to play in steering future events.

None of the guilds are in a spot to be turning away people with your kind of talents right now. It's just a matter of deciding where to call home. Best choose carefully.`,
    id: "START_EVENT",
    options: [
      {
        requiredSelections: [],
        optionLabel: "Join the Simic Combine",
        postSelectionText: "The Simic welcome you with an excess of open arms and grant you tokens of membership.",
        rewards: [
          { count: "PACK", sets: ["RNA"] },
          { count: 3, query: "https://scryfall.com/search?q=game%3Aarena+r%3Dc+%28set%3Arna+or+set%3Agrn%29+wm%3Asimic+-t%3Aland&unique=cards&as=grid&order=name" },
          { count: 1, query: "https://scryfall.com/search?q=game%3Aarena+r%3Du+%28set%3Arna+or+set%3Agrn%29+wm%3Asimic+-is%3Aplaneswalkerdeck&unique=cards&as=grid&order=name" },
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
          { count: 1, query: "https://scryfall.com/search?q=game%3Aarena+r%3Du+%28set%3Arna+or+set%3Agrn%29+wm%3Aazorius+-is%3Aplaneswalkerdeck&unique=cards&as=grid&order=name" },
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
          { count: 1, query: "https://scryfall.com/search?q=game%3Aarena+r%3Du+%28set%3Arna+or+set%3Agrn%29+wm%3Aizzet+-is%3Aplaneswalkerdeck&unique=cards&as=grid&order=name" },
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
          { count: 1, query: "https://scryfall.com/search?q=game%3Aarena+r%3Du+%28set%3Arna+or+set%3Agrn%29+wm%3Adimir+-is%3Aplaneswalkerdeck&unique=cards&as=grid&order=name" },
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
          { count: 1, query: "https://scryfall.com/search?q=game%3Aarena+r%3Du+%28set%3Arna+or+set%3Agrn%29+wm%3Agruul+-is%3Aplaneswalkerdeck&unique=cards&as=grid&order=name" },
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
          { count: 1, query: "https://scryfall.com/search?q=game%3Aarena+r%3Du+%28set%3Arna+or+set%3Agrn%29+wm%3Agolgari+-is%3Aplaneswalkerdeck&unique=cards&as=grid&order=name" },
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
          { count: 1, query: "https://scryfall.com/search?q=game%3Aarena+r%3Du+%28set%3Arna+or+set%3Agrn%29+wm%3Aselesnya+-is%3Aplaneswalkerdeck&unique=cards&as=grid&order=name" },
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
          { count: 1, query: "https://scryfall.com/search?q=game%3Aarena+r%3Du+%28set%3Arna+or+set%3Agrn%29+wm%3Aboros+-is%3Aplaneswalkerdeck&unique=cards&as=grid&order=name" },
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
          { count: 1, query: "https://scryfall.com/search?q=game%3Aarena+r%3Du+%28set%3Arna+or+set%3Agrn%29+wm%3Arakdos+-is%3Aplaneswalkerdeck&unique=cards&as=grid&order=name" },
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
          { count: 1, query: "https://scryfall.com/search?q=game%3Aarena+r%3Du+%28set%3Arna+or+set%3Agrn%29+wm%3Aorzhov+-is%3Aplaneswalkerdeck&unique=cards&as=grid&order=name" },
          { count: 2, query: "https://scryfall.com/card/rna/252/orzhov-guildgate" },
          { count: 1, query: "https://scryfall.com/card/aa1/9/orzhov-signet" },
        ],
        nextEvent: "JOIN_GUILD.ORZHOV",
      },
    ],
  },
  {
    mainText: `As a responsible member of the Simic, you really shouldn't have lost track of your Signet. Then you wouldn't have been in this position, meeting a unknown counterpart on a park bench at night, just because of a letter promising help getting it back.

A man sits down on the other side of the bench. You're not sure how he got so close without you noticing. You also can't see his face. You should be able to see his face - the park isn't so dark, but you can't. You're not sure he has a face. A mouth you won't ever be able to see starts to move; his voice starts to speak.

"First of all, let me apologize for inconvienceing you today. I have a proposal I wish to make to you, one I needed to make where where we weren't going to be overheard. I ask you only to hear this proposal and I will return your ring to you." 

His voice sounds like it's coming from somwehre a couple feet to the left of where it should be.

"I represent an individual who believes that the guild system has led to a cycle of factional infighting which is holding back the plane. What Ravnica needs is a radical restructuring. Unification under a single hand."

The faceless man's voice drops to a whisper.

"We have need of the services of an assassin of great skill, such as yourself."`,
    id: "JOIN_GUILD.SIMIC",
    options: [
      {
        requiredSelections: [],
        optionLabel: "Stay loyal to the Simic",
        postSelectionText: "True to his word, the faceless man returns your signet before sliding out of sight as quietly as he appeared. You recount the whole thing later in front of the Simic leadership, and they decide to assign one of their strongest champions to work with you.",
        rewards: [
          { count: "PACK", sets: ["RNA"] },
          { count: 1, query: "https://scryfall.com/card/rna/214/zegana-utopian-speaker" },
        ],
        nextEvent: "MORAL_CHOICE.LOYAL",
      },
      {
        requiredSelections: [],
        optionLabel: "Agree to work with the faceless man",
        postSelectionText: `You're not quite sure how you can tell, but you're pretty sure the faceless man is smiling. "We'll be in touch with instructions", his voice says as he hands over your signet. "In the meantime, I've asked a couple of the guilds we've already flipped to send over their strongest champions. They should help you out."`,
        rewards: [
          { count: "PACK", sets: ["RNA", "GRN"] },
          { count: 2, query: "https://scryfall.com/search?q=%28type%3Alegendary%29+%28set%3Arna+OR+set%3Agrn%29+rarity%3Ar&unique=cards&as=grid&order=name" },
        ],
        nextEvent: "MORAL_CHOICE.BETRAY",
      },
    ],
  },
  {
    mainText: `As a responsible member of the Azorius, you really shouldn't have lost track of your Signet. Then you wouldn't have been in this position, meeting a unknown counterpart on a park bench at night, just because of a letter promising help getting it back.

A man sits down on the other side of the bench. You're not sure how he got so close without you noticing. You also can't see his face. You should be able to see his face - the park isn't so dark, but you can't. You're not sure he has a face. A mouth you won't ever be able to see starts to move; his voice starts to speak.

"First of all, let me apologize for inconvienceing you today. I have a proposal I wish to make to you, one I needed to make where where we weren't going to be overheard. I ask you only to hear this proposal and I will return your ring to you." 

His voice sounds like it's coming from somwehre a couple feet to the left of where it should be.

"I represent an individual who believes that the guild system has led to a cycle of factional infighting which is holding back the plane. What Ravnica needs is a radical restructuring. Unification under a single hand."

The faceless man's voice drops to a whisper.

"We have need of the services of an assassin of great skill, such as yourself."`,
    id: "JOIN_GUILD.AZORIUS",
    options: [
      {
        requiredSelections: [],
        optionLabel: "Stay loyal to the Azorius",
        postSelectionText: "True to his word, the faceless man returns your signet before sliding out of sight as quietly as he appeared. You recount the whole thing later in front of the Azorius leadership, and they decide to assign one of their strongest champions to work with you.",
        rewards: [
          { count: "PACK", sets: ["RNA"] },
          { count: 1, query: "https://scryfall.com/card/rna/189/lavinia-azorius-renegade" },
        ],
        nextEvent: "MORAL_CHOICE.LOYAL",
      },
      {
        requiredSelections: [],
        optionLabel: "Agree to work with the faceless man",
        postSelectionText: `You're not quite sure how you can tell, but you're pretty sure the faceless man is smiling. "We'll be in touch with instructions", his voice says as he hands over your signet. "In the meantime, I've asked a couple of the guilds we've already flipped to send over their strongest champions. They should help you out."`,
        rewards: [
          { count: "PACK", sets: ["RNA", "GRN"] },
          { count: 2, query: "https://scryfall.com/search?q=%28type%3Alegendary%29+%28set%3Arna+OR+set%3Agrn%29+rarity%3Ar&unique=cards&as=grid&order=name" },
        ],
        nextEvent: "MORAL_CHOICE.BETRAY",
      },
    ],
  },
  {
    mainText: `As a responsible member of the Izzet, you really shouldn't have lost track of your Signet. Then you wouldn't have been in this position, meeting a unknown counterpart on a park bench at night, just because of a letter promising help getting it back.

A man sits down on the other side of the bench. You're not sure how he got so close without you noticing. You also can't see his face. You should be able to see his face - the park isn't so dark, but you can't. You're not sure he has a face. A mouth you won't ever be able to see starts to move; his voice starts to speak.

"First of all, let me apologize for inconvienceing you today. I have a proposal I wish to make to you, one I needed to make where where we weren't going to be overheard. I ask you only to hear this proposal and I will return your ring to you." 

His voice sounds like it's coming from somwehre a couple feet to the left of where it should be.

"I represent an individual who believes that the guild system has led to a cycle of factional infighting which is holding back the plane. What Ravnica needs is a radical restructuring. Unification under a single hand."

The faceless man's voice drops to a whisper.

"We have need of the services of an assassin of great skill, such as yourself."`,
    id: "JOIN_GUILD.IZZET",
    options: [
      {
        requiredSelections: [],
        optionLabel: "Stay loyal to the Izzet",
        postSelectionText: "True to his word, the faceless man returns your signet before sliding out of sight as quietly as he appeared. You recount the whole thing later in front of the Izzet leadership, and they decide to assign one of their strongest champions to work with you.",
        rewards: [
          { count: "PACK", sets: ["GRN"] },
          { count: 1, query: "https://scryfall.com/card/grn/192/niv-mizzet-parun" },
        ],
        nextEvent: "MORAL_CHOICE.LOYAL",
      },
      {
        requiredSelections: [],
        optionLabel: "Agree to work with the faceless man",
        postSelectionText: `You're not quite sure how you can tell, but you're pretty sure the faceless man is smiling. "We'll be in touch with instructions", his voice says as he hands over your signet. "In the meantime, I've asked a couple of the guilds we've already flipped to send over their strongest champions. They should help you out."`,
        rewards: [
          { count: "PACK", sets: ["RNA", "GRN"] },
          { count: 2, query: "https://scryfall.com/search?q=%28type%3Alegendary%29+%28set%3Arna+OR+set%3Agrn%29+rarity%3Ar&unique=cards&as=grid&order=name" },
        ],
        nextEvent: "MORAL_CHOICE.BETRAY",
      },
    ],
  },
  {
    mainText: `As a responsible member of the Dimir, you really shouldn't have lost track of your Signet. Then you wouldn't have been in this position, meeting a unknown counterpart on a park bench at night, just because of a letter promising help getting it back.

A man sits down on the other side of the bench. You're not sure how he got so close without you noticing. You also can't see his face. You should be able to see his face - the park isn't so dark, but you can't. You're not sure he has a face. A mouth you won't ever be able to see starts to move; his voice starts to speak.

"First of all, let me apologize for inconvienceing you today. I have a proposal I wish to make to you, one I needed to make where where we weren't going to be overheard. I ask you only to hear this proposal and I will return your ring to you." 

His voice sounds like it's coming from somwehre a couple feet to the left of where it should be.

"I represent an individual who believes that the guild system has led to a cycle of factional infighting which is holding back the plane. What Ravnica needs is a radical restructuring. Unification under a single hand."

The faceless man's voice drops to a whisper.

"We have need of the services of an assassin of great skill, such as yourself."`,
    id: "JOIN_GUILD.DIMIR",
    options: [
      {
        requiredSelections: [],
        optionLabel: "Stay loyal to the Dimir",
        postSelectionText: "True to his word, the faceless man returns your signet before sliding out of sight as quietly as he appeared. You recount the whole thing later in front of the Dimir leadership, and they decide to assign one of their strongest champions to work with you.",
        rewards: [
          { count: "PACK", sets: ["GRN"] },
          { count: 1, query: "https://scryfall.com/card/grn/170/etrata-the-silencer" },
        ],
        nextEvent: "MORAL_CHOICE.LOYAL",
      },
      {
        requiredSelections: [],
        optionLabel: "Agree to work with the faceless man",
        postSelectionText: `You're not quite sure how you can tell, but you're pretty sure the faceless man is smiling. "We'll be in touch with instructions", his voice says as he hands over your signet. "In the meantime, I've asked a couple of the guilds we've already flipped to send over their strongest champions. They should help you out."`,
        rewards: [
          { count: "PACK", sets: ["RNA", "GRN"] },
          { count: 2, query: "https://scryfall.com/search?q=%28type%3Alegendary%29+%28set%3Arna+OR+set%3Agrn%29+rarity%3Ar&unique=cards&as=grid&order=name" },
        ],
        nextEvent: "MORAL_CHOICE.BETRAY",
      },
    ],
  },
  {
    mainText: `As a responsible member of the Gruul, you really shouldn't have lost track of your Signet. Then you wouldn't have been in this position, meeting a unknown counterpart on a park bench at night, just because of a letter promising help getting it back.

A man sits down on the other side of the bench. You're not sure how he got so close without you noticing. You also can't see his face. You should be able to see his face - the park isn't so dark, but you can't. You're not sure he has a face. A mouth you won't ever be able to see starts to move; his voice starts to speak.

"First of all, let me apologize for inconvienceing you today. I have a proposal I wish to make to you, one I needed to make where where we weren't going to be overheard. I ask you only to hear this proposal and I will return your ring to you." 

His voice sounds like it's coming from somwehre a couple feet to the left of where it should be.

"I represent an individual who believes that the guild system has led to a cycle of factional infighting which is holding back the plane. What Ravnica needs is a radical restructuring. Unification under a single hand."

The faceless man's voice drops to a whisper.

"We have need of the services of an assassin of great skill, such as yourself."`,
    id: "JOIN_GUILD.GRUUL",
    options: [
      {
        requiredSelections: [],
        optionLabel: "Stay loyal to the Gruul",
        postSelectionText: "True to his word, the faceless man returns your signet before sliding out of sight as quietly as he appeared. You recount the whole thing later in front of the Gruul leadership, and they decide to assign one of their strongest champions to work with you.",
        rewards: [
          { count: "PACK", sets: ["RNA"] },
          { count: 1, query: "https://scryfall.com/card/rna/193/nikya-of-the-old-ways" },
        ],
        nextEvent: "MORAL_CHOICE.LOYAL",
      },
      {
        requiredSelections: [],
        optionLabel: "Agree to work with the faceless man",
        postSelectionText: `You're not quite sure how you can tell, but you're pretty sure the faceless man is smiling. "We'll be in touch with instructions", his voice says as he hands over your signet. "In the meantime, I've asked a couple of the guilds we've already flipped to send over their strongest champions. They should help you out."`,
        rewards: [
          { count: "PACK", sets: ["RNA", "GRN"] },
          { count: 2, query: "https://scryfall.com/search?q=%28type%3Alegendary%29+%28set%3Arna+OR+set%3Agrn%29+rarity%3Ar&unique=cards&as=grid&order=name" },
        ],
        nextEvent: "MORAL_CHOICE.BETRAY",
      },
    ],
  },
  {
    mainText: `As a responsible member of the Golgari, you really shouldn't have lost track of your Signet. Then you wouldn't have been in this position, meeting a unknown counterpart on a park bench at night, just because of a letter promising help getting it back.

A man sits down on the other side of the bench. You're not sure how he got so close without you noticing. You also can't see his face. You should be able to see his face - the park isn't so dark, but you can't. You're not sure he has a face. A mouth you won't ever be able to see starts to move; his voice starts to speak.

"First of all, let me apologize for inconvienceing you today. I have a proposal I wish to make to you, one I needed to make where where we weren't going to be overheard. I ask you only to hear this proposal and I will return your ring to you." 

His voice sounds like it's coming from somwehre a couple feet to the left of where it should be.

"I represent an individual who believes that the guild system has led to a cycle of factional infighting which is holding back the plane. What Ravnica needs is a radical restructuring. Unification under a single hand."

The faceless man's voice drops to a whisper.

"We have need of the services of an assassin of great skill, such as yourself."`,
    id: "JOIN_GUILD.GOLGARI",
    options: [
      {
        requiredSelections: [],
        optionLabel: "Stay loyal to the Golgari",
        postSelectionText: "True to his word, the faceless man returns your signet before sliding out of sight as quietly as he appeared. You recount the whole thing later in front of the Golgari leadership, and they decide to assign one of their strongest champions to work with you.",
        rewards: [
          { count: "PACK", sets: ["GRN"] },
          { count: 1, query: "https://scryfall.com/card/grn/180/izoni-thousand-eyed" },
        ],
        nextEvent: "MORAL_CHOICE.LOYAL",
      },
      {
        requiredSelections: [],
        optionLabel: "Agree to work with the faceless man",
        postSelectionText: `You're not quite sure how you can tell, but you're pretty sure the faceless man is smiling. "We'll be in touch with instructions", his voice says as he hands over your signet. "In the meantime, I've asked a couple of the guilds we've already flipped to send over their strongest champions. They should help you out."`,
        rewards: [
          { count: "PACK", sets: ["RNA", "GRN"] },
          { count: 2, query: "https://scryfall.com/search?q=%28type%3Alegendary%29+%28set%3Arna+OR+set%3Agrn%29+rarity%3Ar&unique=cards&as=grid&order=name" },
        ],
        nextEvent: "MORAL_CHOICE.BETRAY",
      },
    ],
  },
  {
    mainText: `As a responsible member of the Selesnya, you really shouldn't have lost track of your Signet. Then you wouldn't have been in this position, meeting a unknown counterpart on a park bench at night, just because of a letter promising help getting it back.

A man sits down on the other side of the bench. You're not sure how he got so close without you noticing. You also can't see his face. You should be able to see his face - the park isn't so dark, but you can't. You're not sure he has a face. A mouth you won't ever be able to see starts to move; his voice starts to speak.

"First of all, let me apologize for inconvienceing you today. I have a proposal I wish to make to you, one I needed to make where where we weren't going to be overheard. I ask you only to hear this proposal and I will return your ring to you." 

His voice sounds like it's coming from somwehre a couple feet to the left of where it should be.

"I represent an individual who believes that the guild system has led to a cycle of factional infighting which is holding back the plane. What Ravnica needs is a radical restructuring. Unification under a single hand."

The faceless man's voice drops to a whisper.

"We have need of the services of an assassin of great skill, such as yourself."`,
    id: "JOIN_GUILD.SELESNYA",
    options: [
      {
        requiredSelections: [],
        optionLabel: "Stay loyal to the Selesnya",
        postSelectionText: "True to his word, the faceless man returns your signet before sliding out of sight as quietly as he appeared. You recount the whole thing later in front of the Selesnya leadership, and they decide to assign one of their strongest champions to work with you.",
        rewards: [
          { count: "PACK", sets: ["GRN"] },
          { count: 1, query: "https://scryfall.com/card/grn/168/emmara-soul-of-the-accord" },
        ],
        nextEvent: "MORAL_CHOICE.LOYAL",
      },
      {
        requiredSelections: [],
        optionLabel: "Agree to work with the faceless man",
        postSelectionText: `You're not quite sure how you can tell, but you're pretty sure the faceless man is smiling. "We'll be in touch with instructions", his voice says as he hands over your signet. "In the meantime, I've asked a couple of the guilds we've already flipped to send over their strongest champions. They should help you out."`,
        rewards: [
          { count: "PACK", sets: ["RNA", "GRN"] },
          { count: 2, query: "https://scryfall.com/search?q=%28type%3Alegendary%29+%28set%3Arna+OR+set%3Agrn%29+rarity%3Ar&unique=cards&as=grid&order=name" },
        ],
        nextEvent: "MORAL_CHOICE.BETRAY",
      },
    ],
  },
  {
    mainText: `As a responsible member of the Boros, you really shouldn't have lost track of your Signet. Then you wouldn't have been in this position, meeting a unknown counterpart on a park bench at night, just because of a letter promising help getting it back.

A man sits down on the other side of the bench. You're not sure how he got so close without you noticing. You also can't see his face. You should be able to see his face - the park isn't so dark, but you can't. You're not sure he has a face. A mouth you won't ever be able to see starts to move; his voice starts to speak.

"First of all, let me apologize for inconvienceing you today. I have a proposal I wish to make to you, one I needed to make where where we weren't going to be overheard. I ask you only to hear this proposal and I will return your ring to you." 

His voice sounds like it's coming from somwehre a couple feet to the left of where it should be.

"I represent an individual who believes that the guild system has led to a cycle of factional infighting which is holding back the plane. What Ravnica needs is a radical restructuring. Unification under a single hand."

The faceless man's voice drops to a whisper.

"We have need of the services of an assassin of great skill, such as yourself."`,
    id: "JOIN_GUILD.BOROS",
    options: [
      {
        requiredSelections: [],
        optionLabel: "Stay loyal to the Boros",
        postSelectionText: "True to his word, the faceless man returns your signet before sliding out of sight as quietly as he appeared. You recount the whole thing later in front of the Boros leadership, and they decide to assign one of their strongest champions to work with you.",
        rewards: [
          { count: "PACK", sets: ["GRN"] },
          { count: 1, query: "https://scryfall.com/card/grn/204/tajic-legions-edge" },
        ],
        nextEvent: "MORAL_CHOICE.LOYAL",
      },
      {
        requiredSelections: [],
        optionLabel: "Agree to work with the faceless man",
        postSelectionText: `You're not quite sure how you can tell, but you're pretty sure the faceless man is smiling. "We'll be in touch with instructions", his voice says as he hands over your signet. "In the meantime, I've asked a couple of the guilds we've already flipped to send over their strongest champions. They should help you out."`,
        rewards: [
          { count: "PACK", sets: ["RNA", "GRN"] },
          { count: 2, query: "https://scryfall.com/search?q=%28type%3Alegendary%29+%28set%3Arna+OR+set%3Agrn%29+rarity%3Ar&unique=cards&as=grid&order=name" },
        ],
        nextEvent: "MORAL_CHOICE.BETRAY",
      },
    ],
  },
  {
    mainText: `As a responsible member of the Rakdos, you really shouldn't have lost track of your Signet. Then you wouldn't have been in this position, meeting a unknown counterpart on a park bench at night, just because of a letter promising help getting it back.

A man sits down on the other side of the bench. You're not sure how he got so close without you noticing. You also can't see his face. You should be able to see his face - the park isn't so dark, but you can't. You're not sure he has a face. A mouth you won't ever be able to see starts to move; his voice starts to speak.

"First of all, let me apologize for inconvienceing you today. I have a proposal I wish to make to you, one I needed to make where where we weren't going to be overheard. I ask you only to hear this proposal and I will return your ring to you." 

His voice sounds like it's coming from somwehre a couple feet to the left of where it should be.

"I represent an individual who believes that the guild system has led to a cycle of factional infighting which is holding back the plane. What Ravnica needs is a radical restructuring. Unification under a single hand."

The faceless man's voice drops to a whisper.

"We have need of the services of an assassin of great skill, such as yourself."`,
    id: "JOIN_GUILD.RAKDOS",
    options: [
      {
        requiredSelections: [],
        optionLabel: "Stay loyal to the Rakdos",
        postSelectionText: "True to his word, the faceless man returns your signet before sliding out of sight as quietly as he appeared. You recount the whole thing later in front of the Rakdos leadership, and they decide to assign one of their strongest champions to work with you.",
        rewards: [
          { count: "PACK", sets: ["RNA"] },
          { count: 1, query: "https://scryfall.com/card/rna/185/judith-the-scourge-diva" },
        ],
        nextEvent: "MORAL_CHOICE.LOYAL",
      },
      {
        requiredSelections: [],
        optionLabel: "Agree to work with the faceless man",
        postSelectionText: `You're not quite sure how you can tell, but you're pretty sure the faceless man is smiling. "We'll be in touch with instructions", his voice says as he hands over your signet. "In the meantime, I've asked a couple of the guilds we've already flipped to send over their strongest champions. They should help you out."`,
        rewards: [
          { count: "PACK", sets: ["RNA", "GRN"] },
          { count: 2, query: "https://scryfall.com/search?q=%28type%3Alegendary%29+%28set%3Arna+OR+set%3Agrn%29+rarity%3Ar&unique=cards&as=grid&order=name" },
        ],
        nextEvent: "MORAL_CHOICE.BETRAY",
      },
    ],
  },
  {
    mainText: `As a responsible member of the Orzhov, you really shouldn't have lost track of your Signet. Then you wouldn't have been in this position, meeting a unknown counterpart on a park bench at night, just because of a letter promising help getting it back.

A man sits down on the other side of the bench. You're not sure how he got so close without you noticing. You also can't see his face. You should be able to see his face - the park isn't so dark, but you can't. You're not sure he has a face. A mouth you won't ever be able to see starts to move; his voice starts to speak.

"First of all, let me apologize for inconvienceing you today. I have a proposal I wish to make to you, one I needed to make where where we weren't going to be overheard. I ask you only to hear this proposal and I will return your ring to you." 

His voice sounds like it's coming from somwehre a couple feet to the left of where it should be.

"I represent an individual who believes that the guild system has led to a cycle of factional infighting which is holding back the plane. What Ravnica needs is a radical restructuring. Unification under a single hand."

The faceless man's voice drops to a whisper.

"We have need of the services of an assassin of great skill, such as yourself."`,
    id: "JOIN_GUILD.ORZHOV",
    options: [
      {
        requiredSelections: [],
        optionLabel: "Stay loyal to the Orzhov",
        postSelectionText: "True to his word, the faceless man returns your signet before sliding out of sight as quietly as he appeared. You recount the whole thing later in front of the Orzhov leadership, and they decide to assign one of their strongest champions to work with you.",
        rewards: [
          { count: "PACK", sets: ["RNA"] },
          { count: 1, query: "https://scryfall.com/card/rna/212/teysa-karlov" },
        ],
        nextEvent: "MORAL_CHOICE.LOYAL",
      },
      {
        requiredSelections: [],
        optionLabel: "Agree to work with the faceless man",
        postSelectionText: `You're not quite sure how you can tell, but you're pretty sure the faceless man is smiling. "We'll be in touch with instructions", his voice says as he hands over your signet. "In the meantime, I've asked a couple of the guilds we've already flipped to send over their strongest champions. They should help you out."`,
        rewards: [
          { count: "PACK", sets: ["RNA", "GRN"] },
          { count: 2, query: "https://scryfall.com/search?q=%28type%3Alegendary%29+%28set%3Arna+OR+set%3Agrn%29+rarity%3Ar&unique=cards&as=grid&order=name" },
        ],
        nextEvent: "MORAL_CHOICE.BETRAY",
      },
    ],
  },
  {
    mainText: `The laboratory of the dragon Niv-Mizzet is stuffed to the brim with magical devices and scrolls - a horde of arcane knowledge to humble all the libraries on the plane. He turns to examine you as you enter. You feel like you're an ant under a magnifying glass. You know he was expecting your visit, but you still involuntarily shrink in his presence. You start to explain how your guild tasked you to gather information on a potential threat, but he interrupts you.

"You were visited by the faceless man."

Not a question, a statement. So much for discretion then. You start to recount in detail everything you can remember about your interaction, but the dragon cuts you off again.

"That is past. The future is my present concern. You wish to help me with my work, human? Then take this".

A platform raises itself from the floor, bearing a long tube tube with a lens on one end and no visible opening on the other.

"This device links cause to effect. Your encounter with the faceless man has left behind ripples that it can follow into the future. You will use it now."

Gingerly, you take the device and press it to your eye. The first thing you see is an image of yourself, here and now in the lab. You look first to your left, and you see your encounter with faceless man - this time refracted and reflected into dozens of different aspects. You try to look to the right. The images start to speed ahead as the device becomes uncomfortably hot in your hands.

"Do not strain yourself. I am providing the power here", the dragon rumbles. 

The further into the future you look, the blurrier the images get. The kaleidoscope of possibilies starts to dissolve and fracture. You think you see war, death, fire and blood.

"You must choose: near, or far. This tool will not bear both."
`,
    id: "MORAL_CHOICE.LOYAL",
    options: [
      {
        requiredSelections: [],
        optionLabel: "Explore the possiblilies of the near-future",
        postSelectionText: "The device powers down. Two paths remain open before you. You are free to choose among them.",
        rewards: [
          // empty here, but there's code to open an RNA pack and a GRN pack, pick 1 of 2
        ],
        nextEvent: "WAR_START.LOYAL_PRESENT",
      },
      {
        requiredSelections: [],
        optionLabel: "Send a beacon into the distant future",
        postSelectionText: "The device charges up, before bursting into a shower of sparks black smoke. You can only hope that someone somewhere was listening.",
        rewards: [
          { count: "PACK", sets: ["RNA", "GRN"] },
        ],
        nextEvent: "WAR_START.LOYAL_FUTURE",
      },
    ],
  },
  {
    mainText: `The unfamiliar tools are heavy on your belt. A shining silver oversized anti-magic snare, and something nasty you don't really recognize. Normally you work lighter, but then again you've never gone after a target this big. You'll take all the help you can get.

The laboratory lair of Niv-Mizzet crackles with electricity. Just as you were promised, the trapdoor to the attic was left unlocked. First up, the snare. Straightforward enough, it goes silently around the neck of the sleeping dragon.

You reach for your tool pouch and pull out the nasty looking thing. Looks like a giant sewing needle with a crown of dark-red crystals connected by golden wire on the blunt end. An "Essence Ejector", the faceless man had called it. With the dragon restrained, you reach up and manage to wedge the sharp end of the device under one of the scales on the dragon's underbelly.

The crystals on the device flash bright, and a humming noise slowly picks up. You start to see Niv-Mizzet's outline blur, as if he was starting to fade in and out of existence. Then suddenly - it's as if the dragon is split in two. A ghostly image above, and a corpse below.

Severed from his body - the ghostly Niv Mizzet's energy flies around the room before settling in a small silver carving of his own head. This must be the firemind vessel you were instructed to retrieve.

As you collect your prize - doubt assails you. You're not sure what will happen if the faceless man's employer gets control of the vessel. The choice is upon you.`,
    id: "MORAL_CHOICE.BETRAY",
    options: [
      {
        requiredSelections: [],
        optionLabel: "Betray your orders and take the firemind vessel for yourself",
        postSelectionText: "As you are about to leave, one of the many devices in the lab seems to respond to the vessel's presence. It shows you two paths into the future. You are free to choose among them. You can only hope your betrayal will not be discovered.",
        rewards: [
          { count: 1, query: "https://scryfall.com/card/war/237/firemind-vessel" },
          { count: "PACK_CHOICE", sets: ["RNA", "GRN"] },
        ],
        nextEvent: "WAR_START.BETRAY_PRESENT",
      },
      {
        requiredSelections: [],
        optionLabel: "Deliver the firemind vessel to the faceless man, as you were ordered",
        postSelectionText: "As you head towards the rendezvous point, you once again feel the faceless man smile. You hope that your loyalty will be rewarded.",
        rewards: [
          { count: "PACK", sets: ["RNA", "GRN"] },
        ],
        nextEvent: "WAR_START.BETRAY_FUTURE",
      },
    ],
  },
  {
    mainText: `The explosion which heralded the start of the invasion of Ravnica happened in the pre-dawn of one of the first cold days of the year, when all but the truly restless were asleep. On every street corner, portals to other worlds opened up. An army of zombies poured out, their bodies and weapons coated in a shiny blue metal.

The bulk of the army moved quickly to secure critical chokepoints, blocking off movement across the city. Meanwhile, elite troops started moving house to house, searching for those in hiding.

The guilds, having been forwarned by Niv-Mizzet, had already co-ordinated with one another to plan a defence of the city. But the speed at which the Dreadhorde attacked had still caught them off guard.

The centre of their efforts was to be the gateway plaza - the only place directly accessible from the territories of each guild. There, the champions of each guild gathered their forces. Survivors from across the city moved to join them there, forming a rattled but determined militia.

Through the largest of the portals, a winged shadow is looming. You see the shapes of teeth and claws, and you feel an immense presence drawing closer.`,
    id: "WAR_START.LOYAL_PRESENT",
    options: [
      {
        requiredSelections: [],
        optionLabel: "The guilds rally together",
        postSelectionText: "Guild spellcasters have devised new ways to combine their magic, and Ravnica's strongest champions prepare to fight by your side. It might not be enough.",
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
    mainText: `The explosion which heralded the start of the invasion of Ravnica happened in the pre-dawn of one of the first cold days of the year, when all but the truly restless were asleep. On every street corner, portals to other worlds opened up. An army of zombies poured out, their bodies and weapons coated in a shiny blue metal.

The bulk of the army moved quickly to secure critical chokepoints, blocking off movement across the city. Meanwhile, elite troops started moving house to house, searching for those in hiding.

The guilds, having been forwarned by Niv-Mizzet, had already co-ordinated with one another to plan a defence of the city. But the speed at which the Dreadhorde attacked had still caught them off guard.

The centre of their efforts was to be the gateway plaza - the only place directly accessible from the territories of each guild. There, the champions of each guild gathered their forces. Survivors from across the city moved to join them there, forming a rattled but determined militia.

Through the largest of the portals, a winged shadow is looming. You see the shapes of teeth and claws, and you feel an immense presence drawing closer.`,
    id: "WAR_START.LOYAL_FUTURE",
    options: [
      {
        requiredSelections: [],
        optionLabel: "The guilds rally together",
        postSelectionText: "Guild spellcasters have devised new ways to combine their magic, and Ravnica's strongest champions prepare to fight by your side. It might not be enough.",
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
    mainText: `The explosion which heralded the start of the invasion of Ravnica happened in the pre-dawn of one of the first cold days of the year, when all but the truly restless were asleep. On every street corner, portals to other worlds opened up. An army of zombies poured out, their bodies and weapons coated in a shiny blue metal.

The bulk of the army moved quickly to secure critical chokepoints, blocking off movement across the city. Meanwhile, elite troops started moving house to house, searching for those in hiding.

In spite of their preparations, the guilds hadn't been expecting a threat like this. The death of Niv-Mizzet had robbed the defenders of their natural leader and rallying point. Resistance was fierce, but scattered and disorganized.

The voice of the faceless man speaks from behind you "Look at what you have made possible". You turn to look, but he's nowhere to be found.`,
    id: "WAR_START.BETRAY_PRESENT",
    options: [
      {
        requiredSelections: [],
        optionLabel: "A detachment of the Dreadhorde is placed under your command.",
        postSelectionText: "Through the largest of the portals, a winged shadow is looming. You see the shapes of teeth and claws, and you feel an immense presence drawing closer. You hope your betrayal can escape its gaze.",
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
    mainText: `The explosion which heralded the start of the invasion of Ravnica happened in the pre-dawn of one of the first cold days of the year, when all but the truly restless were asleep. On every street corner, portals to other worlds opened up. An army of zombies poured out, their bodies and weapons coated in a shiny blue metal.

The bulk of the army moved quickly to secure critical chokepoints, blocking off movement across the city. Meanwhile, elite troops started moving house to house, searching for those in hiding.

In spite of their preparations, the guilds hadn't been expecting a threat like this. The death of Niv-Mizzet had robbed the defenders of their natural leader and rallying point. Resistance was fierce, but scattered and disorganized.

The voice of the faceless man speaks from behind you "Look at what you have made possible". You turn to look, but he's nowhere to be found.`,
    id: "WAR_START.BETRAY_FUTURE",
    options: [
      {
        requiredSelections: [],
        optionLabel: "A detachment of the Dreadhorde is placed under your command.",
        postSelectionText: "Through the largest of the portals, a winged shadow is looming. You see the shapes of teeth and claws, and you feel an immense presence drawing closer. You hope it will reward your loyal service.",
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
    mainText: `You see Nicol Bolas pass through the largest of the portals above the city, and you feel your hope start to fade. A great explosion tears through the city centre, levelling the neighborhood closest to where he arrived.

The Ranvican forces are standing united for now, their ranks reinforced by the city's planeswalkers, who have chosen this moment to make their stand.
`,
    id: "WAR_END.LOYAL_PRESENT",
    options: [
      {
        requiredSelections: [],
        optionLabel: "Begin the final battle",
        postSelectionText: "You and your ragtag group of allies stand resolute against Nicol Bolas and the Dreadhorde. Whatever the outcome, Ravica will be devastated.",
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
    mainText: `You see Nicol Bolas pass through the largest of the portals above the city, and a great explosion tears through the city centre, levelling the neighborhood closest to where he arrived. As you feel the hope in your chest start to fade, your eyes turn skyward.

A beacon - your beacon, sent from the past - is shining bright in the sky above the ruined city. You see a whole host of planeswalkers assembling there, rallying the scattered Ravnican forces around them. It's more than just those local to the city. They've come from worlds close and far, drawn by your call to and save Ravnica in its hour of need.`,
    id: "WAR_END.LOYAL_FUTURE",
    options: [
      {
        requiredSelections: [],
        optionLabel: "Begin the final battle",
        postSelectionText: "You and your newfound planeswalker allies stand united against Nicol Bolas and the Dreadhorde. A great triumph may be close at hand.",
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
    mainText: `You see Nicol Bolas pass through the portal from as far away as possible. You started running as soon as you saw his shadow and you haven't stopped yet. From ahead of you this time, you hear the voice of the faceless man. It's louder this time - loud enough that you have to stumble to a halt.

"I can see you. You kept something from me. Something that was promised to me. You betrayed your city, then you betrayed me, and soon there won't be anything left of this city for you to hide behind."

You look around in desperation. You aren't sure where you are, but you can feel the firemind vessel humming and tugging at your belt. It's pulling you to the side, not away from the danger as you were running but into the ruins of a building torn in two when the portals opened. Inside, you follow the vessel's pull to a basement, then a level deeper, then deeper still, until the noise of the street fades above you.

This deep, the only light left comes from around a corner, where you find yourself somehow in the guildpack chamber at the center of the city. As you enter the room, the firemind vessel rips itself free, and explodes in the centre of the room. The essense you had ejected from Niv-Mizzet, which had gathered itself into the device, starts to pour out into the air and coalesce into an increasingly solid form.

Niv-Mizzet is reborn!
`,
    id: "WAR_END.BETRAY_PRESENT",
    options: [
      {
        requiredSelections: [],
        optionLabel: "Begin the final battle",
        postSelectionText: "You and Niv-Mizzet, now imbued with the power of the living guidpact, stand alone against Nicol Bolas and the Dreadhorde.",
        rewards: [
          { count: "PACK", sets: ["WAR"] },
          { count: 1, query: "https://scryfall.com/card/war/208/niv-mizzet-reborn" },
        ],
        nextEvent: "",
      },
    ],
  },
  {
    mainText: `You saw Nicol Bolas pass through the portal and scatter the nearby Ravnican resistance with a single spell. You feel relief that you didn't indulge any thoughts you might've had about standing against him, or betraying him. Nothing can stand against him, and as he speaks to you, you know that no betrayal would've escaped his gaze.

He speaks with a voice that you recognize as the voice of the faceless man.

He rewards your loyalty, entrusting you with one of his pet God-Eternals, and one of his strongest works of sorcery. You have been charged with hunting down any fools who would oppose him.`,
    id: "WAR_END.BETRAY_FUTURE",
    options: [
      {
        requiredSelections: [],
        optionLabel: "Begin the final battle",
        postSelectionText: "As you lead the god-pharoh's forces, you see statues of Nicol Bolas already standing where the guildgates once stood. Surely victory must be close at hand.",
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
    mainText: `You sigh and slump back in your chair. Two days ago, you saw a flier for a Simic "research study" offering to cover a month's worth of guild fees for willing participants. Despite your better judgement, here you sit in the waiting room of the laboratory… a month of guild fees would go a long way in these uncertain times.

"Subject 19!"

You look down at your armband. That's you…

You follow the merfolk scientist to a room full of miscellaneous vials and jars of powdered ingredients. She proudly holds up a vial of fluorescent blue liquid. You eye it suspiciously - doesn't look safe for consumption under any circumstances.`,
    id: "ON_WIN_EVENTS.SIMIC_BONUS",
    options: [
      {
        requiredSelections: ["JOIN_GUILD.SIMIC"],
        optionLabel: "Show the scientist your guild signet to gain direct access to the laboratory",
        postSelectionText: "Her eyes widen, and she eagerly leads you to the laboratory to show you the creation process for the odd looking vial, clearly happy to share the methods with another member of the Combine.",
        rewards: [
          { count: 1, query: "https://scryfall.com/search?q=wm%3ASIMIC+%28set%3Arna+or+set%3Agrn%29+r%3Cr+t%3Acreature+is%3Abooster&unique=cards&as=grid&order=name" },
          { count: 1, query: "https://scryfall.com/search?q=wm%3ASIMIC+%28set%3Arna+or+set%3Agrn%29+r%3Cr+-t%3Acreature+is%3Abooster&unique=cards&as=grid&order=name" },
        ],
        nextEvent: "",
      },
      {
        requiredSelections: [],
        optionLabel: "Refuse and leave the lab",
        postSelectionText: "Common sense wins out, and you back out of the room. Having the right number of appendages sounds pretty nice. You did learn a trick or two though from your visit.",
        rewards: [
          { count: 1, query: "https://scryfall.com/search?q=wm%3ASIMIC+%28set%3Arna+or+set%3Agrn%29+r%3Cr+-t%3Acreature+is%3Abooster&unique=cards&as=grid&order=name" },
        ],
        nextEvent: "",
      },
      {
        requiredSelections: [],
        optionLabel: "Shrug and drink the vial",
        postSelectionText: "You take the vial and down it in one gulp with a shudder. Doesn't taste too bad, actually…  you just hope there's no adverse effects later.",
        rewards: [
          { count: 1, query: "https://scryfall.com/search?q=wm%3ASIMIC+%28set%3Arna+or+set%3Agrn%29+r%3Cr+t%3Acreature+is%3Abooster&unique=cards&as=grid&order=name" },
        ],
        nextEvent: "",
      },
    ],
  },
  {
    mainText: `Coming home from work, you find a short and plump woman waiting for you at the front door. Her ginger hair is soaked from the rain and sticks in long streaks to her winter coat. It takes you a couple seconds to realize this woman is your cousin Milera. You haven't seen her since last years' Guildpact Festival, and she was in costume then anyway. (Milera and her boyfriend Brev were dressed up as the two-headed cyclops Borborygmus.)

She looks worried as you approach. "The Azorius arrested Brev and I don't know what for. I'm sure he hasn't done anything. You have guild connections right? Can you do anything?"

At the Azorius holding cell you meet a sharply-dressed Vedalken who explains she is a precognition mage - Brev has been arrested because she has foreseen that he is going to commit crimes against Ravnica
`,
    id: "ON_WIN_EVENTS.AZORIUS_BONUS",
    options: [
      {
        requiredSelections: ["JOIN_GUILD.AZORIUS"],
        optionLabel: "Show your guild signet and ask what Brev's legal options are",
        postSelectionText: `The vedalken nods. "With an Azorius guaranteeing him he can be allowed to go on bail until his trial."`,
        rewards: [
          { count: 1, query: "https://scryfall.com/search?q=wm%3AAZORIUS+%28set%3Arna+or+set%3Agrn%29+r%3Cr+t%3Acreature+is%3Abooster&unique=cards&as=grid&order=name" },
          { count: 1, query: "https://scryfall.com/search?q=wm%3AAZORIUS+%28set%3Arna+or+set%3Agrn%29+r%3Cr+-t%3Acreature+is%3Abooster&unique=cards&as=grid&order=name" },
        ],
        nextEvent: "",
      },
      {
        requiredSelections: [],
        optionLabel: "Ask to contest the arrest",
        postSelectionText: `You argue indignantly with the vedalken, who sighs. "Fill this form out to start the appeal process. We'll contact you within the next 14 business days."`,
        rewards: [
          { count: 1, query: "https://scryfall.com/search?q=wm%3AAZORIUS+%28set%3Arna+or+set%3Agrn%29+r%3Cr+-t%3Acreature+is%3Abooster&unique=cards&as=grid&order=name" },
        ],
        nextEvent: "",
      },
      {
        requiredSelections: [],
        optionLabel: "Thank the vedalken for her due diligence",
        postSelectionText: `"More than welcome. Here is my contact in case we need to work together again."`,
        rewards: [
          { count: 1, query: "https://scryfall.com/search?q=wm%3AAZORIUS+%28set%3Arna+or+set%3Agrn%29+r%3Cr+t%3Acreature+is%3Abooster&unique=cards&as=grid&order=name" },
        ],
        nextEvent: "",
      },
    ],
  },
  {
    mainText: `While out on a walk, you notice some sort of commotion happening in the district square. Curious, you approach the sparse crowd to see what's going on. In the center of the square is some sort of jagged contraption with bits of metal and wires sticking out of it at all angles. You're not entirely sure what it is, but it's clearly the handiwork of the Izzet. Based on the sparks the device is emitting, it seems like it's malfunctioning too.

A few people start to approach the odd contraption. You're not sure what their intentions are, but it could be dangerous for unqualified citizens to be handling anything of Izzet construction, especially with how on edge Ravnica is these days.`,
    id: "ON_WIN_EVENTS.IZZET_BONUS",
    options: [
      {
        requiredSelections: ["JOIN_GUILD.IZZET"],
        optionLabel: "Flash the crowd your guild signet and collect the device yourself",
        postSelectionText: "The crowd steps back, and you examine the contraption. With a cut of a few wires, the sparks stop and it seems to disable itself. Problem solved. Another Izzet member shows up as you are leaving - they owe you a favour now.",
        rewards: [
          { count: 1, query: "https://scryfall.com/search?q=wm%3AIZZET+%28set%3Arna+or+set%3Agrn%29+r%3Cr+-t%3Acreature+is%3Abooster&unique=cards&as=grid&order=name" },
          { count: 1, query: "https://scryfall.com/search?q=wm%3AIZZET+%28set%3Arna+or+set%3Agrn%29+r%3Cr+t%3Acreature+is%3Abooster&unique=cards&as=grid&order=name" },
        ],
        nextEvent: "",
      },
      {
        requiredSelections: [],
        optionLabel: "Stand and watch the citizens fiddle with the device",
        postSelectionText: "You hang back and watch as few people poke at the contraption until it short circuits and explodes with a flash. Doesn't seem like anyone is hurt seriously, but they'll think twice about messing with random Izzet objects again. More importantly, you think you now understand how to reproduce the same effect as the device, should the need arise.",
        rewards: [
          { count: 1, query: "https://scryfall.com/search?q=wm%3AIZZET+%28set%3Arna+or+set%3Agrn%29+r%3Cr+-t%3Acreature+is%3Abooster&unique=cards&as=grid&order=name" },
        ],
        nextEvent: "",
      },
      {
        requiredSelections: [],
        optionLabel: "Tell the crowd to stand back and call an authority",
        postSelectionText: "You step in and manage to keep the onlookers from approaching the contraption until a qualified disposal team is able to take care of it. One of those team members offers you her card as thanks, in case you need a favour in the future.",
        rewards: [
          { count: 1, query: "https://scryfall.com/search?q=wm%3AIZZET+%28set%3Arna+or+set%3Agrn%29+r%3Cr+t%3Acreature+is%3Abooster&unique=cards&as=grid&order=name" },
        ],
        nextEvent: "",
      },
    ],
  },
  {
    mainText: `You're walking through a dimly lit section of the city as night falls. You didn't mean to stay out this late, especially in this part of Ravnica, but one thing led to another, and here you are. As you hurry home, you get the sinking feeling someone is on your tail. A glance of a cloak disappearing from sight out of the corner of your eye and the occasional audible footsteps betray your unwanted company's presence.

Only an agent of the House Dimir would operate in such secrecy.`,
    id: "ON_WIN_EVENTS.DIMIR_BONUS",
    options: [
      {
        requiredSelections: ["JOIN_GUILD.DIMIR"],
        optionLabel: "Flash your guild signet to the agent to clear yourself of suspicion",
        postSelectionText: `The agent nods and slips away into the night. "Apologies. I must have trailed the wrong person."`,
        rewards: [
          { count: 1, query: "https://scryfall.com/search?q=wm%3ADIMIR+%28set%3Arna+or+set%3Agrn%29+r%3Cr+t%3Acreature+is%3Abooster&unique=cards&as=grid&order=name" },
          { count: 1, query: "https://scryfall.com/search?q=wm%3ADIMIR+%28set%3Arna+or+set%3Agrn%29+r%3Cr+-t%3Acreature+is%3Abooster&unique=cards&as=grid&order=name" },
        ],
        nextEvent: "",
      },
      {
        requiredSelections: [],
        optionLabel: "Lose the agent in a crowd",
        postSelectionText: "You notice a gathering of people inside a nearby restaurant, and join them, blending in. You wait until you're sure the agent must have lost you, then you backtrack the way you had been going. You find a Dimir tracking spell surreptitiously placed around the last corner.",
        rewards: [
          { count: 1, query: "https://scryfall.com/search?q=wm%3ADIMIR+%28set%3Arna+or+set%3Agrn%29+r%3Cr+-t%3Acreature+is%3Abooster&unique=cards&as=grid&order=name" },
        ],
        nextEvent: "",
      },
      {
        requiredSelections: [],
        optionLabel: "Confront the agent to see why they're following you",
        postSelectionText: "The agent sees you turn and walk purposefully, and realizes he's been noticed. He ducks into an alley, off your trail, but you corner him. You manage to secure his future co-operation.",
        rewards: [
          { count: 1, query: "https://scryfall.com/search?q=wm%3ADIMIR+%28set%3Arna+or+set%3Agrn%29+r%3Cr+t%3Acreature+is%3Abooster&unique=cards&as=grid&order=name" },
        ],
        nextEvent: "",
      },
    ],
  },
  {
    mainText: `You awake in the wee hours of the morning to sounds of commotion outside. You rub the sleep from your eyes and quickly get dressed, heading downstairs. In the street, a group of revelers is loudly yelling and throwing stones at people's windows. You recognize the insignia of the Gruul tattooed onto many of their arms and printed on their clothing. It's clear they're set on causing a ruckus and disrupting the peace in this neighborhood.

One of them notices you standing in the doorway and rambles over. "You want trouble, punk?" The ogre puffs out his chest, looking down at you with a surly expression. You quickly weigh your options.`,
    id: "ON_WIN_EVENTS.GRUUL_BONUS",
    options: [
      {
        requiredSelections: ["JOIN_GUILD.GRUUL"],
        optionLabel: "Show the ogre your guild signet and ask them to move on",
        postSelectionText: `The ogre breaks into a toothy grin. "One of us! We'll be on our way now."`,
        rewards: [
          { count: 1, query: "https://scryfall.com/search?q=wm%3AGRUUL+%28set%3Arna+or+set%3Agrn%29+r%3Cr+t%3Acreature+is%3Abooster&unique=cards&as=grid&order=name" },
          { count: 1, query: "https://scryfall.com/search?q=wm%3AGRUUL+%28set%3Arna+or+set%3Agrn%29+r%3Cr+-t%3Acreature+is%3Abooster&unique=cards&as=grid&order=name" },
        ],
        nextEvent: "",
      },
      {
        requiredSelections: [],
        optionLabel: "Tell the ogre you don't want any trouble",
        postSelectionText: "You shake your head hurriedly, ducking back into your house and closing the door. Later that day, while you're digging through some of the rubble they left behind, you find a Gruul warcharm still intact and ready to use.",
        rewards: [
          { count: 1, query: "https://scryfall.com/search?q=wm%3AGRUUL+%28set%3Arna+or+set%3Agrn%29+r%3Cr+-t%3Acreature+is%3Abooster&unique=cards&as=grid&order=name" },
        ],
        nextEvent: "",
      },
      {
        requiredSelections: [],
        optionLabel: "Ask to join the revelers",
        postSelectionText: `The ogre steps back in surprise, clearly not expecting your response. He lets out a deep laugh and slaps your back with a large hand, nearly knocking you off your feet. "I like this one!"`,
        rewards: [
          { count: 1, query: "https://scryfall.com/search?q=wm%3AGRUUL+%28set%3Arna+or+set%3Agrn%29+r%3Cr+t%3Acreature+is%3Abooster&unique=cards&as=grid&order=name" },
        ],
        nextEvent: "",
      },
    ],
  },
  {
    mainText: `As you walk through Precinct Five you notice a foul smell coming from an abandoned building. Your curiosity gets the best of you and you enter. The place is mostly rubble. Broken furniture and dirty fur clumps show it has been used as a Gruul base, but not recently. You locate the source of the smell to the corner of the lot.

You move away a stone to reveal a horde of crawling pillbugs and what seems to formerly have been the entry to the basement. A quick lightspell reveals that this basement goes deeper than most - the Golgari undercity has come up here! The smell of decay is unbearable.`,
    id: "ON_WIN_EVENTS.GOLGARI_BONUS",
    options: [
      {
        requiredSelections: ["JOIN_GUILD.GOLGARI"],
        optionLabel: "Use the darkglow function on your signet and enter",
        postSelectionText: "Golgari signets respond to the underworld chemical mix. You press it into a bit of fungus and it lights up. When you enter, you meet a Kraul couple. The insectoids live on the outskirts of Golgari society. The three of you take measures to make their home less noticeable to the outside world and they thank you profusely.",
        rewards: [
          { count: 1, query: "https://scryfall.com/search?q=wm%3Agolgari+%28set%3Arna+or+set%3Agrn%29+r%3Cr+t%3Acreature+is%3Abooster&unique=cards&as=grid&order=name" },
          { count: 1, query: "https://scryfall.com/search?q=wm%3Agolgari+%28set%3Arna+or+set%3Agrn%29+r%3Cr+-t%3Acreature+is%3Abooster&unique=cards&as=grid&order=name" },
        ],
        nextEvent: "",
      },
      {
        requiredSelections: [],
        optionLabel: "Try to close this way",
        postSelectionText: "You spend half an hour shoving stones and rubbish down the former basement. At a certain point, you hear insectoid legs scurrying away and the smell seems to grow better. Seems like you successfully kept the rot out of the district. On the way out, you notice an unusual purple-dotted fungus. Perhaps this will prove useful as a spellcasting ingredient.",
        rewards: [
          { count: 1, query: "https://scryfall.com/search?q=wm%3Agolgari+%28set%3Arna+or+set%3Agrn%29+r%3Cr+-t%3Acreature+is%3Abooster&unique=cards&as=grid&order=name" },
        ],
        nextEvent: "",
      },
      {
        requiredSelections: [],
        optionLabel: "Enter and fight whatever brought the underworld up here",
        postSelectionText: "You brace yourself and enter the basement. There is a small rot farm with two sleeping Kraul. The mantismen are easily dispatched. Nothing of much value here, but you do decide to take a rather large and prominent egg. ",
        rewards: [
          { count: 1, query: "https://scryfall.com/search?q=wm%3Agolgari+%28set%3Arna+or+set%3Agrn%29+r%3Cr+t%3Acreature+is%3Abooster&unique=cards&as=grid&order=name" },
        ],
        nextEvent: "",
      },
    ],
  },
  {
    mainText: `"I'm telling you, whatever these tensions are about, they will all be resolved through some loophole in the Guildpact." The elf swirls his apricot wine - talking loud enough that you can hear him three tables away.

His human companion scoffs. "Guess we will all be enslaved to the Orzhov forever then."

"Don't count out the Selesnya - Ielenya told me they moved the original Guildpact copy into the Tenth District Park library."

The next day at 8 AM sharp, you enter the Tenth District Park library. It's a small nondescript building. There is a librarian writing on administrative scrolls and you spot a building map on a desk. The climate controlled historical archive is in room 22.`,
    id: "ON_WIN_EVENTS.SELESNYA_BONUS",
    options: [
      {
        requiredSelections: ["JOIN_GUILD.SELESNYA"],
        optionLabel: "Show the librarian your guild signet",
        postSelectionText: "The librarian is happy to have a friend show up. They laugh at the suggestion of the Guildpact being stored here - the Tenth District Park library is chronically underfunded. They do hook you up with a spell and a summoning incantation.",
        rewards: [
          { count: 1, query: "https://scryfall.com/search?q=wm%3ASELESNYA+%28set%3Arna+or+set%3Agrn%29+r%3Cr+t%3Acreature+is%3Abooster&unique=cards&as=grid&order=name" },
          { count: 1, query: "https://scryfall.com/search?q=wm%3ASELESNYA+%28set%3Arna+or+set%3Agrn%29+r%3Cr+-t%3Acreature+is%3Abooster&unique=cards&as=grid&order=name" },
        ],
        nextEvent: "",
      },
      {
        requiredSelections: [],
        optionLabel: "Sneak into room 22",
        postSelectionText: "You rummage through the room. No sign of the Guildpact here. The elf you overheard must be badly informed. You do find a useful Selesnya spell though.",
        rewards: [
          { count: 1, query: "https://scryfall.com/search?q=wm%3ASELESNYA+%28set%3Arna+or+set%3Agrn%29+r%3Cr+-t%3Acreature+is%3Abooster&unique=cards&as=grid&order=name" },
        ],
        nextEvent: "",
      },
      {
        requiredSelections: [],
        optionLabel: "Chat up the librarian",
        postSelectionText: "The librarian is happy to have some conversation, they are the only one working at this location today. It turns out the Guildpact is still at Vitu-Ghazi, but you do make a friend.",
        rewards: [
          { count: 1, query: "https://scryfall.com/search?q=wm%3ASELESNYA+%28set%3Arna+or+set%3Agrn%29+r%3Cr+t%3Acreature+is%3Abooster&unique=cards&as=grid&order=name" },
        ],
        nextEvent: "",
      },
    ],
  },
  {
    mainText: `You're out on a few errands on your day off. Turning the corner on 6th street, you immediately run headfirst into a masked man carrying a bag of… well, something, but you can't tell what it is. He stumbles backwards, caught off guard. You notice a soldier clad in standard Boros Legionnaire armor a few blocks away running towards you both.

"That man is a thief! Apprehend him in the name of the law!"

The man seems to regain his footing and looks ready to dash away again.`,
    id: "ON_WIN_EVENTS.BOROS_BONUS",
    options: [
      {
        requiredSelections: ["JOIN_GUILD.BOROS"],
        optionLabel: "Hold up your guild signet to the man and order him to stop",
        postSelectionText: "The thief frantically looks at you and back at the legionnaire chasing him. Cornered, he gives up and allows himself to be taken into custody. The legion rewards you handsomely for rendering your assistance while off-duty.",
        rewards: [
          { count: 1, query: "https://scryfall.com/search?q=wm%3ABOROS+%28set%3Arna+or+set%3Agrn%29+r%3Cr+t%3Acreature+is%3Abooster&unique=cards&as=grid&order=name" },
          { count: 1, query: "https://scryfall.com/search?q=wm%3ABOROS+%28set%3Arna+or+set%3Agrn%29+r%3Cr+-t%3Acreature+is%3Abooster&unique=cards&as=grid&order=name" },
        ],
        nextEvent: "",
      },
      {
        requiredSelections: [],
        optionLabel: "Allow the man to escape",
        postSelectionText: "You make no move to stop the thief as he sprints away. The legionnaire gives you a disapproving look as she passes you in pursuit of the criminal, but you weren't about to stick your nose where it didn't belong. You did, however, manage to swipe something out of that bag.",
        rewards: [
          { count: 1, query: "https://scryfall.com/search?q=wm%3ABOROS+%28set%3Arna+or+set%3Agrn%29+r%3Cr+-t%3Acreature+is%3Abooster&unique=cards&as=grid&order=name" },
        ],
        nextEvent: "",
      },
      {
        requiredSelections: [],
        optionLabel: "Tackle the man as he tries to run again",
        postSelectionText: `With a leap, you tackle the thief to the sidewalk as he tries to run past you. The legionnaire gives you an appreciative nod. "I'll take it from here. If you ever need a favour, just give me a call."`,
        rewards: [
          { count: 1, query: "https://scryfall.com/search?q=wm%3ABOROS+%28set%3Arna+or+set%3Agrn%29+r%3Cr+t%3Acreature+is%3Abooster&unique=cards&as=grid&order=name" },
        ],
        nextEvent: "",
      },
    ],
  },
  {
    mainText: `You receive an invitation in the mail from an old friend, Alena. It seems to be for a party. You shrug - an odd thing in these times, but you could stand to let loose a bit. Plus, you haven't seen her since university. Could be a good chance to catch up.

On the day of the event, you grab your coat and head to the address listed. Surprised, you look up to see this address is a pretty infamous Rakdos den. You didn't realize Alena had thrown in with that crew, but what you do know is the Rakdos don't skimp on their parties.

What you also know is a pair of bouncers wearing horned masks are currently blocking your way.`,
    id: "ON_WIN_EVENTS.RAKDOS_BONUS",
    options: [
      {
        requiredSelections: ["JOIN_GUILD.RAKDOS"],
        optionLabel: "Show your guild signet to gain access to the den",
        postSelectionText: `The bouncers grin and step aside, letting you in. "Try not to die in there, kid."`,
        rewards: [
          { count: 1, query: "https://scryfall.com/search?q=wm%3ARAKDOS+%28set%3Arna+or+set%3Agrn%29+r%3Cr+-t%3Acreature+is%3Abooster&unique=cards&as=grid&order=name" },
          { count: 1, query: "https://scryfall.com/search?q=wm%3ARAKDOS+%28set%3Arna+or+set%3Agrn%29+r%3Cr+t%3Acreature+is%3Abooster&unique=cards&as=grid&order=name" },
        ],
        nextEvent: "",
      },
      {
        requiredSelections: [],
        optionLabel: "Leave and report them to the Azorius",
        postSelectionText: "You walk away and put in an anonymous tip to the Azorius crime hotline. Any party you have a good chance of losing limbs at isn't a party you want to be in. As you are leaving, one of the windows blows open, and a nasty looking device flies out and nearly hits you. You collect it and bring it home - it might be useful later.",
        rewards: [
          { count: 1, query: "https://scryfall.com/search?q=wm%3ARAKDOS+%28set%3Arna+or+set%3Agrn%29+r%3Cr+-t%3Acreature+is%3Abooster&unique=cards&as=grid&order=name" },
        ],
        nextEvent: "",
      },
      {
        requiredSelections: [],
        optionLabel: "Sneak past the bouncers when they're distracted",
        postSelectionText: "You wait until the bouncers seem occupied with an unruly guest, and slip unnoticed into the den, for better or for worse. You don't remember much of the rest of that night, but you do make a new friend.",
        rewards: [
          { count: 1, query: "https://scryfall.com/search?q=wm%3ARAKDOS+%28set%3Arna+or+set%3Agrn%29+r%3Cr+t%3Acreature+is%3Abooster&unique=cards&as=grid&order=name" },
        ],
        nextEvent: "",
      },
    ],
  },
  {
    mainText: `You're at home working on a report when there's a knock at the door. You wonder who could be paying you a visit at this hour as you stand up and head to the front entrance. You open the door cautiously to find an Orzhov toll collector waiting impatiently.

"We have reason to believe you owe the Syndicate a sum of money." The toll enforcer hands you a sheet of paper detailing the supposed dues you definitely have not incurred. Your eyes scan the paper, weighing your options.`,
    id: "ON_WIN_EVENTS.ORZHOV_BONUS",
    options: [
      {
        requiredSelections: ["JOIN_GUILD.ORZHOV"],
        optionLabel: "Present your guild signet to the toll collector to waive the fees",
        postSelectionText: `The collector glances at your signet and nods slightly. "Your loyalty to the Syndicate is noted. We'll call it even." You reach out to your local syndicate chapter and are granted a substantial payment in exchange for this intrusion into your affairs.`,
        rewards: [
          { count: 1, query: "https://scryfall.com/search?q=wm%3AORZHOV+%28set%3Arna+or+set%3Agrn%29+r%3Cr+-t%3Acreature+is%3Abooster&unique=cards&as=grid&order=name" },
          { count: 1, query: "https://scryfall.com/search?q=wm%3AORZHOV+%28set%3Arna+or+set%3Agrn%29+r%3Cr+t%3Acreature+is%3Abooster&unique=cards&as=grid&order=name" },
        ],
        nextEvent: "",
      },
      {
        requiredSelections: [],
        optionLabel: "Pay the dues",
        postSelectionText: `You don't want to get on the wrong side of the Syndicate. The collector accepts your payment with a wide smile. "Your cooperation is appreciated. In the interest of further co-operation, please take this spell-work."`,
        rewards: [
          { count: 1, query: "https://scryfall.com/search?q=wm%3AORZHOV+%28set%3Arna+or+set%3Agrn%29+r%3Cr+-t%3Acreature+is%3Abooster&unique=cards&as=grid&order=name" },
        ],
        nextEvent: "",
      },
      {
        requiredSelections: [],
        optionLabel: "Tell the toll collector to shove off",
        postSelectionText: `You tear the paper in half. The collector scoffs at your indignation. "This isn't the last you've heard of us." He tells you a syndicate member will be assigned to you to supervise your future payments.`,
        rewards: [
          { count: 1, query: "https://scryfall.com/search?q=wm%3AORZHOV+%28set%3Arna+or+set%3Agrn%29+r%3Cr+t%3Acreature+is%3Abooster&unique=cards&as=grid&order=name" },
        ],
        nextEvent: "",
      },
    ],
  },
  {
    mainText: `In the time since the invasion, you've built a fairly impressive network of allies: civilians, rogues, guildmages, mercenaries, double agents, even a few of the many planeswalkers who followed the invasion here. That network has helped you survive this long, and given you access to support, supplies, critical information, muscle, new magic and more. But now you need a very particular set of skills.

According to scuttle on the street, Dovin Baan is hiding something extraordinarily powerful inside the Azorian Senate. And you need to get a glimpse.

The only problem? The Senate is heavily fortified.`,
    id: "ON_WIN_EVENTS.RAV_FLY_TRAMPLE",
    options: [
      {
        requiredSelections: ["MORAL_CHOICE.LOYAL"],
        optionLabel: "Reach out to your contacts in the guilds",
        postSelectionText: `"Why choose between going over and going through?" says your operative friend in the resistance, "We'd like to know what Dovin is working on too. I'll send you a couple members of the Legion to assist."`,
        rewards: [
          { count: 1, query: "https://scryfall.com/search?q=set%3Awar+is%3Abooster+r%3Cr+o%3Aflying+t%3Acreature&unique=cards&as=grid&order=name" },
          { count: 1, query: "https://scryfall.com/search?q=set%3Awar+is%3Abooster+r%3Cr+o%3Atrample&unique=cards&as=grid&order=name" },
        ],
        nextEvent: "",
      },
      {
        requiredSelections: [],
        optionLabel: "Find someone to fly you over the Senate walls",
        postSelectionText: `"A stryx?"

"You said you wanted a flyer! It's well trained! This thing can get over their security and capture images on this lens."

You're skeptical, but what do you have to lose?`,
        rewards: [
          { count: 1, query: "https://scryfall.com/search?q=set%3Awar+is%3Abooster+r%3Cr+o%3Aflying+t%3Acreature&unique=cards&as=grid&order=name" },
        ],
        nextEvent: "",
      },
      {
        requiredSelections: [],
        optionLabel: "Find someone to take you through the walls",
        postSelectionText: "You check your hand-scrawled list of contacts for anyone who could help. BOOM: an explosives expert from New Pravh. Not exactly a stealth mission, but you just need one glimpse and a getaway. And if you get caught? A few weeks in Azorius detention is probably the safest place for you right now anyway. ",
        rewards: [
          { count: 1, query: "https://scryfall.com/search?q=set%3Awar+is%3Abooster+r%3Cr+o%3Atrample&unique=cards&as=grid&order=name" },
        ],
        nextEvent: "",
      },
    ],
  },
  {
    mainText: `Not all Ravnican defense is organized by the guilds. Precinct and neighbourhood watches have been springing up like mushrooms, focussing on protecting life and property from the invaders.

Your current mission brings you to hardscrabble neighborhoods of Tenth District Precinct Six. The working folk, usually eking out a living by toiling at warehouses, docks, and factories have united to block the entrances and exits to the Precinct. You have to cross no less than three sets of checkpoints and associated pat-downs to get to your rendezvous point at the central plaza.

After your mission, your contact introduces you to two local leaders: a giant representing the largest warehouse workers and a vedalken from the local workshops. They are discussing the best way to protect the Precinct. The giant argues for building up the outer defenses as much as possible, while the vedalken thinks all layers should be similarly built up.`,
    id: "ON_WIN_EVENTS.RAV_COUNTER_PROLIF",
    options: [
      {
        requiredSelections: ["MORAL_CHOICE.LOYAL"],
        optionLabel: "Propose to combine both approaches",
        postSelectionText: `"I think we can go tall _and_ wide. I have some guild contacts who could help enhance the protections." The giant and vedalken are pleasantly surprised. They weren't counting on any support from the guilds, but aren't about to say no to any help they can get. You dare to hope this will improve relations after the invasion.`,
        rewards: [
          { count: 1, query: "https://scryfall.com/search?q=set%3Awar+is%3Abooster+r%3Cr+o%3A%2B1%2F%2B1&unique=cards&as=grid&order=name" },
          { count: 1, query: "https://scryfall.com/search?q=set%3Awar+is%3Abooster+r%3Cr+o%3Aproliferate&unique=cards&as=grid&order=name" },
        ],
        nextEvent: "",
      },
      {
        requiredSelections: [],
        optionLabel: "Side with the giant",
        postSelectionText: `"The zombies are mindless. Best to have the largest protection " The giant roars in agreement. After a while, the vedalken acquiesces.`,
        rewards: [
          { count: 1, query: "https://scryfall.com/search?q=set%3Awar+is%3Abooster+r%3Cr+o%3A%2B1%2F%2B1&unique=cards&as=grid&order=name" },
        ],
        nextEvent: "",
      },
      {
        requiredSelections: [],
        optionLabel: "Side with the vedalken",
        postSelectionText: `"The attackers are erratic. Let's not bet everything on one line of defense." The vedalken tangles six fingers together in agreement. The giant gives you the side eye, but decides not to push the issue.`,
        rewards: [
          { count: 1, query: "https://scryfall.com/search?q=set%3Awar+is%3Abooster+r%3Cr+o%3Aproliferate&unique=cards&as=grid&order=name" },
        ],
        nextEvent: "",
      },
    ],
  },
  {
    mainText: "Even in the middle of a full scale military conflict, the Azorius have posted guardmages outside the entrances to Gnat Alley, the long, tunnel-like street that allows clandestine access to much of the tenth district and beyond. With fighting raging in the streets between Bolas' troops and the local resistance, you desperately need another route. But the sign affixed beside the guardmage says No Passage - Official Guild Business Only.",
    id: "ON_WIN_EVENTS.RAV_HASTE_VIG",
    options: [
      {
        requiredSelections: ["MORAL_CHOICE.LOYAL"],
        optionLabel: "Convince the guardmage that you are on official guild business",
        postSelectionText: `"I assure you I have the proper authorizations. This post is to be abandoned before troops arrive. And you are to escort me through the Alley. Contact the guild headquarters if you require confirmation."

As the guardmage looks over your papers, a cloaked Vedalken appears at your side, whispering "Me too".

"You are to escort me and my associate through the Alley." `,
        rewards: [
          { count: 1, query: "https://scryfall.com/search?q=set%3Awar+is%3Abooster+r%3Cr+o%3Ahaste+t%3Acreature&unique=cards&as=grid&order=name" },
          { count: 1, query: "https://scryfall.com/search?q=set%3Awar+is%3Abooster+r%3Cr+o%3Avigilance+t%3Acreature&unique=cards&as=grid&order=name" },
        ],
        nextEvent: "",
      },
      {
        requiredSelections: [],
        optionLabel: "Seek out a gateway sneak to smuggle you past the guardmage",
        postSelectionText: "You double-back to the side street that brought you to Gnat Alley, looking for the group of cloaked Vedalkens you had seen skulking about earlier. Surely these local rogues know a route past the guard. One agrees to join you, and brings you to a secret passage into the alley. The two of you race into the tunnel-street just as the sound of the incoming army becomes audible in the street outside. ",
        rewards: [
          { count: 1, query: "https://scryfall.com/search?q=set%3Awar+is%3Abooster+r%3Cr+o%3Ahaste+t%3Acreature&unique=cards&as=grid&order=name" },
        ],
        nextEvent: "",
      },
      {
        requiredSelections: [],
        optionLabel: "Plead your case for an exception to the guardmage",
        postSelectionText: `"It is not my place to question the law. I merely enforce it."

"Of course. But the invading army is nearly upon us, and there is no other route out of here. If we wait here, you and I will both be dead within minutes. And then the law will be meaningless."

As the guardmage considers your position, an unsettlingly close explosion shakes the ground. He begrudgingly consents to retreating with you into the alley, and disguising the entrance from the troops.`,
        rewards: [
          { count: 1, query: "https://scryfall.com/search?q=set%3Awar+is%3Abooster+r%3Cr+o%3Avigilance+t%3Acreature&unique=cards&as=grid&order=name" },
        ],
        nextEvent: "",
      },
    ],
  },
  {
    mainText: `You and a few other members of various guilds have ducked into an underground passageway traditionally maintained by the Golgari to avoid a Dreadhorde patrol. It's a labyrinth down here - seemingly endless twists and turns take you to numerous cave-ins and dead ends. You sigh as you reach yet another blockade of boulders.

As you and your makeshift party turn back to search for another exit, the sound of shuffling feet and clanking weapons makes you freeze. It seems the patrol has found your trail. You're quickly running out of time to make a decision, but thankfully a few of your temporary companions have potential solutions to get you out of the situation.`,
    id: "ON_WIN_EVENTS.RAV_SMALL_LARGE",
    options: [
      {
        requiredSelections: ["MORAL_CHOICE.LOYAL"],
        optionLabel: "Escape with the Selesnya summoner while the Gruul berserker holds the patrol off",
        postSelectionText: "Your contacts in the guilds have earned you much respect, and a few members of your ragtag group seem eager to repay you. The berserker turns to face the Dreadhorde patrol, while you and the rest of the guild members quickly follow the summoner to find an alternative exit.",
        rewards: [
          { count: 1, query: "https://scryfall.com/search?q=set%3Awar+is%3Abooster+r%3Cr+t%3Acreature+toughness%3D1&unique=cards&as=grid&order=name" },
          { count: 1, query: "https://scryfall.com/search?q=set%3Awar+is%3Abooster+r%3Cr+t%3Acreature+toughness%3E%3D4&unique=cards&as=grid&order=name" },
        ],
        nextEvent: "",
      },
      {
        requiredSelections: [],
        optionLabel: "Agree with the Selesnya summoner to scout a way ahead",
        postSelectionText: "She nods and conjures a few small rodents and the like to scout an escape route. You and the others quickly and quietly follow, evading detection from the Dreadhorde patrol and emerging unscathed in a nearby basement.",
        rewards: [
          { count: 1, query: "https://scryfall.com/search?q=set%3Awar+is%3Abooster+r%3Cr+t%3Acreature+toughness%3D1&unique=cards&as=grid&order=name" },
        ],
        nextEvent: "",
      },
      {
        requiredSelections: [],
        optionLabel: "Agree with the Gruul berserker to face the patrol head on.",
        postSelectionText: `He smiles and squares his shoulders. "A few zombies never got in my way before!" With a bellow, he charges through the corridors back towards the way you came, barreling directly into the Dreadhorde patrol and knocking them aside. You quickly make your way back out of the passageway before the zombies regain their bearings.`,
        rewards: [
          { count: 1, query: "https://scryfall.com/search?q=set%3Awar+is%3Abooster+r%3Cr+t%3Acreature+toughness%3E%3D4&unique=cards&as=grid&order=name" },
        ],
        nextEvent: "",
      },
    ],
  },
  {
    mainText: `To your surprise, you stumble upon a shop that, despite the ongoing carnage, is clearly still open. The lettering on the portico proclaims "Dancu's on Tin Street - First Rate Artifacts and Enchantments." You are in dire need of some supplies, so you don't hesitate to enter.

An eight feet tall loxodon wearing thick armor sits behind the counter. He is carrying a warhammer, but it looks unused. It looks like he has been successful in warding off the zombies somehow.

"Welcome! Prices are up a little I'm afraid. I'm sure you understand. How can I help you?"

You gnash your teeth and count the zibs and zinos in your purse.`,
    id: "ON_WIN_EVENTS.RAV_ARTIFACT_ENCHANTMENT",
    options: [
      {
        requiredSelections: ["MORAL_CHOICE.LOYAL"],
        optionLabel: "I'll take the lot - the guilds will pay for it",
        postSelectionText: "Dancu frowns, but your papers and up-to-date intelligence convince him of your trustworthiness. After some haggling, you purchase both an artifact and an enchantment spell, paying half now and half later.",
        rewards: [
          { count: 1, query: "https://scryfall.com/search?q=set%3Awar+is%3Abooster+game%3Aarena+t%3Aartifact+r%3Cr" },
          { count: 1, query: "https://scryfall.com/search?q=set%3Awar+is%3Abooster+game%3Aarena+t%3Aenchantment+r%3Cr&unique=cards&as=grid&order=name" },
        ],
        nextEvent: "",
      },
      {
        requiredSelections: [],
        optionLabel: "I'll take an artifact",
        postSelectionText: `"Pleasure doing business with you."

You grimace. Figures like these are everything that's wrong with Ravnica. The new order can only be an improvement. You make a mental note to get back to this shop once Bolas's rule is solidified.`,
        rewards: [
          { count: 1, query: "https://scryfall.com/search?q=set%3Awar+is%3Abooster+game%3Aarena+t%3Aartifact+r%3Cr" },
        ],
        nextEvent: "",
      },
      {
        requiredSelections: [],
        optionLabel: "I'll take an enchantment",
        postSelectionText: `"Pleasure doing business with you."

You grimace. Figures like these are everything that's wrong with Ravnica. The new order can only be an improvement. You make a mental note to get back to this shop once Bolas's rule is solidified.`,
        rewards: [
          { count: 1, query: "https://scryfall.com/search?q=set%3Awar+is%3Abooster+game%3Aarena+t%3Aenchantment+r%3Cr&unique=cards&as=grid&order=name" },
        ],
        nextEvent: "",
      },
    ],
  },
  {
    mainText: `A clandestine meeting with the Izzet? Seems like more of a Dimir thing. Where do they stand in all this anyway? What are you getting yourself into?

The man himself, Ral Zarek. In the backroom of a Tin Street bar?

"I've been instructed to help you."

"Um.. hello? I'm - "

"I know who you are. I've been instructed to help you."

"Instructed? To help me? Do what? By whom?"

"Let's see... Yes, yes, don't know and can't say."

"Well you're not a big help so far."

"Let's change that. What do you need? Something big and flashy? Or something more subtle?"`,
    id: "ON_WIN_EVENTS.BOLAS_CHEAP_EXPENSIVE",
    options: [
      {
        requiredSelections: ["MORAL_CHOICE.BETRAY"],
        optionLabel: "Does the whom happen to be a dragon?",
        postSelectionText: `"You don't look like the type to be mixed up with him."

"Oh no? What type do I look like then?"

"The type who's in way over their head and need all the help they can get." Ral stands and walks out of the room. On the table next to his empty glass, a tiny shimmering sphere and a long cylinder.`,
        rewards: [
          { count: 1, query: "https://scryfall.com/search?q=set%3Awar+is%3Abooster+r%3Cr+%28t%3Ainstant+or+t%3Asorcery%29+mv%3E%3D4&unique=cards&as=grid&order=set" },
          { count: 1, query: "https://scryfall.com/search?q=set%3Awar+is%3Abooster+r%3Cr+%28t%3Ainstant+or+t%3Asorcery%29+mv%3C%3D2&unique=cards&as=grid&order=set" },
        ],
        nextEvent: "",
      },
      {
        requiredSelections: [],
        optionLabel: "I definitely could use something big",
        postSelectionText: `"Done." Ral stands and walks out of the room. On the table next to his empty glass, a long cylinder, glowing slightly and vibrating from whatever spell it was barely containing.`,
        rewards: [
          { count: 1, query: "https://scryfall.com/search?q=set%3Awar+is%3Abooster+r%3Cr+%28t%3Ainstant+or+t%3Asorcery%29+mv%3E%3D4&unique=cards&as=grid&order=set" },
        ],
        nextEvent: "",
      },
      {
        requiredSelections: [],
        optionLabel: "I could use something a bit refined.",
        postSelectionText: `"Done." Ral stands and walks out of the room. On the table next to his empty glass, a tiny shimmering sphere lit from within by whatever tiny spell it contained.`,
        rewards: [
          { count: 1, query: "https://scryfall.com/search?q=set%3Awar+is%3Abooster+r%3Cr+%28t%3Ainstant+or+t%3Asorcery%29+mv%3C%3D2&unique=cards&as=grid&order=set" },
        ],
        nextEvent: "",
      },
    ],
  },
  {
    mainText: `This morning, you awoke to Bolas' zombie army marching down your street. This morning you watched from your window as they attacked your neighbours. As your best friend ran out to intervene. As they struck her down. There on the cobblestones. Where the two of you played as children.

Heedless of your safety, you race into the street. You found yourself carrying her body, light and lifeless as a dead canary, through the streets. Past ranks of passing soldiers. Sobbing. Trying desperately, erratically to do … something.

And now, hours later,. you see her. The necromancer. The famous planeswalker. The commander of Bolas' invasion. "SAVE HER. SAVE MY FRIEND" you scream past her entourage.

She turns serenely, hearing your plea over the din of the surrounding carnage. She stares long and hard at you. At the weight you carry. Her eyes sad but cold. And she speaks directly to you, above the noise and at some distance but somehow without raising her voice or disrupting her calm: "I can bring her back."

Her offer is exactly what you want to hear. And yet somehow it brings no relief.`,
    id: "ON_WIN_EVENTS.BOLAS_ZOMBIE_AMASS",
    options: [
      {
        requiredSelections: ["MORAL_CHOICE.BETRAY"],
        optionLabel: "I wish to call in a debt owed by your master",
        postSelectionText: "An hour later you return home, escorted by a soldier and your oldest friend. Whatever capital you had with this new regime was spent. And then some. But it was all worth it, everything was worth it.",
        rewards: [
          { count: 1, query: "https://scryfall.com/search?q=set%3Awar+is%3Abooster+r%3Cr+t%3Azombie+-o%3Aamass&unique=cards&as=grid&order=set" },
          { count: 1, query: "https://scryfall.com/search?q=set%3Awar+is%3Abooster+r%3Cr+-t%3Azombie+o%3Aamass+-t%3Aplaneswalker&unique=cards&as=grid&order=set" },
        ],
        nextEvent: "",
      },
      {
        requiredSelections: [],
        optionLabel: "At what cost?",
        postSelectionText: `"You are in no position to negotiate."

"I just want her back…" you collapse in tears, dropping your friend's body into the street.

Something visibly shifts in Liliana's frozen visage. She sighs inaudibly and snaps her fingers. The next thing you feel is a cold embrace, a hand running through your hair. "Shh. It's okay."`,
        rewards: [
          { count: 1, query: "https://scryfall.com/search?q=set%3Awar+is%3Abooster+r%3Cr+t%3Azombie+-o%3Aamass&unique=cards&as=grid&order=set" },
        ],
        nextEvent: "",
      },
      {
        requiredSelections: [],
        optionLabel: "Yes. Please. Bring her back to life",
        postSelectionText: "Liliana Vess raises her hands and the power vested in her by the Dragon-God, the power that harnesses her Dreadhorde, flows visibly through them. It bathes you and your childhood friend in a purple glow, and you feel her begin to stir in your arms. She stands and, without looking back at you, walks to Liliana and falls lockstep into her cadre.",
        rewards: [
          { count: 1, query: "https://scryfall.com/search?q=set%3Awar+is%3Abooster+r%3Cr+-t%3Azombie+o%3Aamass+-t%3Aplaneswalker&unique=cards&as=grid&order=set" },
        ],
        nextEvent: "",
      },
    ],
  },
  {
    mainText: `"This is a once in a lifetime opportunity. And yet, you don't seem especially grateful."

You force yourself to wipe the look of surprise and horror off your face, "It's an honor, sir."

"More than you know. But still, you hesitate."

You watch the metal hand of the metal arm of the mostly metal man in front of you as it skitters seemingly autonomously across a tray of foreign-looking surgical instruments, searching. Though his stare never leaves your face.

You had come here looking for the artificer who people said was offering free enhancements.Useful upgrades that might help you survive the war. Whatever you were expecting, it wasn't this menacing half-man. Who bears the unmistakable mark of Nicol Bolas on his brow.

"So what will it be?" The hand found a saw.`,
    id: "ON_WIN_EVENTS.BOLAS_HUMAN_NONHUMAN",
    options: [
      {
        requiredSelections: ["MORAL_CHOICE.BETRAY"],
        optionLabel: "I believe we serve the same master. What can you offer a brother in arms?",
        postSelectionText: `"I have no master," the hand wandered from the saw, "but I welcome new allies. You may retain your human form and I will grant you one of my creations to serve you in our common cause."`,
        rewards: [
          { count: 1, query: "https://scryfall.com/search?q=set%3Awar+is%3Abooster+t%3Ahuman+r%3Cr+game%3Aarena&unique=cards&as=grid&order=name" },
          { count: 1, query: "https://scryfall.com/search?q=set%3Awar+is%3Abooster+t%3Acreature+-t%3Ahuman+r%3Cr+game%3Aarena&unique=cards&as=grid&order=name" },
        ],
        nextEvent: "",
      },
      {
        requiredSelections: [],
        optionLabel: "I'm sorry, I think there's been a mix up. I'll be on my way",
        postSelectionText: `"So be it, retain your pathetic, natural human form. No enhancement could save you from what's coming anyway."`,
        rewards: [
          { count: 1, query: "https://scryfall.com/search?q=set%3Awar+is%3Abooster+t%3Ahuman+r%3Cr+game%3Aarena&unique=cards&as=grid&order=name" },
        ],
        nextEvent: "",
      },
      {
        requiredSelections: [],
        optionLabel: "Give me the enhancements",
        postSelectionText: `Before the words escaped your mouth, you could hear the high-pitched whine of the saw begin.

"Excellent. Have a seat. You have come to me as a man. But you will leave me as something entirely better."`,
        rewards: [
          { count: 1, query: "https://scryfall.com/search?q=set%3Awar+is%3Abooster+t%3Acreature+-t%3Ahuman+r%3Cr+game%3Aarena&unique=cards&as=grid&order=name" },
        ],
        nextEvent: "",
      },
    ],
  },
  {
    mainText: `Ever since the invasion started, these Tin Street bars were somehow more full than ever. You'd think people would have more important things to do during a war. Or, if not, they'd stay home.

Unlike the other patrons, you are here on important war-related business. You need to recruit some help. Maybe some muscle, you think as your eyes alight on a sturdy fellow sat at the bar. Or maybe someone who could slip past some guardmages, you think as you see his goblin friend. `,
    id: "ON_WIN_EVENTS.BOLAS_HIGH_LOW_POWER",
    options: [
      {
        requiredSelections: ["MORAL_CHOICE.BETRAY"],
        optionLabel: "Hire 'em both",
        postSelectionText: `You approach the gentlemen sat at the bar. "I need you guys to come with me. I've got work for you."

You receive the same vaguely offended look from both, but you flash a handful of the Platinum 100-zino coins that had mysteriously arrived for you earlier in the week. And all is forgiven. `,
        rewards: [
          { count: 1, query: "https://scryfall.com/search?q=set%3Awar+is%3Abooster+t%3Acreature+power%3E%3D4+r%3Cr+game%3Aarena&unique=cards&as=grid&order=name" },
          { count: 1, query: "https://scryfall.com/search?q=set%3Awar+is%3Abooster+t%3Acreature+power%3C%3D1+r%3Cr+game%3Aarena&unique=cards&as=grid&order=name" },
        ],
        nextEvent: "",
      },
      {
        requiredSelections: [],
        optionLabel: "Hire the big guy",
        postSelectionText: `You approach the larger gentleman sat at the bar. "Hey big fella, looking for work?"

"What kind of work?"

"That sounds like a yes. Come on, I'll explain on the way."`,
        rewards: [
          { count: 1, query: "https://scryfall.com/search?q=set%3Awar+is%3Abooster+t%3Acreature+power%3E%3D4+r%3Cr+game%3Aarena&unique=cards&as=grid&order=name" },
        ],
        nextEvent: "",
      },
      {
        requiredSelections: [],
        optionLabel: "Hire the goblin",
        postSelectionText: `You approach the smaller gentleman sat at the bar. "Hello friend, you looking for work?"

"I am" says his burly friend.

"Sorry, can't afford the two of you. And right now I need someone who can squeeze into small spaces."

The goblin grumbled something that sounded vaguely like "I'm listening"`,
        rewards: [
          { count: 1, query: "https://scryfall.com/search?q=set%3Awar+is%3Abooster+t%3Acreature+power%3C%3D1+r%3Cr+game%3Aarena&unique=cards&as=grid&order=name" },
        ],
        nextEvent: "",
      },
    ],
  },
  {
    mainText: `The murmuring mystic was really living up to his name. You find him in an evacuated sector, sitting legs crossed in the center of a battle-scorched courtyard, alone except the hundred plus birds perched on and around his still and silent body. You hesitate to interrupt his trance, but you are looking for a particular spell and the mystic knows more spells than anyone.

You explain about the spell you need, but his responses are cryptic and barely audible. He says something about "the spell you need" and "the spell you find" and "the fates contained within take flight". As he speaks, he raises his arms up and straight out from his body and two birds separate from his massive flock, landing one apiece in his face up palms. The bird in the right hand is actively moving, while the bird in the left hand seems to be in deep rest.

You see now that the birds are translucent, not fauna at all but machinations of pure light and magic. Embodied spells given flight. You reach out towards…`,
    id: "ON_WIN_EVENTS.BOLAS_INSTANT_SORCERY",
    options: [
      {
        requiredSelections: ["MORAL_CHOICE.BETRAY"],
        optionLabel: "... a kestral kiting in place just above the Mystic",
        postSelectionText: "A bird in flight above the mystic catches your eye with its piercing stare. It calls to you without a word. As your fingers pass through the illusory avian, you feel immediately that it is overflowing with magic. The spells within imprint on your outstretched fingers.",
        rewards: [
          { count: 1, query: "https://scryfall.com/search?q=set%3Awar+is%3Abooster+t%3Ainstant+r%3Cr+game%3Aarena&unique=cards&as=grid&order=name" },
          { count: 1, query: "https://scryfall.com/search?q=set%3Awar+is%3Abooster+t%3Asorcery+r%3Cr+game%3Aarena&unique=cards&as=grid&order=name" },
        ],
        nextEvent: "",
      },
      {
        requiredSelections: [],
        optionLabel: "...the bird in the mystic's right hand",
        postSelectionText: "You take a deep breath and make a choice at random, reaching out towards the bird in the mystic's right hand. Your fingers pass through its small body and immediately you feel the bird-spell's speed and agility as its magic courses into your body.",
        rewards: [
          { count: 1, query: "https://scryfall.com/search?q=set%3Awar+is%3Abooster+t%3Ainstant+r%3Cr+game%3Aarena&unique=cards&as=grid&order=name" },
        ],
        nextEvent: "",
      },
      {
        requiredSelections: [],
        optionLabel: "...the bird in the mystic's left hand",
        postSelectionText: "You take a deep breath and make a choice at random, reaching out towards the bird in the mystic's left hand. Your fingers pass through its small body and immediately you feel the bird-spell's power as its magic courses into your body.",
        rewards: [
          { count: 1, query: "https://scryfall.com/search?q=set%3Awar+is%3Abooster+t%3Asorcery+r%3Cr+game%3Aarena&unique=cards&as=grid&order=name" },
        ],
        nextEvent: "",
      },
    ],
  },
];
