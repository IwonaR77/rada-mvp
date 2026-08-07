# Regulamin serwisu „Rada"

**Wersja:** 1.1
**Data ostatniej aktualizacji:** 2026-08-07

## §1. Postanowienia ogólne

1. Niniejszy Regulamin określa zasady korzystania z serwisu internetowego „Rada" (dalej: „Serwis"), dostępnego pod adresem [uzupełnić domenę].
2. Administratorem Serwisu jest [imię i nazwisko / nazwa], kontakt: [adres e-mail] (dalej: „Administrator").
3. Serwis ma charakter niekomercyjny i hobbystyczny. Jego celem jest ułatwienie mieszkańcom dostępu do transkrypcji nagrań sesji rad miejskich oraz identyfikacja wypowiedzi poszczególnych osób biorących udział w sesji w oparciu o głosowanie społeczności.
4. Dostęp do Serwisu, w tym do przeglądania transkrypcji, wyników głosowań i statystyk, wymaga zalogowania się przy użyciu konta Google lub Facebook (logowanie OAuth). Serwis nie udostępnia dostępu anonimowego ani niezalogowanego — dotyczy to zarówno osób fizycznych, jak i zautomatyzowanych programów (botów, crawlerów).
5. Rozpoczęcie korzystania z Serwisu oznacza akceptację niniejszego Regulaminu.
6. Serwis, w tym jego kod źródłowy i treści interfejsu, powstaje w całości przy wykorzystaniu narzędzi sztucznej inteligencji (AI). Jedynym elementem tworzonym bezpośrednio przez człowieka są polecenia (prompty) kierowane do tych narzędzi. Zasady publikacji promptów wykorzystywanych do generowania podsumowań sesji i opisów spraw określa §7 ust. 7.

## §2. Definicje

- **Użytkownik** — osoba korzystająca z Serwisu, w tym anonimowo przeglądająca treści lub zalogowana poprzez konto Google/Facebook.
- **Segment** — fragment transkrypcji nagrania sesji rady, do którego przypisywana jest osoba wypowiadająca się.
- **Głos** — wskazanie przez Użytkownika, kto wypowiada dany Segment.
- **Reputacja** — parametr liczbowy przypisany Użytkownikowi, wyliczany automatycznie na podstawie historycznej trafności jego głosów, wpływający na wagę oddawanego głosu.
- **Moderator** — Użytkownik posiadający uprawnienia do finalizacji (zamknięcia) Segmentu.
- **Poziom dostępu / Rola** — zestaw uprawnień przypisanych Użytkownikowi w Serwisie, decydujący o zakresie dostępnych mu funkcji (m.in. Użytkownik, Moderator, Administrator).
- **Konto techniczne / konto sugestii automatycznych** — wyodrębnione konto, którego głosy generowane są w sposób zautomatyzowany (np. przy wsparciu modeli językowych) w celu wstępnego wskazania prawdopodobnej osoby wypowiadającej się.
- **Osoba wymieniona w Segmencie** — radny/radna, urzędnik/urzędniczka administracji miejskiej lub inna osoba zaproszona na sesję (np. ekspert, przedstawiciel organizacji, mieszkaniec zabierający głos w ramach głosów mieszkańców), której wypowiedź lub obecność jest wskazywana z imienia i nazwiska w Segmencie na podstawie nagrania sesji rady i jest przedmiotem głosowania Użytkowników.

## §3. Zasady korzystania z Serwisu

1. Przeglądanie transkrypcji, wyników głosowań oraz statystyk, a także oddawanie Głosów i zgłaszanie nieprawidłowości (flagowanie), wymaga zalogowania się przy użyciu konta Google lub Facebook. Administrator nie tworzy odrębnych kont ani haseł — logowanie odbywa się w całości poprzez zewnętrznych dostawców tożsamości (OAuth).
2. Administrator stosuje techniczne środki mające na celu ograniczenie dostępu do Serwisu dla ruchu zautomatyzowanego (botów) oraz wymusza uwierzytelnienie dla wszystkich funkcji Serwisu, w tym samego przeglądania treści.
3. Każdy Użytkownik może oddać jeden Głos na dany Segment. Oddanie Głosu jest jednoznaczne z ujawnieniem go w publicznym, niezważonym histogramie głosów dla danego Segmentu.
4. Wynik „zidentyfikowana osoba" prezentowany publicznie dla Segmentu obliczany jest w sposób ważony — na podstawie Reputacji głosujących Użytkowników, a nie prostej większości głosów.
5. Reputacja Użytkownika jest wyliczana automatycznie na podstawie zgodności jego dotychczasowych Głosów z wynikiem finalnym Segmentów i może ulegać zmianie w czasie. Administrator nie ustala Reputacji ręcznie, poza sytuacjami określonymi w §6.
6. Segmenty mogą zostać oznaczone przez Moderatora jako finalne (zamknięte), co uniemożliwia dalsze głosowanie na dany Segment. Finalizacja nie oznacza gwarancji stuprocentowej trafności wskazania osoby wypowiadającej się.
7. Serwis może wykorzystywać zautomatyzowane sugestie (w tym generowane z pomocą modeli językowych) jako punkt wyjścia do głosowania społeczności. Sugestie te są prezentowane jako głosy konta technicznego i podlegają tym samym zasadom ważenia co głosy pozostałych Użytkowników.
8. Wynik przypisania wypowiedzi wynikający z ważonego głosowania społeczności ma charakter informacyjny i probabilistyczny. Nie jest to zautomatyzowane podejmowanie decyzji wywołujące skutki prawne wobec Osoby wymienionej w Segmencie w rozumieniu art. 22 RODO — wynik może zostać w każdej chwili skorygowany w drodze zgłoszenia, o którym mowa w §8, i nie stanowi ostatecznego, wiążącego ustalenia autorstwa wypowiedzi.

## §5. Poziomy dostępu i role

1. W Serwisie funkcjonują różne poziomy dostępu (role), różniące się zakresem dostępnych funkcji. Podstawowe role to: Użytkownik (głosowanie, przeglądanie), Moderator (dodatkowo: finalizacja Segmentów) oraz Administrator (pełen zakres uprawnień, w tym zarządzanie rolami innych Użytkowników). Wraz z rozwojem Serwisu mogą zostać wprowadzone dodatkowe role o zawężonym zakresie terytorialnym lub tematycznym (np. administrator danego miasta lub rady).
2. Każdy Użytkownik domyślnie otrzymuje najniższy poziom dostępu (rolę Użytkownika) w momencie pierwszego zalogowania.
3. Użytkownik może wystąpić do Administratora z wnioskiem o przyznanie wyższego poziomu dostępu (np. roli Moderatora), wskazując uzasadnienie wniosku, na adres [adres e-mail Administratora].
4. Decyzję o przyznaniu, odmowie przyznania lub zakresie przyznanego poziomu dostępu podejmuje Administrator według własnego uznania. Decyzja nie wymaga uzasadnienia i nie podlega odwołaniu, z zastrzeżeniem możliwości ponownego wystąpienia z wnioskiem w przyszłości.
5. Administrator może samodzielnie, z własnej inicjatywy i bez wniosku Użytkownika, zmienić przyznany poziom dostępu danego Użytkownika, w tym go obniżyć lub cofnąć nadane uprawnienia, w szczególności w przypadku stwierdzenia nadużyć, o których mowa w §6.
6. Administrator może zablokować konto Użytkownika w całości, uniemożliwiając mu dalsze korzystanie z Serwisu, w szczególności w przypadkach opisanych w §6. Zablokowanie konta nie jest równoznaczne z usunięciem danych osobowych Użytkownika — zasady usuwania danych określa §4 ust. 3 oraz Polityka Prywatności.

## §6. Nadużycia i odpowiedzialność Użytkowników

1. Zabronione jest celowe oddawanie fałszywych Głosów, korzystanie z wielu kont w celu manipulacji wynikiem, oraz wszelkie działania mające na celu obejście mechanizmu Reputacji.
2. Administrator lub Moderator może:
   - obniżyć Reputację Użytkownika ręcznie w przypadku stwierdzenia rażącego, celowego nadużycia,
   - zablokować konto Użytkownika dopuszczającego się powtarzających się nadużyć,
   - usunąć lub zignorować Głosy pochodzące z kont podejrzanych o manipulację.
3. Decyzje w powyższym zakresie mogą być podejmowane ręcznie przez Administratora/Moderatora do czasu wdrożenia zautomatyzowanych mechanizmów wykrywania nadużyć.

## §7. Treści, dane osobowe Osób wymienionych w Segmencie i prawa autorskie

1. Transkrypcje bazują na nagraniach sesji rad miejskich, które co do zasady mają charakter jawny i publiczny zgodnie z przepisami o dostępie do informacji publicznej oraz o samorządzie gminnym.
2. Administrator dokłada starań, aby prezentowane transkrypcje odzwierciedlały rzeczywisty przebieg sesji, jednak nie gwarantuje ich pełnej dokładności — transkrypcje mogą zawierać błędy wynikające z jakości nagrania lub automatycznego rozpoznawania mowy.
3. Serwis przetwarza dane osobowe Osób wymienionych w Segmencie (radnych, urzędników oraz zaproszonych gości sesji) w zakresie: imienia i nazwiska, treści wypowiedzi wygłoszonej publicznie na sesji oraz wyniku głosowania społeczności przypisującego im daną wypowiedź. Podstawą prawną tego przetwarzania jest:
   - art. 6 ust. 1 lit. f RODO — prawnie uzasadniony interes Administratora oraz interes publiczny polegający na zwiększeniu przejrzystości pracy organów samorządu i jawności sesji rady,
   - art. 6 ust. 1 lit. e RODO — w zakresie, w jakim przetwarzanie odnosi się do wykonywania zadań publicznych przez radnych i urzędników,
   - art. 85 RODO — przetwarzanie do celów zbliżonych do dziennikarskich (informowanie opinii publicznej o przebiegu sesji organów samorządu),
   - ustawa z dnia 6 września 2001 r. o dostępie do informacji publicznej.
4. W odniesieniu do zaproszonych gości niebędących funkcjonariuszami publicznymi (np. eksperci, przedstawiciele organizacji, mieszkańcy zabierający głos), przetwarzanie ogranicza się wyłącznie do wypowiedzi wygłoszonej jawnie i publicznie w trakcie sesji, utrwalonej w oficjalnym nagraniu rady, i nie obejmuje żadnych dodatkowych danych na ich temat.
5. Przypisanie wypowiedzi do konkretnej Osoby wymienionej w Segmencie wynika z głosowania społeczności i ma charakter probabilistyczny, a nie urzędowego potwierdzenia. Serwis nie ponosi odpowiedzialności za błędne przypisania wynikające z mechanizmu głosowania.
6. Materiały tworzone przez Administratora (np. kod, opisy funkcjonalności, elementy graficzne) podlegają ochronie prawnoautorskiej.
7. Podsumowania sesji oraz opisy spraw prezentowane w Serwisie generowane są przy wykorzystaniu narzędzi sztucznej inteligencji na podstawie ustalonego prompta. Treść tego prompta jest publikowana w Serwisie w formie stałej, analogicznie do niniejszego Regulaminu, i nie podlega edycji przez Użytkowników. Aktualna treść prompta obowiązuje od chwili jej publikacji w Serwisie. Użytkownik może zgłosić uwagę do treści prompta na zasadach określonych w §9 — zgłoszenie nie skutkuje automatyczną zmianą treści, o ewentualnej modyfikacji decyduje Administrator.

## §8. Procedura sprostowania danych osobowych

1. Osoba wymieniona w Segmencie (radny, urzędnik lub zaproszony gość), której wypowiedź została błędnie przypisana, zniekształcona lub której dane są nieprawidłowe, może w każdej chwili zgłosić Administratorowi wniosek o sprostowanie, wskazując: swoje imię i nazwisko, miasto i datę sesji, opis błędu oraz — jeśli to możliwe — link do właściwego fragmentu oficjalnego nagrania lub protokołu potwierdzającego prawidłowy stan rzeczy.
2. Zgłoszenie należy przesłać na adres: [adres e-mail Administratora].
3. Administrator rozpatruje zgłoszenie bez zbędnej zwłoki, a w każdym razie w terminie miesiąca od jego otrzymania, zgodnie z art. 12 ust. 3 RODO (termin ten może zostać przedłużony o kolejne dwa miesiące z uwagi na złożony charakter zgłoszenia, o czym Administrator poinformuje zgłaszającego). Jeżeli zgłoszony błąd zostanie potwierdzony w konfrontacji z oficjalnym nagraniem lub protokołem sesji, korekta Segmentu następuje niezwłocznie po weryfikacji, niezależnie od tego, czy Segment został wcześniej sfinalizowany przez Moderatora.
4. Jeżeli rozbieżność wynika z błędu w samym nagraniu lub protokole źródłowym (np. udostępnionym przez urząd miasta), Administrator pozostawia Segment zgodny ze źródłem i informuje zgłaszającego o właściwej ścieżce sprostowania danych u podmiotu publikującego nagranie/protokół.
5. Niezależnie od powyższej procedury, Osobie wymienionej w Segmencie przysługują prawa opisane w Polityce Prywatności, w tym prawo do sprzeciwu wobec przetwarzania oraz prawo do wniesienia skargi do Prezesa Urzędu Ochrony Danych Osobowych.

## §9. Reklamacje i zgłoszenia Użytkowników

1. Uwagi, zgłoszenia błędnych przypisań, uwagi do treści udostępnionych publicznie promptów wykorzystanych w procesie tworzenia Serwisu lub inne reklamacje dotyczące funkcjonowania Serwisu należy kierować na adres: [adres e-mail Administratora].
2. Administrator rozpatruje zgłoszenia w miarę możliwości i bez zbędnej zwłoki, mając na uwadze hobbystyczny charakter i ograniczone zasoby Serwisu — nie jest to termin gwarantowany ani wynikający z przepisów prawa, poza przypadkami, w których obowiązujące przepisy (np. RODO) przewidują odrębny, wiążący termin.

## §10. Wyłączenie odpowiedzialności

1. Serwis ma charakter hobbystyczny, niekomercyjny i informacyjny. Administrator nie gwarantuje nieprzerwanego, bezbłędnego działania Serwisu.
2. Administrator nie ponosi odpowiedzialności za decyzje podjęte przez Użytkowników na podstawie treści prezentowanych w Serwisie, w szczególności za treść przypisań wynikających z głosowania społeczności.
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
