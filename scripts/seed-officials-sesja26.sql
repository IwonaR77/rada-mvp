-- Mówcy z XXVI sesji Rady Miejskiej w Grójcu (2 lutego 2026) — sesji
-- uroczystej, na której nadano honorowe obywatelstwo miasta ks. Piotrowi
-- Skardze. Zabierali głos niemal wyłącznie goście spoza rady i spoza urzędu,
-- więc prawie cała ta sesja jest dziś nieprzypisywalna.
--
-- Wpisani są WYŁĄCZNIE ci, którzy mówili. Powitań było kilkadziesiąt
-- (biskup, proboszczowie, wójtowie sąsiednich gmin, starosta, komendant
-- jednostki wojskowej, sołtysi) — te osoby nie dostają wiersza, bo nie ma im
-- czego przypisać, a zaśmieciłyby listę mówców przy każdej innej sesji.
--
-- Funkcje trwałe, nie chwilowe (patrz [[feedback-stable-role-labels]]).
-- Uwaga na Karczewskiego: przewodnicząca powitała go jako „Marszałka Senatu",
-- ale marszałkiem był w latach 2015–2019; dziś jest senatorem z okręgu nr 49,
-- obejmującego powiat grójecki. Wpisujemy mandat, nie kurtuazyjny tytuł.
--
-- Pisownia nazwisk lokalnych zweryfikowana poza transkrypcją (KRS/rejestr.io,
-- BIP UGiM, BIP powiatu) — rozpoznawanie mowy dało w tej samej sesji dwa
-- warianty jednego nazwiska („Czysz-Mańkowska" i „Czyż-Mańkowska").
--
-- Uruchomić raz: psql "$SUPABASE_DB_URL" -f scripts/seed-officials-sesja26.sql

begin;

insert into public.official (full_name, role, council_id)
select v.full_name, v.role, c.id
from (values
  ('Marek Suski',             'Poseł na Sejm RP'),
  ('Mirosław Maliszewski',    'Poseł na Sejm RP'),
  ('Stanisław Karczewski',    'Senator RP'),
  ('Magdalena Nowacka',       'Radna Sejmiku Województwa Mazowieckiego'),
  ('Agnieszka Czyż-Mańkowska','Prezes Kościelnej Fundacji Dobroczynnej ks. Piotra Skargi'),
  ('Krystian Biernacki',      'Jezuita, wicepostulator procesu ks. Piotra Skargi'),
  ('Beata Górecka',           'Dyrektor Publicznej Szkoły Podstawowej nr 3 w Grójcu'),
  ('Małgorzata Czacharowska', 'Dyrektor Liceum Ogólnokształcącego w Grójcu')
) as v(full_name, role)
cross join public.council c
where c.name = 'Rada Miejska w Grójcu'
  and not exists (
    select 1 from public.official o
    where o.council_id = c.id and o.full_name = v.full_name
  );

commit;
