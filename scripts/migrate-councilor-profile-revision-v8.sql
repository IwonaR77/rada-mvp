-- Wariant 2 (delta) dla kroku iteracyjnego profilu radnego — plan
-- .claude/plans/tranquil-wibbling-lerdorf.md. Jedyna zmiana schematu: poszerzenie
-- `method` o wartość używaną przez (a) jednorazową migrację naprawiającą
-- istniejące rewizje ponad nowym limitem `spory` (scripts/profil/
-- migracja-jednorazowa-v8.mjs) i (b) ręczne rozstrzyganie NIEJEDNOZNACZNE
-- dopasowań tematu (scripts/profil/zastosuj-delte-reczna.mjs).
--
-- Addytywne — nie dotyka żadnego istniejącego wiersza, tylko poszerza
-- dozwolony zbiór wartości kolumny `method`.
alter table councilor_profile_revision drop constraint if exists councilor_profile_revision_method_check;
alter table councilor_profile_revision add constraint councilor_profile_revision_method_check
  check (method in ('seed-jednorazowa', 'iteracyjna', 'migracja-reczna'));
