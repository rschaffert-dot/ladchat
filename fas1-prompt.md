# Ladchat – Fas 1: Grund

Detta dokument beskriver mål och avgränsning för Fas 1 av Ladchat-utvecklingen. Använd som startprompt för Claude Code när ni påbörjar arbetet.

## Mål med Fas 1

Bygga grundstommen: autentisering, gruppstruktur och grundläggande chattfunktionalitet. Ingen spelmekanik (poäng, utmaningar) implementeras än - det kommer i senare faser.

## Omfattning

1. **Auth**
   - Inloggning/registrering via Supabase Auth (e-post + lösenord, ev. magic link)
      - Skyddade routes för inloggade användare

      2. **Grupper**
         - Skapa grupp
            - Bjuda in medlemmar (via länk eller e-post)
               - Lista egna grupper
                  - Grundläggande roller: ägare / medlem

                  3. **Chatt**
                     - Skicka och ta emot textmeddelanden i en grupp
                        - Realtidsuppdatering via Supabase Realtime
                           - Enkel meddelandehistorik (paginerad hämtning)

                           4. **UI**
                              - Mobile-first, Tailwind
                                 - Grundläggande navigering mellan grupper och chattvy

                                 ## Utanför scope för Fas 1

                                 - Poängsystem
                                 - Utmaningar/challenges
                                 - Notiser (push)
                                 - Avancerad medlemshantering (kick, roller utöver ägare/medlem)

                                 ## Datamodell (utkast, Supabase/Postgres)

                                 - `users` (hanteras av Supabase Auth)
                                 - `groups` (id, name, owner_id, created_at)
                                 - `group_members` (group_id, user_id, role, joined_at)
                                 - `messages` (id, group_id, user_id, content, created_at)

                                 ## Definition of Done för Fas 1

                                 - En användare kan registrera sig, skapa en grupp, bjuda in en vän, och båda kan chatta med varandra i realtid.
                                 - Grundläggande RLS-policies (Row Level Security) på plats i Supabase så att man bara ser grupper man är medlem i.

                                 ## Kommande faser (översikt)

                                 - Fas 2: Poängsystem och grundläggande utmaningar
                                 - Fas 3: Fler utmaningstyper, data-driven challenge-motor
                                 - Fas 4: Notiser och engagemangsfunktioner
                                 - Fas 5: Polish, prestanda, lansering
                                 
