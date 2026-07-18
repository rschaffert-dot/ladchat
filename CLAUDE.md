# CLAUDE.md

Detta är projektinstruktionerna för Claude Code i detta repo. Läs igenom innan du börjar arbeta.

## Om projektet

Ladchat är en gamifierad gruppchatt-app. Tanken är att kombinera vanlig gruppchatt med spelmekanik: utmaningar, poäng och sociala interaktioner mellan medlemmarna i en grupp.

## Tech-stack

- Next.js (App Router) + TypeScript
- Tailwind CSS för styling
- Supabase som backend (databas, auth, realtime)
- Deploy: Vercel

## Grundprinciper

- All spellogik ska köras server-side (Supabase Edge Functions / server actions), aldrig lita på klienten för poängsättning eller spelstate.
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
- `npm run dev` - starta lokal dev-server
- `npm run build` - bygg för produktion
- `npm run lint` - kör linter

## Nästa steg / roadmap

Se separat planeringsdokument (fas1-prompt.md eller motsvarande) för den fem-fas utvecklingsplanen. Fas 1 fokuserar på grundläggande auth, gruppstruktur och chattfunktionalitet innan spelmekanik läggs på.

## Next.js-specifikt

Se `AGENTS.md` för Next.js agent-regler. Denna Next.js-version kan ha brytande ändringar mot äldre kännedom — läs relevant guide i `node_modules/next/dist/docs/` innan du skriver Next.js-kod.
