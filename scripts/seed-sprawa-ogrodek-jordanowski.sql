-- Nowa sprawa wykryta eksperymentalnie przez PoC embeddingów semantycznych
-- (scripts/poc-znajdz-nowe-sprawy.mjs) — kilka par o niskim fanoucie po
-- odfiltrowaniu hubów okazało się fragmentami jednego wątku: brak miejsc
-- spotkań dla młodzieży, spór o regulamin Ogródka Jordanowskiego, uchwała
-- kierunkowa radnej Kozłowskiej, petycja mieszkanki o nadzór na placu zabaw.
-- Ręcznie zweryfikowane pełną treścią bloków przed dodaniem (nie tylko
-- podobieństwo embeddingu) — odróżnione od istniejącej sprawy "Spór o
-- dostęp do kompleksu sportowego w Kobylinie (Święto Kwitnącej Jabłoni)",
-- to inny obiekt (Ogródek Jordanowski przy parku w Grójcu, nie Kobylin) i
-- inny spór (wiek/nadzór, nie dostęp gmina-powiat).

with nowa_sprawa as (
  insert into matter (council_id, title, status, notes)
  values (
    '846c8bce-7f11-4825-91dd-fe80cedf5289', -- Rada Miejska w Grójcu
    'Miejsca spotkań dla młodzieży i spór o regulamin Ogródka Jordanowskiego',
    'proposed',
    'Powracający temat braku miejsc spotkań dla młodzieży w Grójcu i konfliktu pokoleniowego o korzystanie z placów zabaw. Radna Monika Kozłowska poddała pod głosowanie uchwałę kierunkową (28.05.2026) wskazującą burmistrzowi kierunki działań: miejsce spotkań przy dworcu kolejki wąskotorowej, wydłużenie godzin Ogródka Jordanowskiego, dopuszczenie młodzieży powyżej 12. roku życia, bezpłatny dostęp do hali sportowej w wybrane dni. Burmistrz Dariusz Gwiazda wyraził zastrzeżenia (brak gruntów pod inwestycje, wątpliwości co do finansowania z programu profilaktyki uzależnień, apel o konsultacje z komisją). Radni Robert Dobrzyński i Wiesława Antoszewska zgłosili zastrzeżenia do konkretnych punktów (koszty wydłużonych godzin, bezpieczeństwo młodszych dzieci przy starszej młodzieży). Wcześniej (27.02.2025) radny Karol Biedrzycki i radny Artur Moskal zwracali uwagę na bezpieczeństwo dojazdu do Ogródka Jordanowskiego przy planowanej nowej drodze. Sprawa wróciła 25.06.2026 jako petycja mieszkanki o stały nadzór nad placem zabaw "Górki i Sznurki" przy ul. Sienkiewicza ze względu na wulgarne zachowanie starszej młodzieży. Sprawa wykryta eksperymentalnie (PoC embeddingów semantycznych) — nie była dotąd w katalogu.'
  )
  returning id
),
uczestnik as (
  insert into matter_participant (matter_id, councilor_id, role)
  select id, 'f125f03d-0410-474c-bd4a-337b71c7a3aa'::uuid, 'inicjator' from nowa_sprawa -- Monika Kozłowska
)
insert into matter_reference (matter_id, meeting_id, note)
select id, '54e2c465-f99b-470a-85ff-4cc744597eb1'::uuid, 'Zwrócenie uwagi na bezpieczeństwo dojazdu do Ogródka Jordanowskiego przy planowanej nowej drodze.' from nowa_sprawa -- 2025-02-27
union all
select id, 'ec96d73e-4041-4df9-8635-f5e0835025da'::uuid, 'Uchwała kierunkowa radnej Kozłowskiej ws. miejsc rekreacji dla młodzieży i zmiany regulaminu Ogródka Jordanowskiego — dyskusja i głosowanie.' from nowa_sprawa -- 2026-05-28
union all
select id, '6f6212fc-7af3-41cf-8a32-b7ff13a3b0ce'::uuid, 'Petycja mieszkanki o stały nadzór nad placem zabaw ze względu na zachowanie starszej młodzieży.' from nowa_sprawa -- 2026-06-25
returning matter_id, meeting_id;
