#!/usr/bin/env node
// Jednorazowa autoryzacja do Gmaila — zamienia zgodę w przeglądarce na
// refresh token, który potem żyje jako sekret i nie wygasa.
//
// Uruchamia lokalny serwer na 127.0.0.1 i to on odbiera kod autoryzacyjny
// prosto z przekierowania. Dzięki temu nie ma przeklejania kodu ważnego
// kilkadziesiąt sekund — jedyne, co trzeba zrobić, to kliknąć link i
// zatwierdzić zgodę.
//
// Bez zależności: całe OAuth to dwa żądania HTTP, a dokładanie googleapis
// (kilkadziesiąt MB) dla jednorazowego skryptu byłoby przesadą.
//
//   GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... node scripts/gmail-auth.mjs

import { createServer } from "node:http";

const PORT = 8123;
const REDIRECT = `http://127.0.0.1:${PORT}`;

// gmail.compose — tworzenie wersji roboczych. gmail.readonly — wykrywanie
// odpowiedzi urzędu.
//
// UCZCIWE ZASTRZEŻENIE: Google nie ma zakresu „tylko wersje robocze".
// `gmail.compose` technicznie pozwala też wysyłać. Gwarancja, że automat
// niczego nie wyśle, siedzi więc w naszym kodzie, nie w zakresie uprawnień —
// skrypt tworzący wnioski woła wyłącznie `users.drafts.create` i nie ma
// w sobie ani jednego odwołania do `users.messages.send`.
const SCOPES = [
  "https://www.googleapis.com/auth/gmail.compose",
  "https://www.googleapis.com/auth/gmail.readonly",
].join(" ");

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error(
    "Brakuje GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET w zmiennych środowiskowych."
  );
  process.exit(1);
}

const authUrl =
  "https://accounts.google.com/o/oauth2/v2/auth?" +
  new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT,
    response_type: "code",
    scope: SCOPES,
    // offline + consent: bez tego Google oddaje refresh token tylko przy
    // pierwszej w życiu zgodzie dla danego klienta, a przy powtórce już nie —
    // i człowiek zostaje z samym access tokenem ważnym godzinę.
    access_type: "offline",
    prompt: "consent",
  });

async function wymienKod(code) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT,
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) throw new Error(`Wymiana kodu nieudana: ${await res.text()}`);
  return res.json();
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, REDIRECT);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");

  if (error) {
    res.end("Zgoda odrzucona. Można zamknąć kartę.");
    console.error(`\nGoogle zwrócił błąd: ${error}`);
    server.close();
    process.exit(1);
  }
  if (!code) {
    res.end("Brak kodu w przekierowaniu.");
    return;
  }

  try {
    const tokeny = await wymienKod(code);
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end("Gotowe. Można zamknąć kartę i wrócić do terminala.");
    console.log("\n=== REFRESH TOKEN ===");
    console.log(tokeny.refresh_token ?? "(brak — patrz uwaga o prompt=consent)");
    console.log("=====================");
    console.log(`zakresy: ${tokeny.scope}`);
  } catch (e) {
    res.end("Coś poszło nie tak, szczegóły w terminalu.");
    console.error(e);
  } finally {
    server.close();
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log("Otwórz w przeglądarce i zatwierdź zgodę:\n");
  console.log(authUrl);
  console.log(`\nCzekam na przekierowanie na ${REDIRECT} ...`);
});
