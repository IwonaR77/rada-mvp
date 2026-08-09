# Prompt do wygenerowania Regulaminu i Polityki Prywatności serwisu „Rada"

**Wersja:** 1.1
**Data ostatniej aktualizacji:** 2026-08-07

---

Wygeneruj dwa powiązane dokumenty prawne w języku polskim dla serwisu internetowego „Rada": **Regulamin** oraz **Politykę Prywatności**. Oba w formacie Markdown, z numeracją paragrafów (§), gotowe do publikacji na stronie.

## Kontekst serwisu

„Rada" to niekomercyjny, hobbystyczny serwis internetowy umożliwiający mieszkańcom dostęp do transkrypcji nagrań sesji rad miejskich oraz identyfikację osób wypowiadających się na tych sesjach w drodze głosowania społeczności. Docelowo serwis ma obejmować wiele miast.

## Wymagania funkcjonalne, które muszą znaleźć odzwierciedlenie w dokumentach

1. **Dostęp wyłącznie dla zalogowanych.** Cały Serwis — łącznie z przeglądaniem transkrypcji i wyników — wymaga logowania przez OAuth (Google lub Facebook). Brak jakiegokolwiek dostępu anonimowego, w tym dla botów/crawlerów. Serwis stosuje środki techniczne ograniczające ruch zautomatyzowany.
2. **Mechanizm głosowania:** Użytkownicy przypisują wypowiedzi (Segmenty) do osób. Jeden Głos na Segment na Użytkownika. Wynik publiczny to (a) surowy histogram głosów oraz (b) osobny wynik ważony Reputacją.
3. **Reputacja:** automatycznie wyliczana na podstawie historycznej trafności głosów danego Użytkownika, ustalana w momencie oddania głosu, wpływa na wagę głosu — nie jest ustalana ręcznie poza przypadkami nadużyć.
4. **Moderacja:** wyznaczeni Moderatorzy mogą finalizować (zamykać) Segmenty. Finalizacja nie jest gwarancją 100% trafności i może zostać cofnięta w drodze procedury sprostowania.
5. **Poziomy dostępu i role:** Serwis ma kilka poziomów dostępu (co najmniej: Użytkownik, Moderator, Administrator, z możliwością dalszych ról terytorialnych/tematycznych w przyszłości). Nowy Użytkownik domyślnie otrzymuje najniższy poziom. Użytkownik może wnioskować o zwiększenie poziomu dostępu, wskazując uzasadnienie. Decyzję o przyznaniu, odmowie lub zakresie podejmuje Administrator według własnego uznania, bez obowiązku uzasadnienia i bez trybu odwoławczego (poza możliwością ponownego wniosku). Administrator może też samodzielnie, z własnej inicjatywy, zmienić (w tym obniżyć) poziom dostępu danego Użytkownika oraz zablokować jego konto w całości — w obu przypadkach zwłaszcza w związku z nadużyciami.
6. **Konto techniczne / sugestie AI:** wyodrębnione konto, którego głosy generowane są automatycznie (lokalne modele językowe, pomocniczo zewnętrzne AI) jako wstępna sugestia — podlega tym samym zasadom ważenia co inni użytkownicy.
7. **Serwis budowany w całości przez AI.** Jedynym elementem tworzonym przez człowieka są prompty. Prompt wykorzystywany do generowania **podsumowań sesji i opisów spraw** jest publikowany w Serwisie w formie stałej i niepodlegającej edycji przez Użytkowników (analogicznie jak niniejszy dokument) — Użytkownicy mogą zgłaszać uwagi do jego treści, ale nie edytować go samodzielnie; o modyfikacji decyduje Administrator.
8. **Kategorie osób, których dane są przetwarzane w treściach:**
   - Użytkownicy (konta logujące się i głosujące),
   - „Osoby wymienione w Segmencie" — radni, urzędnicy administracji miejskiej oraz inni zaproszeni goście sesji (eksperci, przedstawiciele organizacji, mieszkańcy zabierający głos), wskazywani z imienia i nazwiska na podstawie oficjalnych, jawnych nagrań sesji.
9. **Ograniczenie przetwarzania danych radnych/urzędników do zakresu funkcji publicznej** — tylko wypowiedzi z oficjalnej sesji, nie życie prywatne; zakończenie kadencji nie usuwa istniejących transkrypcji, ale nie uzasadnia zbierania nowych danych.
10. **Dobrowolność podania danych** przez osoby wymienione w Segmencie — nie podają danych bezpośrednio Administratorowi, podstawą jest uzasadniony interes/interes publiczny, nie zgoda.
11. **Brak zautomatyzowanego podejmowania decyzji w rozumieniu art. 22 RODO** — zarówno wobec Użytkowników (Reputacja), jak i wobec Osób wymienionych w Segmencie (wynik przypisania wypowiedzi) — wynik ma charakter informacyjny/probabilistyczny i podlega korekcie.
12. **Stack techniczny:** Next.js + Supabase (baza danych, uwierzytelnianie, Row Level Security), logowanie OAuth Google/Facebook.

## Wymagane sekcje Regulaminu

- Postanowienia ogólne (charakter niekomercyjny/hobbystyczny, wymóg logowania do całego Serwisu, oświadczenie o budowie przez AI)
- Definicje (Użytkownik, Segment, Głos, Reputacja, Moderator, konto techniczne, Osoba wymieniona w Segmencie)
- Zasady korzystania z Serwisu (mechanizm głosowania, ważenie wyników, finalizacja, sugestie automatyczne, klauzula o braku automatycznej decyzji w rozumieniu art. 22 RODO)
- Konta i dane logowania
- Poziomy dostępu i role — role dostępne w Serwisie, domyślny poziom nowego Użytkownika, prawo Użytkownika do wnioskowania o zwiększenie poziomu dostępu z uzasadnieniem, swobodna decyzja Administratora (bez obowiązku uzasadnienia, bez trybu odwoławczego poza ponownym wnioskiem), prawo Administratora do samodzielnej zmiany/obniżenia poziomu dostępu Użytkownika oraz do zablokowania konta w całości
- Nadużycia i odpowiedzialność Użytkowników (fałszywe głosy, wielokonto, sankcje)
- Treści, dane osobowe Osób wymienionych w Segmencie i prawa autorskie — z pełną podstawą prawną (art. 6 ust. 1 lit. f i e RODO, art. 85 RODO, ustawa o dostępie do informacji publicznej) oraz punktem o statycznej publikacji prompta do podsumowań/opisów spraw
- Procedura sprostowania danych osobowych — termin zgodny z art. 12 ust. 3 RODO (miesiąc, przedłużalny o 2 miesiące dla spraw złożonych); rozróżnienie błędu w Serwisie od błędu w źródle
- Reklamacje i zgłoszenia Użytkowników — **bez sztywnego terminu ustawowego** (termin orientacyjny, „w miarę możliwości", z zastrzeżeniem, że przepisy szczególne, np. RODO, mogą przewidywać własny wiążący termin)
- Wyłączenie odpowiedzialności
- Zmiany Regulaminu — z obowiązkiem aktualizacji numeru wersji, daty i wpisu w Historii zmian
- Postanowienia końcowe
- Historia zmian (tabela: wersja / data / opis)

## Wymagane sekcje Polityki Prywatności

- Administrator danych — z uzasadnieniem braku obowiązku wyznaczenia IOD (art. 37 RODO: brak statusu podmiotu publicznego, brak dużej skali systematycznego monitorowania) oraz oświadczeniem o budowie Serwisu przez AI i statycznej publikacji prompta do podsumowań
- Dane Użytkowników — zakres, cel, podstawa prawna w formie tabeli, klauzula o braku zautomatyzowanego podejmowania decyzji (art. 22 RODO)
- Dane osobowe radnych, urzędników i zaproszonych gości — zakres, pełna podstawa prawna, ograniczenie do funkcji publicznej, dobrowolność podania danych, brak automatycznej decyzji, prawa tych osób, procedura sprostowania (odesłanie do Regulaminu)
- Konto automatyczne / sugestie AI
- Odbiorcy danych i transfer poza EOG — Supabase, Google, Meta; transfer do USA z powołaniem na decyzję KE z 10.07.2023 (EU-U.S. Data Privacy Framework) i SCC jako zabezpieczenie pomocnicze
- Okres przechowywania danych (osobno dla kont, głosów, danych osób trzecich, logów)
- Prawa Użytkownika (art. 15–21 RODO + skarga do PUODO)
- Pliki cookies — wyłącznie cookie sesji (Supabase Auth), bez cookies funkcjonalnych/reklamowych/analitycznych, chyba że jawnie zadeklarowano inaczej
- Bezpieczeństwo danych (RLS)
- Naruszenia ochrony danych osobowych — zgłoszenie do UODO w 72h (art. 33 RODO) i informowanie osób przy wysokim ryzyku (art. 34 RODO) — **to jedyny sztywny, prawnie wymagany termin w dokumencie**
- Zmiany Polityki Prywatności — z obowiązkiem aktualizacji wersji/daty/Historii zmian
- Historia zmian (tabela: wersja / data / opis)

## Zasady ogólne dotyczące stylu i terminów

- Ton formalny, zgodny z konwencją polskich dokumentów RODO, ale bez zbędnego żargonu prawniczego tam, gdzie nie jest konieczny.
- **Sztywne, liczbowe terminy podawaj wyłącznie tam, gdzie wynikają wprost z przepisu prawa** (np. 72h na zgłoszenie naruszenia do UODO — art. 33 RODO; miesiąc na odpowiedź na żądanie sprostowania/dostępu — art. 12 ust. 3 RODO). W pozostałych przypadkach (ogólne reklamacje, zgłoszenia dotyczące funkcjonowania Serwisu) używaj sformułowań w rodzaju „w miarę możliwości", „bez zbędnej zwłoki", z zastrzeżeniem hobbystycznego charakteru i ograniczonych zasobów Administratora.
- Każdy dokument ma w nagłówku pola **Wersja** i **Data ostatniej aktualizacji** oraz sekcję **Historia zmian** na końcu (tabela: wersja / data / krótki opis). Każda kolejna edycja dokumentu wymaga: podniesienia numeru wersji, aktualizacji daty w nagłówku i nowego wiersza w Historii zmian.
- Pola wymagające uzupełnienia przez Administratora (adres e-mail, domena, dokładny okres przechowywania logów) oznaczaj jako `[uzupełnić]`.
- Oba dokumenty muszą się wzajemnie odsyłać (Regulamin → Polityka Prywatności w sprawach danych osobowych; Polityka Prywatności → Regulamin w sprawie procedury sprostowania i zgłaszania uwag do prompta).
