// Emoji shortcodes for the chat composer — type `:smile` to autocomplete, or a
// full `:smile:` to auto-convert. A curated (not exhaustive) set of the common
// shortcodes people actually reach for in chat, kept small so it stays in-bundle
// with no dependency. Multiple codes may map to the same glyph (aliases).

export const EMOJI: Record<string, string> = {
  // Smileys & emotion
  smile: '😄', smiley: '😃', grin: '😁', grinning: '😀', laughing: '😆', satisfied: '😆',
  sweat_smile: '😅', rofl: '🤣', joy: '😂', slightly_smiling_face: '🙂', upside_down_face: '🙃',
  wink: '😉', blush: '😊', innocent: '😇', smiling_face_with_three_hearts: '🥰', heart_eyes: '😍',
  star_struck: '🤩', kissing_heart: '😘', kissing: '😗', kissing_closed_eyes: '😚',
  yum: '😋', stuck_out_tongue: '😛', stuck_out_tongue_winking_eye: '😜', zany_face: '🤪',
  stuck_out_tongue_closed_eyes: '😝', money_mouth_face: '🤑', hugs: '🤗', hand_over_mouth: '🤭',
  shushing_face: '🤫', thinking: '🤔', zipper_mouth_face: '🤐', raised_eyebrow: '🤨',
  neutral_face: '😐', expressionless: '😑', no_mouth: '😶', smirk: '😏', unamused: '😒',
  roll_eyes: '🙄', grimacing: '😬', lying_face: '🤥', relieved: '😌', pensive: '😔',
  sleepy: '😪', drooling_face: '🤤', sleeping: '😴', mask: '😷', face_with_thermometer: '🤒',
  face_with_head_bandage: '🤕', nauseated_face: '🤢', vomiting_face: '🤮', sneezing_face: '🤧',
  hot_face: '🥵', cold_face: '🥶', woozy_face: '🥴', dizzy_face: '😵', exploding_head: '🤯',
  cowboy_hat_face: '🤠', partying_face: '🥳', sunglasses: '😎', nerd_face: '🤓', monocle_face: '🧐',
  confused: '😕', worried: '😟', slightly_frowning_face: '🙁', frowning_face: '☹️',
  open_mouth: '😮', hushed: '😯', astonished: '😲', flushed: '😳', pleading_face: '🥺',
  frowning: '😦', anguished: '😧', fearful: '😨', cold_sweat: '😰', disappointed_relieved: '😥',
  cry: '😢', sob: '😭', scream: '😱', confounded: '😖', persevere: '😣', disappointed: '😞',
  sweat: '😓', weary: '😩', tired_face: '😫', yawning_face: '🥱', triumph: '😤',
  rage: '😡', pout: '😡', angry: '😠', cursing_face: '🤬', smiling_imp: '😈', imp: '👿',
  skull: '💀', skull_and_crossbones: '☠️', poop: '💩', hankey: '💩', clown_face: '🤡',
  ghost: '👻', alien: '👽', robot: '🤖', jack_o_lantern: '🎃',

  // Gestures & body
  wave: '👋', raised_back_of_hand: '🤚', raised_hand: '✋', vulcan_salute: '🖖', ok_hand: '👌',
  pinching_hand: '🤏', v: '✌️', crossed_fingers: '🤞', love_you_gesture: '🤟', metal: '🤘',
  call_me_hand: '🤙', point_left: '👈', point_right: '👉', point_up_2: '👆', point_down: '👇',
  point_up: '☝️', thumbsup: '👍', '+1': '👍', thumbsdown: '👎', '-1': '👎', fist: '✊',
  facepunch: '👊', punch: '👊', fist_left: '🤛', fist_right: '🤜', clap: '👏', raised_hands: '🙌',
  open_hands: '👐', palms_up_together: '🤲', handshake: '🤝', pray: '🙏', writing_hand: '✍️',
  nail_care: '💅', selfie: '🤳', muscle: '💪', leg: '🦵', foot: '🦶', ear: '👂', nose: '👃',
  brain: '🧠', eyes: '👀', eye: '👁️', tongue: '👅', lips: '👄',

  // People & emotion
  baby: '👶', child: '🧒', boy: '👦', girl: '👧', adult: '🧑', man: '👨', woman: '👩',
  older_adult: '🧓', old_man: '👴', old_woman: '👵', person_frowning: '🙍', person_pouting: '🙎',
  no_good: '🙅', ok_woman: '🙆', information_desk_person: '💁', raising_hand: '🙋',
  bow: '🙇', face_palm: '🤦', shrug: '🤷', cop: '👮', guard: '💂', detective: '🕵️',
  ninja: '🥷', construction_worker: '👷', prince: '🤴', princess: '👸', superhero: '🦸',
  supervillain: '🦹', mage: '🧙', fairy: '🧚', vampire: '🧛', merperson: '🧜', elf: '🧝',
  genie: '🧞', zombie: '🧟', massage: '💆', haircut: '💇', walking: '🚶', running: '🏃',
  dancer: '💃', man_dancing: '🕺', people_hugging: '🫂', family: '👪',

  // Hearts & symbols
  heart: '❤️', orange_heart: '🧡', yellow_heart: '💛', green_heart: '💚', blue_heart: '💙',
  purple_heart: '💜', black_heart: '🖤', white_heart: '🤍', brown_heart: '🤎', broken_heart: '💔',
  heavy_heart_exclamation: '❣️', two_hearts: '💕', revolving_hearts: '💞', heartbeat: '💓',
  heartpulse: '💗', sparkling_heart: '💖', cupid: '💘', gift_heart: '💝', heart_decoration: '💟',
  peace_symbol: '☮️', anger: '💢', boom: '💥', collision: '💥', dizzy: '💫', sweat_drops: '💦',
  dash: '💨', hole: '🕳️', speech_balloon: '💬', thought_balloon: '💭', zzz: '💤',
  100: '💯', hundred: '💯', check: '✔️', heavy_check_mark: '✔️', white_check_mark: '✅',
  ballot_box_with_check: '☑️', x: '❌', negative_squared_cross_mark: '❎', heavy_multiplication_x: '✖️',
  warning: '⚠️', exclamation: '❗', grey_exclamation: '❕', question: '❓', grey_question: '❔',
  bangbang: '‼️', interrobang: '⁉️', no_entry: '⛔', no_entry_sign: '🚫', prohibited: '🚫',

  // Nature & animals
  dog: '🐶', cat: '🐱', mouse: '🐭', hamster: '🐹', rabbit: '🐰', fox_face: '🦊', bear: '🐻',
  panda_face: '🐼', koala: '🐨', tiger: '🐯', lion: '🦁', cow: '🐮', pig: '🐷', frog: '🐸',
  monkey_face: '🐵', see_no_evil: '🙈', hear_no_evil: '🙉', speak_no_evil: '🙊', monkey: '🐒',
  chicken: '🐔', penguin: '🐧', bird: '🐦', baby_chick: '🐤', hatching_chick: '🐣', duck: '🦆',
  eagle: '🦅', owl: '🦉', bat: '🦇', wolf: '🐺', boar: '🐗', horse: '🐴', unicorn: '🦄',
  bee: '🐝', honeybee: '🐝', bug: '🐛', butterfly: '🦋', snail: '🐌', beetle: '🐞', ant: '🐜',
  spider: '🕷️', scorpion: '🦂', turtle: '🐢', snake: '🐍', lizard: '🦎', dinosaur: '🦕',
  octopus: '🐙', squid: '🦑', shrimp: '🦐', fish: '🐟', tropical_fish: '🐠', blowfish: '🐡',
  dolphin: '🐬', whale: '🐳', shark: '🦈', crocodile: '🐊', elephant: '🐘', rhinoceros: '🦏',
  hippopotamus: '🦛', camel: '🐫', giraffe: '🦒', kangaroo: '🦘', sheep: '🐑', goat: '🐐',
  deer: '🦌', dromedary_camel: '🐪', llama: '🦙', hedgehog: '🦔', paw_prints: '🐾',
  dragon: '🐉', cactus: '🌵', evergreen_tree: '🌲', deciduous_tree: '🌳', palm_tree: '🌴',
  seedling: '🌱', herb: '🌿', four_leaf_clover: '🍀', bamboo: '🎋', maple_leaf: '🍁',
  fallen_leaf: '🍂', leaves: '🍃', mushroom: '🍄', shell: '🐚', rose: '🌹', wilted_flower: '🥀',
  hibiscus: '🌺', sunflower: '🌻', blossom: '🌼', tulip: '🌷', bouquet: '💐', cherry_blossom: '🌸',

  // Sky & weather
  sunny: '☀️', sun: '☀️', partly_sunny: '⛅', cloud: '☁️', rainbow: '🌈', umbrella: '☔',
  zap: '⚡', snowflake: '❄️', snowman: '⛄', fire: '🔥', droplet: '💧', ocean: '🌊',
  star: '⭐', star2: '🌟', sparkles: '✨', dizzy_star: '💫', comet: '☄️', crescent_moon: '🌙',
  full_moon: '🌕', new_moon: '🌑', earth_africa: '🌍', earth_americas: '🌎', earth_asia: '🌏',
  moon: '🌙', sunrise: '🌅', night_with_stars: '🌃', milky_way: '🌌', tornado: '🌪️',

  // Food & drink
  apple: '🍎', green_apple: '🍏', pear: '🍐', tangerine: '🍊', lemon: '🍋', banana: '🍌',
  watermelon: '🍉', grapes: '🍇', strawberry: '🍓', melon: '🍈', cherries: '🍒', peach: '🍑',
  mango: '🥭', pineapple: '🍍', coconut: '🥥', kiwi_fruit: '🥝', tomato: '🍅', eggplant: '🍆',
  avocado: '🥑', broccoli: '🥦', cucumber: '🥒', hot_pepper: '🌶️', corn: '🌽', carrot: '🥕',
  potato: '🥔', bread: '🍞', croissant: '🥐', bagel: '🥯', pretzel: '🥨', cheese: '🧀',
  egg: '🥚', bacon: '🥓', pancakes: '🥞', waffle: '🧇', cut_of_meat: '🥩', poultry_leg: '🍗',
  meat_on_bone: '🍖', hotdog: '🌭', hamburger: '🍔', fries: '🍟', pizza: '🍕', sandwich: '🥪',
  taco: '🌮', burrito: '🌯', stuffed_flatbread: '🥙', salad: '🥗', popcorn: '🍿', canned_food: '🥫',
  spaghetti: '🍝', ramen: '🍜', stew: '🍲', curry: '🍛', sushi: '🍣', bento: '🍱', rice: '🍚',
  rice_ball: '🍙', fried_shrimp: '🍤', fortune_cookie: '🥠', dumpling: '🥟', oden: '🍢',
  icecream: '🍦', shaved_ice: '🍧', ice_cream: '🍨', doughnut: '🍩', cookie: '🍪', birthday: '🎂',
  cake: '🍰', cupcake: '🧁', pie: '🥧', chocolate_bar: '🍫', candy: '🍬', lollipop: '🍭',
  honey_pot: '🍯', baby_bottle: '🍼', milk_glass: '🥛', coffee: '☕', tea: '🍵', sake: '🍶',
  champagne: '🍾', wine_glass: '🍷', cocktail: '🍸', tropical_drink: '🍹', beer: '🍺',
  beers: '🍻', clinking_glasses: '🥂', tumbler_glass: '🥃', cup_with_straw: '🥤', bubble_tea: '🧋',

  // Activities & objects
  soccer: '⚽', basketball: '🏀', football: '🏈', baseball: '⚾', tennis: '🎾', volleyball: '🏐',
  rugby_football: '🏉', '8ball': '🎱', ping_pong: '🏓', badminton: '🏸', goal_net: '🥅',
  golf: '⛳', ice_skate: '⛸️', fishing_pole_and_fish: '🎣', ski: '🎿', sled: '🛷',
  dart: '🎯', bowling: '🎳', video_game: '🎮', game_die: '🎲', jigsaw: '🧩', chess_pawn: '♟️',
  trophy: '🏆', medal: '🏅', first_place_medal: '🥇', second_place_medal: '🥈', third_place_medal: '🥉',
  soccer_ball: '⚽', crown: '👑', gem: '💎', ring: '💍', lipstick: '💄', eyeglasses: '👓',
  briefcase: '💼', school_satchel: '🎒', tophat: '🎩', mortar_board: '🎓', tada: '🎉',
  confetti_ball: '🎊', balloon: '🎈', gift: '🎁', ribbon: '🎀', fireworks: '🎆', sparkler: '🎇',
  bulb: '💡', flashlight: '🔦', candle: '🕯️', wrench: '🔧', hammer: '🔨', nut_and_bolt: '🔩',
  gear: '⚙️', link: '🔗', paperclip: '📎', pushpin: '📌', round_pushpin: '📍', scissors: '✂️',
  pencil2: '✏️', pen: '🖊️', memo: '📝', pencil: '📝', book: '📖', books: '📚', bookmark: '🔖',
  newspaper: '📰', money_with_wings: '💸', dollar: '💵', moneybag: '💰', credit_card: '💳',
  chart_with_upwards_trend: '📈', chart_with_downwards_trend: '📉', bar_chart: '📊',
  clipboard: '📋', calendar: '📅', date: '📆', card_index: '📇', file_folder: '📁',
  open_file_folder: '📂', mag: '🔍', mag_right: '🔎', lock: '🔒', unlock: '🔓', key: '🔑',
  bell: '🔔', no_bell: '🔕', loudspeaker: '📢', mega: '📣', mute: '🔇', speaker: '🔈',
  sound: '🔉', loud_sound: '🔊', musical_note: '🎵', notes: '🎶', microphone: '🎤',
  headphones: '🎧', guitar: '🎸', musical_keyboard: '🎹', trumpet: '🎺', violin: '🎻', drum: '🥁',
  phone: '📞', telephone: '☎️', iphone: '📱', computer: '💻', desktop_computer: '🖥️',
  keyboard: '⌨️', printer: '🖨️', floppy_disk: '💾', cd: '💿', battery: '🔋', electric_plug: '🔌',
  camera: '📷', video_camera: '📹', movie_camera: '🎥', clapper: '🎬', tv: '📺', radio: '📻',
  hourglass: '⌛', hourglass_flowing_sand: '⏳', watch: '⌚', alarm_clock: '⏰', stopwatch: '⏱️',
  envelope: '✉️', email: '📧', inbox_tray: '📥', outbox_tray: '📤', package: '📦', mailbox: '📫',
  rocket: '🚀', airplane: '✈️', car: '🚗', taxi: '🚕', bus: '🚌', police_car: '🚓',
  ambulance: '🚑', fire_engine: '🚒', truck: '🚚', tractor: '🚜', bike: '🚲', motorcycle: '🏍️',
  train: '🚆', bullettrain_side: '🚄', helicopter: '🚁', ship: '🚢', anchor: '⚓', boat: '⛵',
  house: '🏠', office: '🏢', hospital: '🏥', bank: '🏦', hotel: '🏨', school: '🏫', church: '⛪',
  factory: '🏭', castle: '🏰', statue_of_liberty: '🗽', tokyo_tower: '🗼', bridge_at_night: '🌉',
  world_map: '🗺️', compass: '🧭', mountain: '⛰️', volcano: '🌋', beach_umbrella: '🏖️',
  desert_island: '🏝️', tent: '⛺', national_park: '🏞️', ferris_wheel: '🎡', roller_coaster: '🎢',

  // Symbols & misc
  recycle: '♻️', infinity: '♾️', trident: '🔱', beginner: '🔰', o: '⭕', red_circle: '🔴',
  large_blue_circle: '🔵', orange_circle: '🟠', yellow_circle: '🟡', green_circle: '🟢',
  purple_circle: '🟣', black_circle: '⚫', white_circle: '⚪', small_red_triangle: '🔺',
  arrow_up: '⬆️', arrow_down: '⬇️', arrow_left: '⬅️', arrow_right: '➡️', arrow_upper_right: '↗️',
  arrow_forward: '▶️', arrow_backward: '◀️', fast_forward: '⏩', rewind: '⏪',
  repeat: '🔁', twisted_rightwards_arrows: '🔀', arrows_counterclockwise: '🔄', back: '🔙',
  soon: '🔜', top: '🔝', new: '🆕', free: '🆓', cool: '🆒', ok: '🆗', sos: '🆘', up: '🆙',
  heavy_plus_sign: '➕', heavy_minus_sign: '➖', heavy_division_sign: '➗', heavy_dollar_sign: '💲',
  copyright: '©️', registered: '®️', tm: '™️', hash: '#️⃣', asterisk: '*️⃣',
  hotsprings: '♨️', hammer_and_wrench: '🛠️', shield: '🛡️', gun: '🔫', bomb: '💣', pill: '💊',
  syringe: '💉', dna: '🧬', microscope: '🔬', telescope: '🔭', crystal_ball: '🔮',
  hourglass_done: '⌛', label: '🏷️', bookmark_tabs: '📑', scroll: '📜', page_facing_up: '📄',
  calendar_spiral: '🗓️', wastebasket: '🗑️', lock_with_ink_pen: '🔏', closed_lock_with_key: '🔐',
  thermometer: '🌡️', broom: '🧹', basket: '🧺', toolbox: '🧰', magnet: '🧲', ladder: '🪜',
}

export interface EmojiHit { code: string; char: string }

// Rank matches: exact code > prefix > substring; shorter codes first within a tier.
export function searchEmoji(query: string, limit = 8): EmojiHit[] {
  const q = query.toLowerCase()
  if (!q) return []
  const exact: EmojiHit[] = []
  const prefix: EmojiHit[] = []
  const sub: EmojiHit[] = []
  for (const code in EMOJI) {
    if (code === q) exact.push({ code, char: EMOJI[code] })
    else if (code.startsWith(q)) prefix.push({ code, char: EMOJI[code] })
    else if (code.includes(q)) sub.push({ code, char: EMOJI[code] })
  }
  const byLen = (a: EmojiHit, b: EmojiHit) => a.code.length - b.code.length || a.code.localeCompare(b.code)
  prefix.sort(byLen)
  sub.sort(byLen)
  return [...exact, ...prefix, ...sub].slice(0, limit)
}

// The `:token` the caret currently sits inside, if any — used to drive the
// autocomplete popup. The `:` must start a word (line start or after whitespace)
// so we don't fire inside things like `http://` or `12:30`. Returns null when the
// caret isn't in a valid, still-open shortcode token.
export function activeEmojiToken(text: string, caret: number): { start: number; query: string } | null {
  let i = caret - 1
  while (i >= 0 && /[a-zA-Z0-9_+-]/.test(text[i])) i--
  if (i < 0 || text[i] !== ':') return null
  if (i > 0 && !/\s/.test(text[i - 1])) return null
  const query = text.slice(i + 1, caret)
  if (!query) return null
  return { start: i, query }
}

// If the text just to the left of the caret is a complete `:shortcode:` for a
// known emoji, return the replacement (glyph + range to replace). Powers the
// "type the closing colon to convert" path. The opening `:` must start a word.
export function completedEmojiAt(text: string, caret: number): { start: number; end: number; char: string } | null {
  if (text[caret - 1] !== ':') return null
  let i = caret - 2
  while (i >= 0 && /[a-zA-Z0-9_+-]/.test(text[i])) i--
  if (i < 0 || text[i] !== ':') return null
  if (i > 0 && !/\s/.test(text[i - 1])) return null
  const code = text.slice(i + 1, caret - 1).toLowerCase()
  const char = EMOJI[code]
  if (!char) return null
  return { start: i, end: caret, char }
}
