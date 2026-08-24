-- Nowa sprawa wykryta eksperymentalnie przez PoC embeddingów semantycznych
-- (notatki/dyskusja-z-chatgpt-pamiec-semantyczna.txt, pamięć
-- project_semantic_matter_poc) — dwa bloki wypowiedzi radnego Pietrzaka
-- (30.01.2025, 26.06.2025) o podobieństwie 0.970, których najbliższa
-- istniejąca sprawa w katalogu miała tylko 0.843 (inny temat) — czyli
-- realna luka w ręcznej ekstrakcji z 2026-08-01.

with nowa_sprawa as (
  insert into matter (council_id, title, status, notes)
  values (
    '846c8bce-7f11-4825-91dd-fe80cedf5289', -- Rada Miejska w Grójcu
    'Budowa chodnika przy drodze wojewódzkiej 722 (Grójec–Gościęczyce)',
    'proposed',
    'Radny Łukasz Pietrzak wielokrotnie pytał burmistrza o postęp budowy chodnika przy drodze wojewódzkiej nr 722 na odcinku Grójec–Gościęczyce, w tym o korespondencję z Mazowieckim Zarządem Dróg Wojewódzkich (MZDW) w tej sprawie. Sprawa wykryta eksperymentalnie (PoC embeddingów semantycznych) — nie była dotąd w katalogu, mimo dwóch osobnych zgłoszeń tego samego radnego.'
  )
  returning id
),
uczestnik as (
  insert into matter_participant (matter_id, councilor_id, role)
  select id, '0bc45291-c9ad-4458-b457-e6bb7e418678', 'inicjator' from nowa_sprawa -- Łukasz Pietrzak
  returning matter_id
)
insert into matter_reference (matter_id, meeting_id, note)
select id, 'f8334025-a401-432f-8229-7d5e88f201c1'::uuid, 'Pytanie o status budowy chodnika przy drodze 722, czy wpłynęła odpowiedź z MZDW.' from nowa_sprawa -- sesja 2025-01-30
union all
select id, '49ac3c3f-ebf7-4b60-8ef5-32be57cf79d5'::uuid, 'Ponowne pytanie o status budowy chodnika przy drodze 722.' from nowa_sprawa -- sesja 2025-06-26
returning matter_id, meeting_id;
