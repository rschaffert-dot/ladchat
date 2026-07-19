-- Utan detta innehåller DELETE-eventets "old record" bara primärnyckeln (id),
-- vilket inte räcker för klienten att veta vilket meddelande/vilken reaktion
-- som togs bort. Samma mönster som groups/challenges/tournament_entries.
alter table public.message_reactions replica identity full;
