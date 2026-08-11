-- Cofanie zmian w BAZIE z 2026-08-11. Git tego nie obejmuje — schemat i dane
-- żyją w Supabase, nie w repo, więc `git revert` sam z siebie nie przywróci
-- niczego z tego pliku.
--
-- CELOWO WSZYSTKO JEST ZAKOMENTOWANE. Odkomentuj wyłącznie tę sekcję, którą
-- chcesz cofnąć, i uruchom:
--   psql "$SUPABASE_DB_URL" -f scripts/rollback-2026-08-11.sql
--
-- Sekcje są niezależne — cofnięcie heatmapy nie wymaga cofania uprawnień
-- i odwrotnie. Kolejność dowolna.
--
-- UWAGA na parowanie z kodem: sekcje 1 i 2 cofają rzeczy, na których stoi
-- działający kod. Jeśli cofasz je bez cofnięcia kodu, dostaniesz:
--   sekcja 1 → heatmapa pusta (RPC `term_speaking_blocks` nie istnieje),
--   sekcja 2 → przycisk „Cofnij" martwy dla redaktorów (0 zmienionych wierszy).
-- Cofaj więc parami: najpierw kod, potem odpowiednią sekcję tutaj.


-- ─────────────────────────────────────────────────────────────────────────
-- SEKCJA 1. Czas mówienia w heatmapie: powrót z bloków na sumę segmentów.
-- Wprowadzone przez: scripts/migrate-speaking-blocks.sql
-- Po stronie kodu trzeba cofnąć zmiany w src/lib/council-activity.ts
-- (i wpis `term_speaking_blocks` w src/lib/supabase/database.types.ts).
-- ─────────────────────────────────────────────────────────────────────────

-- drop function if exists public.term_speaking_blocks(uuid, numeric);


-- ─────────────────────────────────────────────────────────────────────────
-- SEKCJA 2. Cofanie przypisań: polityka pozwalająca redaktorowi wycofać
-- WŁASNĄ propozycję. Wprowadzone przez: scripts/migrate-undo-assignment.sql
-- Bez niej przycisk „Cofnij" działa tylko dla moderatorów.
-- ─────────────────────────────────────────────────────────────────────────

-- drop policy if exists "editors revert own proposal" on public.segment;


-- ─────────────────────────────────────────────────────────────────────────
-- SEKCJA 3. Uszczelnienie WITH CHECK — POWRÓT DO STANU Z DZIURĄ.
-- Wprowadzone przez: scripts/migrate-segment-check-tighten.sql
--
-- Przeczytaj, zanim uruchomisz: to przywraca `with check (true)`, czyli stan,
-- w którym konto z samym uprawnieniem `vote` może zapisać
-- `status = 'finalized'` z pominięciem moderatora (sprawdzone 2026-08-11:
-- UPDATE 1). Odkomentuj tylko wtedy, gdy uszczelnienie realnie coś zepsuło —
-- to jedyna sekcja, która pogarsza bezpieczeństwo zamiast przywracać stan
-- neutralny.
-- ─────────────────────────────────────────────────────────────────────────

-- begin;
-- drop policy if exists "moderators finalize segments" on public.segment;
-- create policy "moderators finalize segments" on public.segment
--   for update
--   using (
--     exists (
--       select 1 from meeting m join term t on t.id = m.term_id
--       where m.id = segment.meeting_id
--         and user_has_permission(auth.uid(), 'finalize_vote', t.council_id)
--     )
--   )
--   with check (true);
-- commit;


-- ─────────────────────────────────────────────────────────────────────────
-- SEKCJA 4. Osoby dodane dziś do `official`.
-- Wprowadzone przez: scripts/seed-nieustalony-mowca.sql,
-- scripts/seed-officials-sesja29.sql oraz ręczny insert (Sylwester Kucharczyk).
--
-- NIEBEZPIECZNE, jeśli ktoś zdążył już otagować nimi segmenty:
-- `segment.confirmed_official_id` ma ON DELETE SET NULL, więc usunięcie
-- osoby nie zgłosi błędu — po cichu odetnie jej wypowiedzi od mówcy i wrócą
-- do puli nieprzypisanych, bez śladu, kto tam był.
--
-- Najpierw policz, co zniknie:
--   select o.full_name, count(s.id)
--   from official o left join segment s on s.confirmed_official_id = o.id
--   where o.full_name in ('Nieustalony mówca','Sławomir Maroszek',
--     'Ireneusz Wojciechowski','Agnieszka Skarżyńska','Sylwester Kucharczyk')
--   group by o.full_name;
-- ─────────────────────────────────────────────────────────────────────────

-- delete from public.official
-- where full_name in (
--   'Nieustalony mówca',
--   'Sławomir Maroszek',
--   'Ireneusz Wojciechowski',
--   'Agnieszka Skarżyńska',
--   'Sylwester Kucharczyk'
-- );
