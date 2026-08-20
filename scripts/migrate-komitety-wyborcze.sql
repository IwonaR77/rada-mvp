-- Komitet wyborczy, z którego radny wszedł do rady.
--
-- Skąd dane: na pierwszej sesji kadencji przewodnicząca komisji wyborczej
-- odczytuje wyniki wyborów komitet po komitecie, z nazwiskami. Dla Rady
-- Miejskiej w Grójcu (sesja 2024-05-07, 247–330 s) jest to pełna lista 21
-- mandatów i to jedyne miejsce w całej bazie, gdzie ten podział pada wprost.
--
-- Dlaczego osobna kolumna, a nie istniejące `party`: komitet wyborczy to nie
-- partia. KWW Karola Biedrzyckiego czy KWW Dzień dobry Grójec nie są żadną
-- partią, a radny z listy PiS nie musi być członkiem PiS. `party` zostaje
-- puste na przyszłość (deklarowana przynależność partyjna), bo to inny fakt.
--
-- Dlaczego to NIE to samo co klub radnych: kluby powstają po wyborach i mogą
-- przecinać komitety (Grójec 2024-09-04 i 2025-01-30 — nowe kluby w trakcie
-- kadencji). Komitet jest faktem z protokołu wyborczego i się nie zmienia,
-- więc siedzi w councilor_term. Kluby to osobny, jeszcze niezbudowany temat.
--
-- `election_committee_code` jest krótką etykietą do macierzy korelacji: przy
-- 21 wierszach nie mieści się pełna nazwa, a sam kolor nie może być jedynym
-- nośnikiem tożsamości (sześciu kategorii nie da się rozróżnić kolorem przy
-- deuteranopii — sprawdzone walidatorem palety). Kod jest kuratorowany, a nie
-- generowany z nazwy: automat na polskich nazwach robi z "Prawo i
-- Sprawiedliwość" kod "PiS" tylko przypadkiem.
--
-- Nullable, bo dla Rady Powiatu Grójeckiego tych danych nie ma: na I sesji
-- (2024-05-07) sędzia wręczał zaświadczenia alfabetycznie, bez podziału na
-- komitety, a jedyna informacja o podziale to zgłoszenie klubu "Przyjazny
-- Powiat" na 14 osób — bez nazwisk. Interfejs musi działać bez tych danych.

alter table councilor_term
  add column if not exists election_committee text,
  add column if not exists election_committee_code text;

alter table councilor_term
  drop constraint if exists councilor_term_election_committee_pair_check;
alter table councilor_term
  add constraint councilor_term_election_committee_pair_check
  check (
    (election_committee is null) = (election_committee_code is null)
    and (election_committee_code is null or char_length(election_committee_code) <= 6)
  );

comment on column councilor_term.election_committee is
  'Pełna, oficjalna nazwa komitetu wyborczego, z którego radny uzyskał mandat.';
comment on column councilor_term.election_committee_code is
  'Krótka etykieta komitetu (max 6 znaków) do gęstych widoków, np. macierzy korelacji.';
