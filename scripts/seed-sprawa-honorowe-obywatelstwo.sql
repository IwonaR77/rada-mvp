-- Nowa sprawa wykryta eksperymentalnie przez PoC embeddingów semantycznych
-- (scripts/poc-znajdz-nowe-sprawy.mjs, klaster o fanout=3 sesje) — burmistrz
-- zapowiada nadanie honorowego obywatelstwa (sesja 27.11.2025), uroczysta
-- sesja z udziałem gości kościelnych i szkolnych (2.02.2026), jednogłośne
-- przyjęcie uchwały. Brak jednego radnego-inicjatora — to decyzja całej
-- rady, stąd bez matter_participant.

with nowa_sprawa as (
  insert into matter (council_id, title, status, notes)
  values (
    '846c8bce-7f11-4825-91dd-fe80cedf5289', -- Rada Miejska w Grójcu
    'Nadanie honorowego obywatelstwa miasta Grójca ks. Piotrowi Skardze',
    'proposed',
    'Rada Miejska jednogłośnie przyjęła uchwałę o nadaniu honorowego obywatelstwa miasta Grójca (pośmiertnie) ks. Piotrowi Skardze, jezuicie. Temat zapowiedziany przez burmistrza na sesji 27.11.2025 (na tle informacji, że od 1997 r. miasto ma trzech honorowych obywateli), formalnie przyjęty na uroczystej sesji 2.02.2026 z udziałem przedstawicielki Kościelnej Fundacji Dobroczynnej ks. Piotra Skargi i dyrektorki Publicznej Szkoły Podstawowej nr 3. Sprawa wykryta eksperymentalnie (PoC embeddingów semantycznych) — nie była dotąd w katalogu.'
  )
  returning id
)
insert into matter_reference (matter_id, meeting_id, note)
select id, '90770de7-8e84-47b6-bb84-497fa09f8ec2'::uuid, 'Burmistrz zapowiada nadanie honorowego obywatelstwa, informuje o trzech dotychczasowych honorowych obywatelach od 1997 r.' from nowa_sprawa
union all
select id, 'c7750ea6-08d6-4e4d-b6d0-acbefe639034'::uuid, 'Uroczysta sesja nadania honorowego obywatelstwa ks. Piotrowi Skardze — jednogłośne przyjęcie uchwały, przemówienia gości.' from nowa_sprawa
returning matter_id, meeting_id;
