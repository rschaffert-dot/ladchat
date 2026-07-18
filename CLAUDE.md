# CLAUDE.md

Detta är projektinstruktionerna för Claude Code i detta repo. Läs igenom innan du börjar arbeta.

## Om projektet

Ladchat är en gamifierad gruppchatt-app. Tanken är att kombinera vanlig gruppchatt med spelmekanik: utmaningar, poäng och sociala interaktioner mellan medlemmarna i en grupp.

## Tech-stack

- React Native med Expo (SDK 57) + expo-router (fil-baserad routing i `src/app`)
- TypeScript
- Supabase som backend (databas, auth, realtime) — session i AsyncStorage
- Byggen/utgåvor via Expo (EAS) till App Store / Google Play

## Grundprinciper

- All spellogik ska köras server-side (Supabase Edge Functions / SQL-funktioner med RLS), aldrig lita på klienten för poängsättning eller spelstate.
- Utmaningar (challenges) ska vara datadrivna, inte hårdkodade i komponenter, så nya typer kan läggas till utan att ändra kärnkoden.
- Realtidsuppdateringar (t.ex. nya meddelanden, poäng) via Supabase Realtime.
- Mobile-first design, eftersom det är en chattapp.

## Arbetssätt i det här repot

- Vi är två personer (rschaffert-dot och antonmolund) som kör varsin Claude Code-session mot samma repo.
- Jobba på egna branches, öppna PR mot main.
- Kör `git pull` innan ni börjar en session för att undvika konflikter.
- Beskriv commits kort och tydligt på svenska eller engelska, spelar mindre roll - var bara konsekvent inom samma PR.

## Kommandon

- `npm install` - installera dependencies
- `npx expo start` - starta dev-server (Metro); tryck `i`/`a` för iOS/Android-simulator, eller skanna QR i Expo Go
- `npx expo start --web` - kör i webbläsare
- `npx tsc --noEmit` - typkolla
- `npm run lint` - kör linter (expo lint)

DB-schemat finns som migrationer i `supabase/migrations/` och är applicerat på Supabase-projektet.

## Nästa steg / roadmap

Se separat planeringsdokument (fas1-prompt.md eller motsvarande) för den fem-fas utvecklingsplanen. Fas 1 fokuserar på grundläggande auth, gruppstruktur och chattfunktionalitet innan spelmekanik läggs på.

## Expo/React Native-specifikt

Se `AGENTS.md` för Expo agent-regler. Denna Expo/React Native-version (SDK 57, RN 0.86, React 19) kan ha brytande ändringar mot äldre kännedom. Routing sker fil-baserat via expo-router i `src/app`; Supabase-klienten ligger i `src/lib/supabase.ts` och auth-state i `src/lib/auth.tsx`.
