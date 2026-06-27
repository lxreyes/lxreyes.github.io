/* ============================================================
   data.js — CONTENT for THE GAUNTLET, a hyperlinked
   choose-your-adventure slide deck in the style of a chaotic
   game show. Each SLIDE has a drawn illustration (img id, art in
   ui.js), the Host's narration, and choices that JUMP to other
   slides. Earn 🪙 coins, dodge traps, sabotage rivals, find the
   🔑 key (or buy it), and escape.
   ============================================================ */

(function () {
  "use strict";

  const AVATARS = ["🦊", "🐸", "🤖", "👽", "🐙", "🦄", "🐲", "🦝", "🐼", "🦖", "🐧", "🦅"];

  const CONTESTANTS = [
    { name: "PixelPaul", avatar: "🎮" }, { name: "NoScopeNancy", avatar: "🎯" },
    { name: "LaggyLarry", avatar: "🐌" }, { name: "RageQuitRick", avatar: "😤" },
    { name: "TryhardTina", avatar: "🦾" }, { name: "AFK-Art", avatar: "😴" },
    { name: "ClickbaitKlara", avatar: "📸" }, { name: "DiceGoblinDan", avatar: "🎲" },
  ];

  const WHEEL = [
    { label: "+1 ❤️", life: 1, text: "The wheel smiles — gain a life!", good: true },
    { label: "−1 ❤️", life: -1, text: "Ouch. Lose a life.", good: false },
    { label: "+5 🪙", coins: 5, text: "Coins rain down! +5.", good: true },
    { label: "😖", suffer: true, text: "A Suffering Point. Delicious.", good: false },
    { label: "JACKPOT", life: 2, text: "JACKPOT — gain TWO lives!", good: true },
    { label: "💀 OUT", kill: true, text: "It lands on the SKULL. Instant elimination!", good: false },
    { label: "😈 RIVAL", eliminateRival: true, text: "A RIVAL is yanked off-stage. ELIMINATED!", good: true },
    { label: "🍀 SAFE", text: "Safe… this time.", good: true },
  ];

  const HOST = {
    greet: ["Welcome to THE GAUNTLET — choose your own doom!", "Pick a path, contestant. They're all bad. That's the fun.", "Lights, camera, CHOICES! Let's ruin your day."],
    good: ["Booo, you survived.", "Lucky. For now.", "Hmph. Keep moving."],
    bad: ["HA! Magnificent.", "The audience LOVES this.", "Oof. Painful. Again!"],
    eliminations: ["{who} chose poorly. ELIMINATED!", "{who} is dragged offstage. ELIMINATED!", "{who} ragequits. ELIMINATED!"],
    win: ["You ESCAPED THE GAUNTLET?! Ugh. Champion. The audience is furious.", "A survivor! I hate it. Take the crown."],
    lose: ["And you're OUT! Give it up for our eliminated contestant!", "Game over! The Host always wins eventually."],
  };

  /* ---------- The slide deck ----------
     img = illustration id (drawn in ui.js IMAGES).
     Slide effects on ENTER: life:+/-n · coins:+/-n · suffer · eliminateRival · set:"flag" · win · kill.
     Choices may have: requires:"flag" (gate) or cost:n (coins to spend).
  */
  const SLIDES = {
    start: {
      img: "gate", host: "Welcome to THE GAUNTLET! Three paths. All terrible. CHOOSE.",
      text: "You stand at the entrance of the studio maze.",
      choices: [
        { label: "🕳️ The Dark Hallway", goto: "hall" },
        { label: "🌉 The Rickety Bridge", goto: "bridge" },
        { label: "👺 The Goblin Market", goto: "market" },
      ],
    },

    /* --- opening branches --- */
    hall: {
      img: "doors", host: "Four doors. ONE is safe. Probably. Pick!",
      text: "The hallway ends in four identical doors.",
      choices: [
        { label: "The creaky door", goto: "hallSafe" },
        { label: "The golden door", goto: "hallTrap" },
        { label: "The iron door", goto: "hallDoom" },
        { label: "The tiny door", goto: "hallCoins" },
      ],
    },
    hallSafe: { img: "signpost", host: "Booo, you picked right.", text: "A quiet corridor opens up.", choices: [{ label: "Onward →", goto: "crossroads" }] },
    hallTrap: { img: "spikes", life: -1, host: "SPIKES! The crowd cheers.", text: "Wrong door. Lose a life, stagger through.", choices: [{ label: "Limp onward →", goto: "crossroads" }] },
    hallCoins: { img: "coin", coins: 4, host: "Ooh, free money. I'll regret this.", text: "A pile of coins behind the tiny door! +4 🪙.", choices: [{ label: "Pocket it →", goto: "crossroads" }] },
    hallDoom: { img: "trapdoor", kill: true, host: "A TRAPDOOR! Spectacular!", text: "The floor vanishes. Down you go.", choices: [] },

    bridge: {
      img: "bridge", host: "A rickety bridge over very real lava. Cross it.",
      text: "The planks creak. Lava bubbles below.",
      choices: [
        { label: "🤫 Tiptoe carefully", goto: "bridgeSafe" },
        { label: "🏃 Sprint across", goto: "bridgeRun" },
        { label: "✂️ Cut the rope behind you", goto: "bridgeCut" },
      ],
    },
    bridgeSafe: { img: "signpost", host: "Slow and alive. Boring.", text: "You inch across without a scratch.", choices: [{ label: "Onward →", goto: "crossroads" }] },
    bridgeRun: { img: "bridge", life: -1, host: "WOBBLE! That's a life.", text: "You make it, singed. Lose a life.", choices: [{ label: "Onward →", goto: "crossroads" }] },
    bridgeCut: { img: "lavafall", eliminateRival: true, host: "DEVIOUS! The audience GASPS.", text: "You cut the rope — a rival plunges into the lava!", choices: [{ label: "Onward →", goto: "crossroads" }] },

    market: {
      img: "goblin", host: "The Goblin Market! Everything's a scam.",
      text: "A goblin grins behind a stall of dubious wares.",
      choices: [
        { label: "🧪 Buy the mystery potion", goto: "marketPotion" },
        { label: "🗣️ Haggle aggressively", goto: "marketHaggle" },
        { label: "🦝 Rob the goblin", goto: "marketRob" },
      ],
    },
    marketPotion: { img: "potion", life: 1, host: "It's… actually good?! Outrageous.", text: "Tastes like victory. +1 life!", choices: [{ label: "Onward →", goto: "crossroads" }] },
    marketHaggle: { img: "goblin", coins: 5, host: "Fine, FINE, take the coins, you menace.", text: "You out-yell the goblin. +5 🪙.", choices: [{ label: "Onward →", goto: "crossroads" }] },
    marketRob: { img: "goblin", life: -1, host: "He BIT you. Ha!", text: "Crime doesn't pay. Lose a life.", choices: [{ label: "Onward →", goto: "crossroads" }] },

    /* --- the hub --- */
    crossroads: {
      img: "signpost", host: "The CROSSROADS. Wander wherever you like — or face the Final Door.",
      text: "Signposts point in every direction. Where to?",
      choices: [
        { label: "🎡 Wheel Room", goto: "wheelroom" },
        { label: "👹 Monster Pit", goto: "monster" },
        { label: "🧰 The Vault", goto: "vault" },
        { label: "🎰 The Casino", goto: "casino" },
        { label: "🛒 The Black Market", goto: "shop" },
        { label: "🗳️ The Voting Booth", goto: "voting" },
        { label: "🧠 The Trivia Stage", goto: "trivia1" },
        { label: "📺 Sponsor Break", goto: "sponsor" },
        { label: "🚪 The Final Door 🔑", goto: "finale", requires: "key" },
        { label: "🎟️ Sneak Backstage (VIP)", goto: "secret", requires: "vip" },
        { label: "🔙 Back to the start", goto: "start" },
      ],
    },

    wheelroom: {
      img: "wheel", host: "The WHEEL OF FATE! No skill. No mercy. Spin it.",
      text: "A giant wheel looms, ticking ominously.",
      choices: [{ label: "🎡 SPIN THE WHEEL", goto: "crossroads", wheel: true }],
    },

    monster: {
      img: "monster", host: "A monster guards a shiny KEY. How brave are you?",
      text: "Something enormous snores atop a glinting key.",
      choices: [
        { label: "⚔️ Fight it for the key", goto: "monsterWin" },
        { label: "🥷 Sneak past (grab some coins)", goto: "monsterSneak" },
        { label: "🤾 Throw a rival at it", goto: "monsterThrow" },
      ],
    },
    monsterWin: { img: "key", set: "key", host: "A hero! Disgusting. Have a key.", text: "You best the beast and snatch the KEY! 🔑", choices: [{ label: "Onward →", goto: "crossroads" }] },
    monsterSneak: { img: "coin", coins: 6, host: "Sneaky. Cowardly. I respect it.", text: "You tiptoe past and swipe 6 🪙 from its hoard.", choices: [{ label: "Onward →", goto: "crossroads" }] },
    monsterThrow: { img: "key", eliminateRival: true, set: "key", host: "Teamwork! For you. Not them.", text: "You hurl a rival at the beast (ELIMINATED) and grab the KEY.", choices: [{ label: "Onward →", goto: "crossroads" }] },

    vault: {
      img: "chests", host: "Three chests. One hides a key. The others… regret.",
      text: "Three identical chests sit in a dusty vault.",
      choices: [
        { label: "Left chest", goto: "vaultKey" },
        { label: "Middle chest", goto: "vaultTrap" },
        { label: "Right chest", goto: "vaultEmpty" },
      ],
    },
    vaultKey: { img: "key", set: "key", host: "Lucky guess. Boo.", text: "A KEY! 🔑 The Final Door awaits.", choices: [{ label: "Onward →", goto: "crossroads" }] },
    vaultTrap: { img: "spikes", life: -1, host: "A mimic! Classic.", text: "The chest bites back. Lose a life.", choices: [{ label: "Onward →", goto: "crossroads" }] },
    vaultEmpty: { img: "coin", coins: 3, host: "Empty… except for loose change.", text: "Cobwebs and 3 🪙. Take the consolation prize.", choices: [{ label: "Onward →", goto: "crossroads" }] },

    /* --- casino --- */
    casino: {
      img: "casino", host: "The Casino! The house always wins. (I'm the house.)",
      text: "Slot machines whir and clatter.",
      choices: [
        { label: "💰 Cash a free chip (+3 🪙)", goto: "casinoCash" },
        { label: "🎡 Double-or-nothing — SPIN!", goto: "crossroads", wheel: true },
      ],
    },
    casinoCash: { img: "coin", coins: 3, host: "Don't spend it all at once.", text: "A complimentary chip. +3 🪙.", choices: [{ label: "Onward →", goto: "crossroads" }] },

    /* --- the shop (spend coins) --- */
    shop: {
      img: "shop", host: "The Black Market. Everything's for sale — even cheating.",
      text: "A shady vendor lays out wares. (You have coins — check the top bar.)",
      choices: [
        { label: "❤️ Buy a life — 8 🪙", goto: "shopLife", cost: 8 },
        { label: "🔑 Buy the key — 10 🪙", goto: "shopKey", cost: 10 },
        { label: "🎟️ Buy a VIP pass — 12 🪙", goto: "shopVip", cost: 12 },
        { label: "😈 Bribe to oust a rival — 6 🪙", goto: "shopBribe", cost: 6 },
        { label: "🔙 Leave empty-handed", goto: "crossroads" },
      ],
    },
    shopLife: { img: "potion", life: 1, host: "Cha-ching. Pleasure doing business.", text: "You buy a fresh life. +1 ❤️.", choices: [{ label: "Onward →", goto: "crossroads" }] },
    shopKey: { img: "key", set: "key", host: "Buying your way to the finale? Bold.", text: "The vendor slides you a KEY. 🔑", choices: [{ label: "Onward →", goto: "crossroads" }] },
    shopVip: { img: "vip", set: "vip", host: "A VIP pass?! There's a secret way out, you know…", text: "You pocket a glittering VIP BACKSTAGE PASS. 🎟️", choices: [{ label: "Onward →", goto: "crossroads" }] },
    shopBribe: { img: "voting", eliminateRival: true, host: "Corruption! My favorite.", text: "A few coins later, a rival is mysteriously ELIMINATED.", choices: [{ label: "Onward →", goto: "crossroads" }] },

    /* --- voting booth (sabotage) --- */
    voting: {
      img: "voting", host: "The VOTING BOOTH! Rat out a fellow contestant.",
      text: "A ballot box waits, ominously.",
      choices: [
        { label: "🗳️ Vote to eliminate a rival", goto: "voteOut" },
        { label: "😇 Abstain (so noble, so boring)", goto: "crossroads" },
      ],
    },
    voteOut: { img: "voting", eliminateRival: true, host: "Democracy in action! Cruel, cruel democracy.", text: "The votes are in — a rival is ELIMINATED!", choices: [{ label: "Onward →", goto: "crossroads" }] },

    /* --- trivia stage (earn coins, risk lives) --- */
    trivia1: {
      img: "trivia", host: "QUIZ TIME! Wrong answers cost a life. No pressure.",
      text: "How many sides does a hexagon have?",
      choices: [
        { label: "5", goto: "triviaWrong" },
        { label: "6", goto: "triviaRight" },
        { label: "7", goto: "triviaWrong" },
        { label: "8", goto: "triviaWrong" },
      ],
    },
    triviaRight: {
      img: "coin", coins: 5, host: "Correct?! Boo. Take your coins.",
      text: "Right! +5 🪙. Press your luck for a harder one?",
      choices: [
        { label: "🧠 Risk it — harder question", goto: "trivia2" },
        { label: "🏦 Bank it →", goto: "crossroads" },
      ],
    },
    trivia2: {
      img: "trivia", host: "Double-or-nothing brains. Go.",
      text: "What is 9 × 6?",
      choices: [
        { label: "54", goto: "triviaBig" },
        { label: "56", goto: "triviaWrong" },
        { label: "45", goto: "triviaWrong" },
        { label: "63", goto: "triviaWrong" },
      ],
    },
    triviaBig: { img: "coin", coins: 8, host: "A genius. How annoying.", text: "Correct! A big +8 🪙 payout.", choices: [{ label: "Onward →", goto: "crossroads" }] },
    triviaWrong: { img: "spikes", life: -1, host: "WRONG! The buzzer of doom.", text: "Incorrect. Lose a life.", choices: [{ label: "Onward →", goto: "crossroads" }] },

    /* --- sponsor break --- */
    sponsor: {
      img: "sponsor", host: "And now, a word from our SPONSOR!",
      text: "An obnoxious jingle blares.",
      choices: [
        { label: "📺 Watch the whole ad (+4 🪙)", goto: "sponsorPaid" },
        { label: "🙅 Skip it (the Host is offended)", goto: "sponsorSkip" },
      ],
    },
    sponsorPaid: { img: "coin", coins: 4, host: "Engagement! The advertisers love you.", text: "You suffer through the ad. +4 🪙.", choices: [{ label: "Onward →", goto: "crossroads" }] },
    sponsorSkip: { img: "trivia", suffer: true, host: "How DARE you skip the sponsor.", text: "The Host glares. A Suffering Point.", choices: [{ label: "Onward →", goto: "crossroads" }] },

    /* --- endings --- */
    finale: {
      img: "doors", host: "THE FINAL DOOR. Freedom or doom. How do you open it?",
      text: "A huge door hums with menace. You grip your key.",
      choices: [
        { label: "🗝️ Unlock it with the key", goto: "champion" },
        { label: "🚪 Knock politely", goto: "champion" },
        { label: "💪 Smash it open instead", goto: "finaleBoom" },
      ],
    },
    champion: { img: "trophy", win: true, host: "", text: "The door opens to daylight. You step out — alive!", choices: [] },
    finaleBoom: { img: "skull", kill: true, host: "", text: "It was rigged. Of course it was. KABOOM.", choices: [] },
    secret: { img: "trophy", win: true, host: "", text: "Your VIP pass opens a hidden backstage exit. You stroll out as the AUDIENCE FAVORITE — no Final Door required!", choices: [] },
  };

  window.GameData = { AVATARS, CONTESTANTS, WHEEL, HOST, SLIDES, START: "start" };
})();
