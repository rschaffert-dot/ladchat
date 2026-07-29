/**
 * Emojis som hör hemma i *meddelanden* — komposerns snabbväljare.
 *
 * Resten av appen använder linjeikoner (se src/components/AppIcon.tsx);
 * emojis lever bara kvar här och i reaktionerna (src/lib/reactions.ts).
 * Ligger i en egen modul just för att undantaget ska vara uppenbart och
 * inte städas bort av misstag nästa gång UI-chromet gås igenom.
 */
export const QUICK_EMOJIS = [
  "😀", "😂", "🤣", "😎", "😭", "😡", "🥴", "🤠",
  "❤️", "🔥", "👍", "👎", "💪", "🍺", "🐐", "💀",
  "🎉", "👀", "🙏", "🤝", "🖕", "💩", "🧠", "⚽",
  "🥂", "🍕", "🚬", "😈", "🤡", "🥶", "😤", "🫡",
  "🤙", "👊", "🏆", "🎲", "⚡", "💯", "🙈", "😴",
];
