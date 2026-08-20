-- Przypisanie radnych Rady Miejskiej w Grójcu do komitetów wyborczych,
-- VII kadencja (2024–2029).
--
-- Źródło: sesja 2024-05-07 (meeting de5c0d48-bfea-4538-b95f-c1a33db33856),
-- wystąpienie przewodniczącej Miejskiej Komisji Wyborczej, 247–390 s.
-- Sumy z odczytu: 6 + 4 + 4 + 3 + 2 + 2 = 21 mandatów, tyle samo, ile jest
-- wierszy w councilor_term dla tej kadencji — lista domyka się co do jednego.
--
-- Dwa przypisania to WNIOSEK, nie cytat, i trzeba je czytać ostrożnie:
-- komisja odczytała skład tuż po wyborach, a dwa mandaty z listy KWW Nam
-- Zależy wygasły przed pierwszą sesją (Dariusz Gwiazda — wybór na burmistrza,
-- Jarosław Rupiewicz — zrzeczenie się mandatu). Na ich miejsce komisarz
-- wyborczy wprowadził Roberta Dobrzyńskiego (okręg 2) i Damiana Woźniaka
-- (okręg 1). Kodeks wyborczy obsadza wakat kolejnym kandydatem Z TEJ SAMEJ
-- listy, więc obaj wchodzą z Nam Zależy — ale sam protokół tego nie mówi.
-- Gdyby kiedyś znalazło się źródło mówiące inaczej, poprawiać należy te dwa
-- wiersze, nie resztę.
--
-- Uwaga na nazwisko: komisja odczytała "Feliksjak", w bazie jest "Feliksiak".
-- To ta sama osoba (jeden radny o tym nazwisku, okręg zgadza się z listą).

update councilor_term ct
set election_committee = v.committee,
    election_committee_code = v.code
from (values
  ('Małgorzata Molenda',    'Komitet Wyborczy Wyborców Nam Zależy', 'NZ'),
  ('Henryk Feliksiak',      'Komitet Wyborczy Wyborców Nam Zależy', 'NZ'),
  ('Kamil Sobczak',         'Komitet Wyborczy Wyborców Nam Zależy', 'NZ'),
  ('Dorota Niedbała',       'Komitet Wyborczy Wyborców Nam Zależy', 'NZ'),
  ('Robert Dobrzyński',     'Komitet Wyborczy Wyborców Nam Zależy', 'NZ'),
  ('Damian Woźniak',        'Komitet Wyborczy Wyborców Nam Zależy', 'NZ'),

  ('Wiesława Antoszewska',  'Komitet Wyborczy Prawo i Sprawiedliwość', 'PiS'),
  ('Małgorzata Piwarska',   'Komitet Wyborczy Prawo i Sprawiedliwość', 'PiS'),
  ('Artur Moskal',          'Komitet Wyborczy Prawo i Sprawiedliwość', 'PiS'),
  ('Małgorzata Szymańczak', 'Komitet Wyborczy Prawo i Sprawiedliwość', 'PiS'),

  ('Monika Kozłowska',      'Koalicyjny Komitet Wyborczy Koalicja Obywatelska', 'KO'),
  ('Anna Śliwa-Jóźwik',     'Koalicyjny Komitet Wyborczy Koalicja Obywatelska', 'KO'),
  ('Dariusz Prykiel',       'Koalicyjny Komitet Wyborczy Koalicja Obywatelska', 'KO'),
  ('Łukasz Pietrzak',       'Koalicyjny Komitet Wyborczy Koalicja Obywatelska', 'KO'),

  ('Jerzy Antoniewicz',     'Komitet Wyborczy Wyborców Rodziny dla gminy Grójec', 'RdG'),
  ('Artur Szlis',           'Komitet Wyborczy Wyborców Rodziny dla gminy Grójec', 'RdG'),
  ('Dariusz Woźniak',       'Komitet Wyborczy Wyborców Rodziny dla gminy Grójec', 'RdG'),

  ('Karol Biedrzycki',      'Komitet Wyborczy Wyborców Karola Biedrzyckiego', 'KB'),
  ('Tomasz Justyński',      'Komitet Wyborczy Wyborców Karola Biedrzyckiego', 'KB'),

  ('Grzegorz Stolarek',     'Komitet Wyborczy Wyborców Dzień dobry Grójec', 'DDG'),
  ('Daniel Marcinkowski',   'Komitet Wyborczy Wyborców Dzień dobry Grójec', 'DDG')
) as v(full_name, committee, code)
join councilor c on c.full_name = v.full_name
where ct.councilor_id = c.id
  and ct.term_id = 'c4bc384f-33c3-46bd-b67c-ab569bb399dd';
