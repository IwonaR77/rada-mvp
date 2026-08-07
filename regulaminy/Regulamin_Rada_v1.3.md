# Regulamin serwisu „Rada"

**Wersja:** 1.3
**Data ostatniej aktualizacji:** 2026-08-07

## §1. Postanowienia ogólne

1. Niniejszy Regulamin określa zasady korzystania z serwisu internetowego „Rada" (dalej: „Serwis"), dostępnego pod adresem [uzupełnić].
2. Administratorem Serwisu jest [uzupełnić] (osoba fizyczna), kontakt: iwona.rysik@gmail.com (dalej: „Administrator").
3. Serwis ma charakter niekomercyjny i hobbystyczny. Jego celem jest ułatwienie mieszkańcom dostępu do transkrypcji nagrań sesji rad miejskich oraz identyfikacja osób wypowiadających się na tych sesjach we współpracy ze społecznością zalogowanych współtwórców. Docelowo Serwis ma obejmować wiele miast.
4. Korzystanie z Serwisu — w tym samo przeglądanie jego treści: transkrypcji sesji, spraw, profili radnych i pozostałych treści — wymaga zalogowania. Serwis nie udostępnia żadnych treści bez zalogowania, także wobec ruchu zautomatyzowanego (crawlerów, botów). Zasady logowania oraz automatycznego nadania uprawnienia przeglądania określają §3 i §5.
5. Rozpoczęcie korzystania z Serwisu, w tym pierwsze zalogowanie się do Serwisu, oznacza akceptację niniejszego Regulaminu.
6. Serwis, w tym jego kod źródłowy i treści interfejsu, powstaje w całości przy wykorzystaniu narzędzi sztucznej inteligencji (AI). Jedynym elementem tworzonym bezpośrednio przez człowieka są polecenia (prompty) kierowane do tych narzędzi. Zasady publikacji prompta wykorzystywanego do generowania podsumowań sesji i opisów spraw określa §7 ust. 7.

## §2. Definicje

- **Użytkownik** — osoba posiadająca konto w Serwisie, zalogowana za pośrednictwem konta Google (OAuth).
- **Uprawnienie przeglądania (browse)** — podstawowe uprawnienie nadawane automatycznie każdemu kontu z chwilą pierwszego zalogowania do Serwisu, umożliwiające przeglądanie jego treści. Jest to odrębne, technicznie nadawane i odwoływalne uprawnienie (nie tylko fakt bycia zalogowanym) — jego cofnięcie przez Managera blokuje dostęp zalogowanego konta do treści Serwisu bez usuwania samego konta.
- **Segment** — fragment transkrypcji nagrania sesji rady, do którego przypisywana jest osoba wypowiadająca się.
- **Współtwórca** — Użytkownik, któremu nadano uprawnienie współtworzenia Serwisu (Redaktor lub Moderator), opcjonalnie zawężone do konkretnej rady/jednostki terytorialnej.
- **Redaktor** — Współtwórca posiadający uprawnienie do proponowania przypisania Segmentu do Osoby wymienionej w Segmencie.
- **Moderator** — Współtwórca posiadający uprawnienie do zatwierdzania propozycji przypisań, przypisywania Segmentów bezpośrednio ze statusem finalnym, finalizacji (zamykania) Segmentów oraz pobierania surowych plików transkryptu (.txt/.srt).
- **Manager** — Współtwórca posiadający pełny zakres uprawnień administracyjnych w Serwisie, w tym prawo do zarządzania uprawnieniami innych Użytkowników, w tym Uprawnieniem przeglądania.
- **Osoba wymieniona w Segmencie** — radny/radna, urzędnik/urzędniczka administracji miejskiej lub inna osoba zaproszona na sesję (np. ekspert, przedstawiciel organizacji, mieszkaniec zabierający głos), której wypowiedź lub obecność jest wskazywana z imienia i nazwiska w Segmencie na podstawie oficjalnego, jawnego nagrania sesji rady.

## §3. Zasady korzystania z Serwisu

1. Korzystanie z Serwisu, w tym przeglądanie transkrypcji sesji, spraw, profili radnych oraz pozostałych treści Serwisu, wymaga zalogowania przez Google OAuth (patrz §4). Serwis nie udostępnia żadnych treści bez zalogowania — dotyczy to również ruchu zautomatyzowanego (botów, crawlerów).
2. Z chwilą pierwszego zalogowania konto Użytkownika otrzymuje automatycznie Uprawnienie przeglądania, o którym mowa w §2, umożliwiające dostęp do treści Serwisu. Cofnięcie tego uprawnienia przez Managera, na zasadach opisanych w §5, blokuje zalogowanemu Użytkownikowi dostęp do treści Serwisu bez konieczności usuwania jego konta.
3. Działania współtworzące — proponowanie i zatwierdzanie przypisania Segmentu do Osoby wymienionej w Segmencie, pobieranie surowych plików transkryptu (.txt/.srt) oraz dostęp do panelu administracyjnego Serwisu — wymagają posiadania odrębnych, dodatkowych uprawnień, o których mowa w §5, wykraczających poza samo Uprawnienie przeglądania.
4. Segmenty transkrypcji są przypisywane do osób w dwuetapowym procesie redakcyjnym, a nie w drodze publicznego głosowania społeczności: Współtwórca z uprawnieniem Redaktora **proponuje** przypisanie (Segment otrzymuje status „proposed"), a Współtwórca z uprawnieniem Moderatora **zatwierdza** propozycję albo przypisuje Segment bezpośrednio ze statusem finalnym. Serwis nie prezentuje publicznego, surowego histogramu głosów ani wyniku ważonego jakąkolwiek formą reputacji Użytkowników — mechanizm taki nie jest aktywną funkcją Serwisu.
5. Moderator może finalizować (zamykać) Segmenty — po finalizacji Segment nie podlega dalszym propozycjom ze strony zwykłych Redaktorów. Finalizacja nie jest gwarancją stuprocentowej trafności wskazania osoby wypowiadającej się i może zostać cofnięta w drodze procedury sprostowania opisanej w §8.
6. Serwis obecnie nie posiada wyodrębnionego konta technicznego, którego przypisania generowane byłyby automatycznie przez modele językowe lub inne mechanizmy zautomatyzowane. Wprowadzenie takiej funkcji w przyszłości wymagałoby aktualizacji niniejszego Regulaminu.
7. Wynik przypisania wypowiedzi do Osoby wymienionej w Segmencie ma charakter propozycji lub ustalenia redakcyjnego dokonanego przez człowieka (Redaktora/Moderatora), nie zaś zautomatyzowanego podejmowania decyzji w rozumieniu art. 22 RODO. Wynik ten może zostać w każdej chwili skorygowany w drodze zgłoszenia, o którym mowa w §8, i nie stanowi ostatecznego, wiążącego ustalenia autorstwa wypowiedzi.

## §4. Konta i dane logowania

1. Logowanie do Serwisu odbywa się wyłącznie za pośrednictwem konta Google (OAuth). Administrator nie tworzy odrębnych kont ani haseł w Serwisie — logowanie odbywa się w całości poprzez zewnętrznego dostawcę tożsamości.
2. Logowanie przez Facebook jest planowane do wdrożenia w przyszłości. Do czasu jego faktycznego udostępnienia w Serwisie logowanie tą metodą nie jest możliwe, a niniejszy Regulamin nie opisuje go jako dostępnej funkcji.
3. Zalogowanie się do Serwisu skutkuje automatycznym nadaniem Uprawnienia przeglądania, o którym mowa w §2 i §3 ust. 2, nie nadaje natomiast żadnych uprawnień współtworzenia — zasady ich uzyskiwania określa §5.
4. Zakres danych przetwarzanych w związku z logowaniem oraz zasady ich przetwarzania określa Polityka Prywatności Serwisu.

## §5. Poziomy dostępu i uprawnienia

1. Serwis nie posiada trzech płaskich ról „Użytkownik/Moderator/Administrator". Dostęp do Serwisu opiera się na następujących poziomach:
   - **Uprawnienie przeglądania (browse)** — nadawane automatycznie każdemu kontu z chwilą pierwszego zalogowania (patrz §3 ust. 2); jego brak (np. wskutek cofnięcia przez Managera) uniemożliwia zalogowanemu Użytkownikowi przeglądanie treści Serwisu,
   - **nadane uprawnienia współtworzenia**, przypisane do konta i opcjonalnie zawężone do konkretnej rady/jednostki terytorialnej: uprawnienie **Redaktora** (proponowanie przypisań) oraz uprawnienie **Moderatora** (dodatkowo: zatwierdzanie/finalizacja przypisań oraz pobieranie surowych transkryptów .txt/.srt) — uprawnienia te NIE są nadawane automatycznie,
   - **uprawnienie Managera** — pełny dostęp administracyjny, w tym zarządzanie uprawnieniami innych Użytkowników, w tym Uprawnieniem przeglądania; nadawane wyłącznie ręcznie przez istniejącego Managera i niepodlegające samodzielnemu wnioskowaniu,
   - odrębny, historyczny mechanizm — utrzymywany wyłącznie ręcznie w bazie danych Serwisu, poza samoobsługowym wnioskowaniem opisanym w ust. 3 — odblokowujący najbardziej newralgiczne operacje, tj. import lub edycję surowych transkryptów sesji.
2. Nowo zalogowany Użytkownik posiada wyłącznie Uprawnienie przeglądania i musi osobno wystąpić o uprawnienia współtworzenia na zasadach opisanych w ust. 3.
3. Zalogowany Użytkownik składa wniosek o nadanie uprawnienia współtworzenia (Redaktor lub Moderator — Uprawnienie przeglądania posiada już automatycznie) za pomocą formularza dostępnego w Serwisie, wskazując uzasadnienie oraz — opcjonalnie — konkretną radę, której wniosek dotyczy. Wniosek jest zapisywany i widoczny w panelu administracyjnym Serwisu dla osób z uprawnieniem Managera, które go akceptują albo odrzucają (z opcjonalną notatką decyzji). Wnioskowanie nie odbywa się w drodze korespondencji e-mail z Administratorem.
4. Decyzję o przyznaniu, odmowie przyznania lub zakresie przyznanego uprawnienia podejmuje osoba z uprawnieniem Managera według własnego uznania. Decyzja nie wymaga uzasadnienia wobec wnioskodawcy i nie podlega odwołaniu, z zastrzeżeniem możliwości ponownego wystąpienia z wnioskiem w przyszłości.
5. Manager może samodzielnie, z własnej inicjatywy i bez wniosku Użytkownika, nadać, zmienić lub cofnąć dowolne uprawnienia danego Użytkownika — w tym samo Uprawnienie przeglądania — w szczególności w związku z nadużyciami, o których mowa w §6.
6. Cofnięcie Uprawnienia przeglądania przez Managera blokuje Użytkownikowi możliwość korzystania z Serwisu w całości, bez usuwania jego konta ani danych osobowych. Zasady przechowywania i usuwania danych po zablokowaniu Uprawnienia przeglądania określa Polityka Prywatności Serwisu, §6.

## §6. Nadużycia i odpowiedzialność Użytkowników

1. Zabronione jest celowe zgłaszanie fałszywych lub świadomie błędnych przypisań Segmentów, korzystanie z wielu kont w celu manipulacji, a także wszelkie działania mające na celu obejście mechanizmu uprawnień opisanego w §5.
2. Manager, a w zakresie danej rady także Moderator, może:
   - cofnąć lub ograniczyć uprawnienia Użytkownika dopuszczającego się rażącego, celowego nadużycia, w tym cofnąć Uprawnienie przeglądania,
   - zablokować konto Użytkownika dopuszczającego się powtarzających się nadużyć,
   - usunąć lub odrzucić propozycje przypisań pochodzące z kont podejrzanych o manipulację.
3. Decyzje w powyższym zakresie podejmowane są ręcznie przez osoby z uprawnieniem Moderatora lub Managera.

## §7. Treści, dane osobowe Osób wymienionych w Segmencie i prawa autorskie

1. Transkrypcje bazują na nagraniach sesji rad miejskich, które co do zasady mają charakter jawny i publiczny zgodnie z przepisami o dostępie do informacji publicznej oraz o samorządzie gminnym.
2. Administrator dokłada starań, aby prezentowane transkrypcje odzwierciedlały rzeczywisty przebieg sesji, jednak nie gwarantuje ich pełnej dokładności — transkrypcje mogą zawierać błędy wynikające z jakości nagrania lub automatycznego rozpoznawania mowy.
3. Serwis przetwarza dane osobowe Osób wymienionych w Segmencie (radnych, urzędników oraz zaproszonych gości sesji) w zakresie: imienia i nazwiska, treści wypowiedzi wygłoszonej publicznie na sesji oraz wyniku przypisania tej wypowiedzi ustalonego w procesie opisanym w §3. Podstawą prawną tego przetwarzania jest:
   - art. 6 ust. 1 lit. f RODO — prawnie uzasadniony interes Administratora oraz interes publiczny polegający na zwiększeniu przejrzystości pracy organów samorządu i jawności sesji rady,
   - art. 6 ust. 1 lit. e RODO — w zakresie, w jakim przetwarzanie odnosi się do wykonywania zadań publicznych przez radnych i urzędników,
   - art. 85 RODO — przetwarzanie do celów zbliżonych do dziennikarskich (informowanie opinii publicznej o przebiegu sesji organów samorządu),
   - ustawa z dnia 6 września 2001 r. o dostępie do informacji publicznej.
4. W odniesieniu do zaproszonych gości niebędących funkcjonariuszami publicznymi (np. eksperci, przedstawiciele organizacji, mieszkańcy zabierający głos), przetwarzanie ogranicza się wyłącznie do wypowiedzi wygłoszonej jawnie i publicznie w trakcie sesji, utrwalonej w oficjalnym nagraniu rady, i nie obejmuje żadnych dodatkowych danych na ich temat.
5. Przypisanie wypowiedzi do konkretnej Osoby wymienionej w Segmencie wynika z procesu współtworzenia opisanego w §3 i ma charakter redakcyjnego ustalenia, a nie urzędowego potwierdzenia. Serwis nie ponosi odpowiedzialności za błędne przypisania wynikające z tego mechanizmu.
6. Materiały tworzone przez Administratora (np. kod, opisy funkcjonalności, elementy graficzne) podlegają ochronie prawnoautorskiej.
7. Podsumowania sesji oraz opisy spraw prezentowane w Serwisie generowane są przy wykorzystaniu narzędzi sztucznej inteligencji na podstawie ustalonego prompta. Treść tego prompta jest publikowana w Serwisie w formie stałej, analogicznie do niniejszego Regulaminu, i nie podlega edycji przez Użytkowników. Aktualna treść prompta obowiązuje od chwili jej publikacji w Serwisie. Użytkownik może zgłosić uwagę do treści prompta na zasadach określonych w §9 — zgłoszenie nie skutkuje automatyczną zmianą treści, o ewentualnej modyfikacji decyduje Administrator.

## §8. Procedura sprostowania danych osobowych

1. Osoba wymieniona w Segmencie (radny, urzędnik lub zaproszony gość), której wypowiedź została błędnie przypisana, zniekształcona lub której dane są nieprawidłowe, może w każdej chwili zgłosić Administratorowi wniosek o sprostowanie, wskazując: swoje imię i nazwisko, miasto i datę sesji, opis błędu oraz — jeśli to możliwe — link do właściwego fragmentu oficjalnego nagrania lub protokołu potwierdzającego prawidłowy stan rzeczy.
2. Zgłoszenie należy przesłać na adres: iwona.rysik@gmail.com.
3. Administrator rozpatruje zgłoszenie bez zbędnej zwłoki, a w każdym razie w terminie miesiąca od jego otrzymania, zgodnie z art. 12 ust. 3 RODO (termin ten może zostać przedłużony o kolejne dwa miesiące z uwagi na złożony charakter zgłoszenia, o czym Administrator poinformuje zgłaszającego). Jeżeli zgłoszony błąd zostanie potwierdzony w konfrontacji z oficjalnym nagraniem lub protokołem sesji, korekta Segmentu następuje niezwłocznie po weryfikacji, niezależnie od tego, czy Segment został wcześniej sfinalizowany przez Moderatora.
4. Jeżeli rozbieżność wynika z błędu w samym nagraniu lub protokole źródłowym (np. udostępnionym przez urząd miasta), Administrator pozostawia Segment zgodny ze źródłem i informuje zgłaszającego o właściwej ścieżce sprostowania danych u podmiotu publikującego nagranie/protokół.
5. Niezależnie od powyższej procedury, Osobie wymienionej w Segmencie przysługują prawa opisane w Polityce Prywatności, w tym prawo do sprzeciwu wobec przetwarzania oraz prawo do wniesienia skargi do Prezesa Urzędu Ochrony Danych Osobowych.

## §9. Reklamacje i zgłoszenia Użytkowników

1. Uwagi, zgłoszenia błędnych przypisań, uwagi do publikowanej treści prompta wykorzystywanego w procesie tworzenia Serwisu lub inne reklamacje dotyczące funkcjonowania Serwisu należy kierować na adres: iwona.rysik@gmail.com.
2. Administrator rozpatruje zgłoszenia w miarę możliwości i bez zbędnej zwłoki, mając na uwadze hobbystyczny charakter i ograniczone zasoby Serwisu — nie jest to termin gwarantowany ani wynikający z przepisów prawa, poza przypadkami, w których obowiązujące przepisy (np. RODO) przewidują odrębny, wiążący termin.

## §10. Wyłączenie odpowiedzialności

1. Serwis ma charakter hobbystyczny, niekomercyjny i informacyjny. Administrator nie gwarantuje nieprzerwanego, bezbłędnego działania Serwisu.
2. Administrator nie ponosi odpowiedzialności za decyzje podjęte przez Użytkowników na podstawie treści prezentowanych w Serwisie, w szczególności za treść przypisań wynikających z procesu współtworzenia opisanego w §3.
3. Administrator zastrzega sobie prawo do czasowego lub trwałego zawieszenia działania Serwisu bez wcześniejszego uprzedzenia.

## §11. Zmiany Regulaminu

1. Administrator zastrzega sobie prawo do zmiany Regulaminu. Każda zmiana skutkuje aktualizacją numeru wersji oraz daty ostatniej aktualizacji podanych w nagłówku dokumentu, a także wpisem w Historii zmian na końcu Regulaminu. Zmiany wchodzą w życie z dniem publikacji nowej wersji w Serwisie.
2. W przypadku istotnych zmian Administrator poinformuje o tym w widocznym miejscu w Serwisie.

## §12. Postanowienia końcowe

1. W sprawach nieuregulowanych niniejszym Regulaminem zastosowanie mają przepisy prawa polskiego, w szczególności Kodeksu cywilnego oraz ustawy o świadczeniu usług drogą elektroniczną.
2. Regulamin wchodzi w życie z dniem publikacji w Serwisie.

## Historia zmian

| Wersja | Data | Opis zmiany |
|---|---|---|
| 1.0 | 2026-08-07 | Pierwsza opublikowana wersja Regulaminu. |
| 1.1 | 2026-08-07 | Dodano §5 Poziomy dostępu i role (wnioskowanie o zwiększenie dostępu, decyzja Administratora, samodzielna zmiana poziomu przez Administratora, blokada konta); przenumerowano kolejne paragrafy. |
| 1.2 | 2026-08-07 | Dostosowano treść do faktycznie wdrożonego modelu dostępu: publiczne przeglądanie treści bez logowania (logowanie wymagane wyłącznie do współtworzenia), model uprawnień oparty na tablicy uprawnień (Redaktor/Moderator/Manager, opcjonalnie zawężonych do rady) w miejsce trzech płaskich ról, wbudowany w Serwis formularz wnioskowania o uprawnienia i kolejka akceptacji przez Managera w miejsce wniosków e-mailowych, dodano §4 Konta i dane logowania (wyłącznie Google OAuth, Facebook jako plan na przyszłość). Usunięto opis nieaktywnych mechanizmów: publicznego histogramu głosów, wyniku ważonego Reputacją oraz konta technicznego z automatycznymi sugestiami AI. Naprawiono lukę w numeracji paragrafów (brakujący §4) oraz powiązane odesłania wewnętrzne. |
| 1.3 | 2026-08-07 | Cofnięto eksperymentalny model publicznego przeglądania bez logowania wprowadzony w wersji 1.2 tego samego dnia — korzystanie z Serwisu, w tym samo przeglądanie treści, wymaga ponownie zalogowania, bez wyjątku dla ruchu zautomatyzowanego. Wprowadzono pojęcie automatycznie nadawanego, odrębnego i odwoływalnego Uprawnienia przeglądania (§2, §3 ust. 1–2, §4 ust. 3, §5), nadawanego każdemu kontu z chwilą pierwszego zalogowania, dzięki czemu Manager może zablokować dostęp Użytkownika do Serwisu przez samo cofnięcie tego uprawnienia, bez usuwania konta. Uzupełniono dane kontaktowe Administratora o adres e-mail (iwona.rysik@gmail.com). |
