# Prompt do wygenerowania Regulaminu i Polityki Prywatności serwisu „Rada"

**Wersja:** 1.2
**Data ostatniej aktualizacji:** 2026-08-07

---

Wygeneruj dwa powiązane dokumenty prawne w języku polskim dla serwisu internetowego „Rada": **Regulamin** oraz **Politykę Prywatności**. Oba w formacie Markdown, z numeracją paragrafów (§), gotowe do publikacji na stronie.

## Kontekst serwisu

„Rada" to niekomercyjny, hobbystyczny serwis internetowy umożliwiający mieszkańcom dostęp do transkrypcji nagrań sesji rad miejskich oraz identyfikację osób wypowiadających się na tych sesjach we współpracy ze społecznością zalogowanych współtwórców. Docelowo serwis ma obejmować wiele miast. **Przeglądanie treści Serwisu jest publiczne i nie wymaga logowania** — logowania wymaga wyłącznie współtworzenie (patrz pkt 1 poniżej).

## Wymagania funkcjonalne, które muszą znaleźć odzwierciedlenie w dokumentach

1. **Model dostępu: publiczne przeglądanie, logowanie tylko do współtworzenia.** To świadoma, celowa zmiana modelu dostępu wprowadzona 2026-08-05 — wcześniejsze wersje dokumentów zakładały logowanie do wszystkiego, co jest już nieaktualne. Przeglądanie transkrypcji sesji, spraw, profili radnych i wszelkich innych treści Serwisu (zweryfikowanych/finalized) jest dostępne publicznie, bez logowania — także dla ruchu zautomatyzowanego (crawlerów, botów). Serwis nie stosuje technicznych środków blokujących taki ruch, poza podstawowym rate-limitem na funkcję wyszukiwania. Niezaakceptowane propozycje przypisań pozostają zastrzeżone dla zalogowanych. Logowanie przez OAuth (obecnie: Google; Facebook planowany do dodania w przyszłości — patrz pkt 13) wymagają wyłącznie działania **współtworzące**: proponowanie i zatwierdzanie przypisania wypowiedzi (Segmentu) do osoby, pobieranie surowych plików transkryptu (.txt/.srt) oraz dostęp do panelu administracyjnego.
2. **Mechanizm przypisywania wypowiedzi (bez publicznego głosowania/histogramu).** Segmenty transkrypcji są przypisywane do osób w dwuetapowym procesie współtworzenia, a nie w drodze publicznego głosowania społeczności: Współtwórca z uprawnieniem „Redaktor" **proponuje** przypisanie (Segment otrzymuje status „proposed"); Współtwórca z uprawnieniem „Moderator" **zatwierdza** propozycję albo przypisuje bezpośrednio ze statusem finalnym. Nie ma publicznego surowego histogramu głosów ani osobnego wyniku ważonego jakąkolwiek formą reputacji — **nie opisuj takiego mechanizmu jako aktywnej funkcji Serwisu.**
3. **Brak aktywnego mechanizmu Reputacji.** W bazie danych istnieją nieużywane obecnie kolumny nawiązujące do koncepcji głosowania i reputacji, ale żaden kod Serwisu ich nie odczytuje ani nie zapisuje. Dokumenty **nie mogą** opisywać automatycznego wyliczania i stosowania Reputacji jako działającej funkcji — jeśli wspominają o możliwości takiego rozwoju w przyszłości, musi to być jednoznacznie oznaczone jako plan, nie stan obecny.
4. **Moderacja i finalizacja.** Współtwórcy z uprawnieniem „Moderator" mogą finalizować (zamykać) Segmenty — po finalizacji Segment nie podlega dalszym propozycjom zwykłych Redaktorów. Finalizacja nie jest gwarancją 100% trafności i może zostać cofnięta w drodze procedury sprostowania.
5. **Brak konta technicznego z automatycznymi sugestiami AI.** Serwis obecnie **nie posiada** wyodrębnionego konta, którego przypisania generowane byłyby automatycznie przez modele językowe. Nie opisuj takiej funkcji jako istniejącej; jeśli wspomniana, oznacz ją jednoznacznie jako plan na przyszłość.
6. **Poziomy dostępu i uprawnienia — realny model.** Serwis nie ma trzech płaskich ról „Użytkownik/Moderator/Administrator", tylko system oparty na:
   - **anonimowym dostępie publicznym** (przeglądanie — bez logowania, bez konta),
   - **koncie zalogowanym bez dodatkowych uprawnień** (zalogowanie przez Google nie daje automatycznie prawa do współtworzenia),
   - **nadanych uprawnieniach współtworzenia**, przypisywanych do konta i opcjonalnie zawężonych do konkretnej rady/jednostki terytorialnej: „Redaktor" (może proponować przypisania), „Moderator" (może dodatkowo zatwierdzać/finalizować przypisania oraz pobierać surowe transkrypty .txt/.srt),
   - **uprawnienia „Manager"** — pełny dostęp administracyjny, w tym zarządzanie uprawnieniami innych Użytkowników; nadawane wyłącznie ręcznie przez istniejącego Managera, nie do samodzielnego wnioskowania,
   - odrębnego, historycznego mechanizmu (utrzymywanego wyłącznie ręcznie w bazie danych, poza samoobsługowym wnioskowaniem) odblokowującego najbardziej newralgiczne operacje (import/edycję surowych transkryptów sesji).
   Nowo zalogowany Użytkownik nie ma żadnych uprawnień współtworzenia i musi o nie wystąpić.
7. **Wnioskowanie o dostęp — mechanizm wbudowany w Serwis, nie e-mail.** Zalogowany Użytkownik składa wniosek o nadanie uprawnień (Redaktor lub Moderator), wskazując uzasadnienie oraz — opcjonalnie — konkretną radę, której wniosek dotyczy, za pomocą formularza w Serwisie. Wniosek jest zapisywany i widoczny dla osób z uprawnieniem Managera, które go akceptują albo odrzucają (z opcjonalną notatką decyzji) w panelu administracyjnym Serwisu — nie jest to proces oparty na korespondencji e-mail z Administratorem. Manager może też samodzielnie, z własnej inicjatywy (bez wniosku), nadać, zmienić lub cofnąć uprawnienia danego Użytkownika oraz zablokować jego konto w całości — w obu przypadkach zwłaszcza w związku z nadużyciami.
8. **Serwis budowany w całości przez AI.** Jedynym elementem tworzonym przez człowieka są prompty. Prompt wykorzystywany do generowania **podsumowań sesji i opisów spraw** jest publikowany w Serwisie w formie stałej i niepodlegającej edycji przez Użytkowników (analogicznie jak niniejszy dokument) — Użytkownicy mogą zgłaszać uwagi do jego treści, ale nie edytować go samodzielnie; o modyfikacji decyduje Administrator.
9. **Kategorie osób, których dane są przetwarzane w treściach:**
   - Użytkownicy (konta logujące się i współtworzące — proponujące/zatwierdzające przypisania),
   - „Osoby wymienione w Segmencie" — radni, urzędnicy administracji miejskiej oraz inni zaproszeni goście sesji (eksperci, przedstawiciele organizacji, mieszkańcy zabierający głos), wskazywani z imienia i nazwiska na podstawie oficjalnych, jawnych nagrań sesji.
10. **Ograniczenie przetwarzania danych radnych/urzędników do zakresu funkcji publicznej** — tylko wypowiedzi z oficjalnej sesji, nie życie prywatne; zakończenie kadencji nie usuwa istniejących transkrypcji, ale nie uzasadnia zbierania nowych danych.
11. **Dobrowolność podania danych** przez osoby wymienione w Segmencie — nie podają danych bezpośrednio Administratorowi, podstawą jest uzasadniony interes/interes publiczny, nie zgoda.
12. **Brak zautomatyzowanego podejmowania decyzji w rozumieniu art. 22 RODO** — zarówno wobec Użytkowników, jak i wobec Osób wymienionych w Segmencie (wynik przypisania wypowiedzi) — przypisanie ma charakter propozycji/ustalenia redakcyjnego dokonanego przez człowieka (Redaktora/Moderatora), a nie zautomatyzowanej decyzji, i podlega korekcie.
13. **Stack techniczny:** Next.js + Supabase (baza danych, uwierzytelnianie, Row Level Security). Logowanie OAuth: obecnie wyłącznie przez Google. Logowanie przez Facebook jest planowane do dodania w przyszłości — **dokumenty muszą opisywać stan obecny (tylko Google)** i zostać zaktualizowane (nowa wersja, wpis w Historii zmian) dopiero w chwili faktycznego wdrożenia logowania przez Facebook, nie wcześniej.

## Wymagane sekcje Regulaminu

- Postanowienia ogólne (charakter niekomercyjny/hobbystyczny, publiczny dostęp do przeglądania treści bez logowania, oświadczenie o budowie przez AI)
- Definicje (Użytkownik, Segment, Współtwórca/Redaktor, Moderator, Manager, Osoba wymieniona w Segmencie)
- Zasady korzystania z Serwisu (publiczne przeglądanie vs. współtworzenie wymagające logowania i uprawnień, proces propozycja→zatwierdzenie Segmentu, finalizacja, klauzula o braku automatycznej decyzji w rozumieniu art. 22 RODO)
- Konta i dane logowania (logowanie wyłącznie przez Google OAuth)
- Poziomy dostępu i uprawnienia — model: dostęp publiczny / konto bez uprawnień / uprawnienia Redaktor i Moderator (możliwie zawężone do konkretnej rady) / uprawnienie Manager (pełny dostęp, nadawane wyłącznie ręcznie przez innego Managera); wbudowany w Serwis mechanizm wnioskowania o uprawnienia z uzasadnieniem, swobodna decyzja osoby z uprawnieniem Managera (bez obowiązku uzasadnienia wobec wnioskodawcy, bez trybu odwoławczego poza ponownym wnioskiem), prawo Managera do samodzielnej zmiany/cofnięcia uprawnień oraz zablokowania konta w całości
- Nadużycia i odpowiedzialność Użytkowników (fałszywe/celowo błędne przypisania, wielokonto, sankcje)
- Treści, dane osobowe Osób wymienionych w Segmencie i prawa autorskie — z pełną podstawą prawną (art. 6 ust. 1 lit. f i e RODO, art. 85 RODO, ustawa o dostępie do informacji publicznej) oraz punktem o statycznej publikacji prompta do podsumowań/opisów spraw
- Procedura sprostowania danych osobowych — termin zgodny z art. 12 ust. 3 RODO (miesiąc, przedłużalny o 2 miesiące dla spraw złożonych); rozróżnienie błędu w Serwisie od błędu w źródle
- Reklamacje i zgłoszenia Użytkowników — **bez sztywnego terminu ustawowego** (termin orientacyjny, „w miarę możliwości", z zastrzeżeniem, że przepisy szczególne, np. RODO, mogą przewidywać własny wiążący termin)
- Wyłączenie odpowiedzialności
- Zmiany Regulaminu — z obowiązkiem aktualizacji numeru wersji, daty i wpisu w Historii zmian
- Postanowienia końcowe
- Historia zmian (tabela: wersja / data / opis)

**Uwaga redakcyjna:** paragrafy muszą być numerowane w sposób ciągły, bez przerw (poprzednia wersja Regulaminu miała lukę — §4 zniknął przy dodawaniu nowego paragrafu, a późniejszy paragraf odwoływał się do nieistniejącego numeru). Po każdej zmianie struktury paragrafów zweryfikuj, że wszystkie wewnętrzne odesłania (np. „patrz §X ust. Y") nadal wskazują właściwy paragraf.

## Wymagane sekcje Polityki Prywatności

- Administrator danych — z uzasadnieniem braku obowiązku wyznaczenia IOD (art. 37 RODO: brak statusu podmiotu publicznego, brak dużej skali systematycznego monitorowania) oraz oświadczeniem o budowie Serwisu przez AI i statycznej publikacji prompta do podsumowań
- Dane Użytkowników — zakres (w tym: dane logowania Google OAuth, historia propozycji/zatwierdzeń Segmentów, przypisane uprawnienia), cel, podstawa prawna w formie tabeli, klauzula o braku zautomatyzowanego podejmowania decyzji (art. 22 RODO)
- Dane osobowe radnych, urzędników i zaproszonych gości — zakres, pełna podstawa prawna, ograniczenie do funkcji publicznej, dobrowolność podania danych, brak automatycznej decyzji, prawa tych osób, procedura sprostowania (odesłanie do Regulaminu)
- Odbiorcy danych i transfer poza EOG — Supabase, Google (logowanie); transfer do USA z powołaniem na decyzję KE z 10.07.2023 (EU-U.S. Data Privacy Framework) i SCC jako zabezpieczenie pomocnicze — **bez wzmianek o Facebook/Meta w wersji dokumentów publikowanej dziś: ten dostawca logowania jest planowany, ale jeszcze nie działa w Serwisie.** Sekcję należy rozszerzyć o Meta/Facebook dopiero w wersji dokumentów towarzyszącej faktycznemu wdrożeniu tego logowania.
- Okres przechowywania danych (osobno dla kont, propozycji/zatwierdzeń przypisań, danych osób trzecich, logów)
- Prawa Użytkownika (art. 15–21 RODO + skarga do PUODO)
- Pliki cookies — wyłącznie cookie sesji (Supabase Auth), bez cookies funkcjonalnych/reklamowych/analitycznych, chyba że jawnie zadeklarowano inaczej
- Bezpieczeństwo danych (RLS)
- Naruszenia ochrony danych osobowych — zgłoszenie do UODO w 72h (art. 33 RODO) i informowanie osób przy wysokim ryzyku (art. 34 RODO) — **to jedyny sztywny, prawnie wymagany termin w dokumencie**
- Zmiany Polityki Prywatności — z obowiązkiem aktualizacji wersji/daty/Historii zmian
- Historia zmian (tabela: wersja / data / opis)

**Nie uwzględniaj** osobnej sekcji o „koncie automatycznym / sugestiach AI" jako opisu istniejącej funkcji — Serwis obecnie takiego mechanizmu nie posiada (patrz pkt 5 wymagań funkcjonalnych).

## Zasady ogólne dotyczące stylu i terminów

- Ton formalny, zgodny z konwencją polskich dokumentów RODO, ale bez zbędnego żargonu prawniczego tam, gdzie nie jest konieczny.
- **Sztywne, liczbowe terminy podawaj wyłącznie tam, gdzie wynikają wprost z przepisu prawa** (np. 72h na zgłoszenie naruszenia do UODO — art. 33 RODO; miesiąc na odpowiedź na żądanie sprostowania/dostępu — art. 12 ust. 3 RODO). W pozostałych przypadkach (ogólne reklamacje, zgłoszenia dotyczące funkcjonowania Serwisu) używaj sformułowań w rodzaju „w miarę możliwości", „bez zbędnej zwłoki", z zastrzeżeniem hobbystycznego charakteru i ograniczonych zasobów Administratora.
- Każdy dokument ma w nagłówku pola **Wersja** i **Data ostatniej aktualizacji** oraz sekcję **Historia zmian** na końcu (tabela: wersja / data / krótki opis). Każda kolejna edycja dokumentu wymaga: podniesienia numeru wersji, aktualizacji daty w nagłówku i nowego wiersza w Historii zmian.
- Pola wymagające uzupełnienia przez Administratora (adres e-mail, domena, dokładny okres przechowywania logów) oznaczaj jako `[uzupełnić]`.
- Oba dokumenty muszą się wzajemnie odsyłać (Regulamin → Polityka Prywatności w sprawach danych osobowych; Polityka Prywatności → Regulamin w sprawie procedury sprostowania i zgłaszania uwag do prompta).
- **Przed publikacją nowej wersji dokumentów wygenerowanych z tego prompta zweryfikuj opisane mechanizmy (dostęp publiczny, proces propozycja→zatwierdzenie, dostawcy OAuth, model uprawnień, kanał wnioskowania o dostęp) względem aktualnego stanu kodu Serwisu** — ten prompt opisuje stan na 2026-08-07 i może się zdezaktualizować wraz z rozwojem Serwisu.
