-- Zakłada Radę Powiatu Grójeckiego: jednostkę administracyjną, radę, VII kadencję
-- i 21 radnych ze składu na BIP (plan: notatki/plan-powiat-grojecki-2026-08-10.md,
-- Faza 2). Wymaga wcześniejszego scripts/migrate-powiat.sql.
--
-- Skład: https://bip.grojec.pl/index.php?cmd=zawartosc&opt=pokaz&id=34727
-- (uwaga: bip.grojec.pl to BIP POWIATU, mimo nazwy sugerującej gminę).
-- Data I sesji (2024-05-07) potwierdzona na kanale transmisjaobrad.info.
--
-- Radnych powiatu zakładamy BEZWARUNKOWO jako nowe wiersze `councilor` — nie
-- szukamy „czy taka osoba już jest”. Zbieżność imienia i nazwiska z radnym gminy
-- skleiłaby dwie różne osoby, a jednoczesny mandat w gminie i powiecie i tak jest
-- ustawowo wykluczony.
--
-- Urzędników powiatu CELOWO nie zakładamy — powstaną dopiero przy tagowaniu
-- mówców, po ludzkim przejrzeniu transkryptów. Starosta, Wicestarosta i
-- Członkowie Zarządu są radnymi, nie urzędnikami: ich funkcja siedzi
-- w councilor_term.role, a wpisanie ich do `official` zdublowałoby te same osoby.
--
-- Uruchomić raz: psql "$SUPABASE_DB_URL" -f scripts/seed-rada-powiatu-grojeckiego.sql

begin;

do $$
declare
  v_powiat_unit uuid;
  v_gmina_unit uuid;
  v_city uuid;
  v_gmina_council uuid;
  v_council uuid;
  v_term uuid;
  v_councilor uuid;
  r record;
begin
  select id into v_powiat_unit from admin_unit where level = 'powiat' and name = 'Powiat Grójecki';
  if v_powiat_unit is null then
    raise exception 'Brak jednostki admin_unit "Powiat Grójecki" — przerywam.';
  end if;

  -- Hierarchia: miasto Grójec wskazuje dziś wprost na powiat, bo poziomu gminy
  -- nigdy nie było potrzeby zakładać. Przy dwóch radach to już przeszkadza —
  -- obie wylądowałyby w tej samej jednostce, więc manager o zakresie gminnym
  -- obejmowałby też radę powiatu. Dokładamy brakujące ogniwo.
  select id into v_gmina_unit from admin_unit where level = 'gmina' and name = 'Gmina Grójec';
  if v_gmina_unit is null then
    v_gmina_unit := gen_random_uuid();
    insert into admin_unit (id, name, level, parent_id, path)
    select v_gmina_unit, 'Gmina Grójec', 'gmina', v_powiat_unit,
           (au.path::text || '.' || replace(v_gmina_unit::text, '-', '_'))::ltree
    from admin_unit au where au.id = v_powiat_unit;

    select id into v_city from city where name = 'Grójec';
    update city set admin_unit_id = v_gmina_unit where id = v_city;
    update council set admin_unit_id = v_gmina_unit where city_id = v_city;
    raise notice 'Dodano admin_unit "Gmina Grójec" i przepięto pod nią miasto oraz radę gminy.';
  end if;

  select id into v_council from council where name = 'Rada Powiatu Grójeckiego';
  if v_council is not null then
    raise notice 'Rada Powiatu Grójeckiego już istnieje (%) — nic nie robię.', v_council;
    return;
  end if;

  -- Nazwa musi zgadzać się co do znaku z councilName w src/lib/granice/index.ts —
  -- po niej strona główna dopina klikalny obszar powiatu na mapie do rady.
  v_council := gen_random_uuid();
  insert into council (id, name, city_id, admin_unit_id)
  values (v_council, 'Rada Powiatu Grójeckiego', null, v_powiat_unit);

  v_term := gen_random_uuid();
  insert into term (id, council_id, label, start_date, end_date)
  values (v_term, v_council, 'VII kadencja (2024–2029)', date '2024-05-07', null);

  for r in
    select * from (values
      ('Krzysztof Ambroziak',          'starosta'),
      ('Adam Balcerowicz',             'wicestarosta'),
      ('Daria Bobrowska-Wachniewska',  'wiceprzewodnicząca'),
      ('Elżbieta Czamara',             null),
      ('Krzysztof Fiks',               'członek zarządu'),
      ('Janusz Karbowiak',             'członek zarządu'),
      ('Agata Kępka',                  null),
      ('Edward Kieszek',               null),
      ('Cezary Kołodziejski',          null),
      ('Barbara Lipska',               null),
      ('Adolf Maciak',                 null),
      ('Jan Madej',                    'przewodniczący'),
      ('Marta Matysiak',               null),
      ('Ewa Mróz',                     null),
      ('Szymon Rogoziński',            null),
      ('Jolanta Sitarek',              'wiceprzewodnicząca'),
      ('Anna Steczkowska',             null),
      ('Andrzej Stępniak',             null),
      ('Piotr Szybiński',              null),
      ('Wojciech Wojtczak',            null),
      ('Andrzej Zaręba',               'członek zarządu')
    ) as t(full_name, role)
  loop
    v_councilor := gen_random_uuid();
    insert into councilor (id, full_name) values (v_councilor, r.full_name);
    -- BIP nie podaje okręgów ani klubów, więc district_seat i party zostają null.
    insert into councilor_term (councilor_id, term_id, role, mandate_start_date)
    values (v_councilor, v_term, r.role, date '2024-05-07');
  end loop;

  raise notice 'Utworzono radę % z kadencją % i 21 radnymi.', v_council, v_term;
end $$;

commit;
