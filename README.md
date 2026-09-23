# 🐾 UwUCatCafe

Bot Discord i prywatny panel zarządu dla firmy RP UwUCatCafe. Polski interfejs, pastelowy wygląd, PostgreSQL i wdrożenie na Railway. Zdjęcia dowodów dotyczą **postaci IC**.

## Funkcje

- `/job osoba zdjecie_dowodu imie_i_nazwisko_ic ssn` — zapisuje dowód IC w bazie, ustawia pseudonim, nadaje Praktykanta i rangę pracownika, zapisuje kto i kiedy zatrudnił.
- `/plus osoba powod` — zostawia tylko aktualną rangę plusów; piąty plus usuwa rangi plusów i zeruje licznik. Historia pozostaje.
- `/minus osoba powod` — pierwszy minus ostrzega, drugi odbiera rangi możliwe do zarządzania i wyrzuca z serwera (bez bana).
- `/awans osoba powod` i `/degrad osoba powod` — zmieniają stanowisko o jeden stopień. Nie nadają zarządu i zatrzymują się na krańcach hierarchii.
- `/zwolnij osoba powod` — odbiera rangi i wyrzuca z serwera, zachowując kartotekę w archiwum.
- `/urlop osoba do_kiedy` — urlop od teraz, ranga urlopowa, pseudonim z `[urlop]`, automatyczny koniec i wiadomość na kanale użycia komendy.
- `/zdejmijurlop osoba powod` — ręczne zakończenie aktywnego lub anulowanie zaplanowanego urlopu.
- `/szukaj osoba` — stanowisko, zatrudniający, data zatrudnienia, plusy, minusy, urlop i ostatnie działania; przyciski historii z paginacją. Profil jest widoczny tylko dla wywołującego pracownika kadry.
- `/bldodaj imie_i_nazwisko zdjecie powod ssn` — dodaje wpis na czarną listę i publikuje na kanale dane postaci, powód i autora, a pod nimi zdjęcie. Jedno SSN może mieć wiele wpisów. Zdjęcia PNG/JPG/WebP do 8 MB są zapisywane w bazie.
- `/blszukaj ssn` — pokazuje wszystkie aktywne powody dla dokładnego SSN (z zachowaniem zer na początku), autorów i daty; długą listę dzieli na strony. Wynik jest prywatny dla wywołującego członka kadry.
- `/blusun ssn` — usuwa wszystkie aktywne wpisy tej osoby z czarnej listy. Historia dodania i usunięcia zostaje w logach. Komendy czarnej listy używają tej samej rangi zarządu co pozostałe komendy; nie nadają bana Discord.
- Panel ticketów pojawia się automatycznie na ustalonym kanale: kontakt z zarządem i wniosek urlopowy, formularze, prywatne kanały, zatwierdzanie i odrzucanie, zamykanie z powodem.
- Panel WWW: kartoteki ze zdjęciami, wyszukiwanie, osobne kategorie logów, filtrowanie wykonawcy i pracownika, operacje kadrowe, decyzje urlopowe, zapis rozmów ticketów.

Każda karta Discord ma stopkę „🐾 UwUCatCafe”. Nie pokazujemy numerów operacji. Potwierdzenia działań są publiczne na kanale, a błędy oraz profil są prywatne. Dowód i SSN nie pojawiają się w publicznym potwierdzeniu `/job`.

## Discord Developer Portal

1. Utwórz aplikację i bota. Zapisz **Application ID**, **Client Secret** (OAuth2) oraz **Bot Token** jako zmienne środowiskowe — nie w repozytorium ani rozmowie.
2. W **Bot → Privileged Gateway Intents** włącz **Server Members Intent** oraz **Message Content Intent**. Presence Intent nie jest potrzebny.
3. W **OAuth2 → URL Generator** zaznacz `bot` i `applications.commands`. Uprawnienia: View Channels, Send Messages, Embed Links, Attach Files, Read Message History, Manage Roles, Manage Nicknames, Manage Channels, Kick Members. Administrator nie jest wymagany.
4. Zaproś bota na serwer. Przenieś jego rolę powyżej wszystkich rang osób, które ma obsługiwać. Bot nie może zarządzać właścicielem serwera, rangami powyżej swojej ani rangami zarządzanymi przez integracje.
5. W **OAuth2 → Redirects** dodaj dokładnie `https://TWOJA-DOMENA/auth/callback` (adres panelu Railway).
6. ID serwera skopiujesz po włączeniu trybu deweloperskiego w Discordzie: kliknij serwer prawym przyciskiem → Kopiuj ID serwera.

Wszystkie komendy i operacje WWW sprawdzają rangę `1552233307713044520` po stronie serwera. Właściciel/administrator bez tej rangi też nie przejdzie sprawdzenia. Przyciski tworzenia własnych ticketów są dostępne dla członków serwera. Administratorzy Discorda mogą widzieć prywatne kanały na zasadach platformy.

Opcjonalnie ukryj komendy przed pozostałymi osobami w **Ustawienia serwera → Integracje → bot → Komendy**. To ustawienie widoczności; kontrola dostępu w kodzie działa niezależnie.

## Railway — bot, panel i baza

1. **New Project → Deploy from GitHub repo → pykucreative-jpg/UwUCatCafe**. W usłudze aplikacji ustaw **Settings → Builder → Dockerfile** (ścieżka `/Dockerfile`).
2. Dodaj do tego samego projektu usługę **PostgreSQL**.
3. W usłudze aplikacji dodaj zmienne:

| Zmienna | Wartość |
| --- | --- |
| `DATABASE_URL` | Odwołanie do `DATABASE_URL` usługi PostgreSQL, najlepiej adres sieci prywatnej |
| `DISCORD_TOKEN` | Bot Token z zakładki Bot |
| `DISCORD_CLIENT_ID` | Application ID |
| `DISCORD_CLIENT_SECRET` | Client Secret z OAuth2 |
| `DISCORD_GUILD_ID` | ID serwera Discord |
| `PUBLIC_URL` | `https://adres-aplikacji.up.railway.app`, bez `/auth/callback` |
| `NODE_ENV` | `production` |
| `PORT` | `3000` — ustaw również port 3000 przy generowaniu domeny |

4. W ustawieniach sieci aplikacji wygeneruj publiczną domenę i uzupełnij `PUBLIC_URL`. Ten adres + `/auth/callback` wpisz w Discord OAuth2 Redirects.
5. W **Settings** ustaw **Healthcheck Path** `/healthz`, **Healthcheck Timeout** `120`, **Restart Policy** `On Failure` (10 prób) oraz **Wait for CI**. Zapisz zmiany i wykonaj wdrożenie. Bot tworzy tabele, rejestruje komendy i publikuje lub aktualizuje panel ticketów. Przy pierwszym uruchomieniu bez zmiennych usługa celowo się nie uruchomi.
6. Utrzymuj **jedną replikę aplikacji**; wyłącz usypianie/serverless, jeśli jest włączone. Bot potrzebuje stałego połączenia Discord. Nie uruchamiaj jednocześnie drugiej kopii z tym samym tokenem i bazą.
7. Otwórz stronę i zaloguj się przez Discord kontem ze wskazaną rangą. Sprawdź działanie na testowym pracowniku przed użyciem zwolnień.

Aplikacja nasłuchuje na `0.0.0.0` i porcie `PORT`. `/healthz` zwraca 200 dopiero, gdy baza i bot są gotowe. Trwałe dane, sesje i **binarne zdjęcia dowodów** są w PostgreSQL, więc dysk aplikacji może być nietrwały. Włącz kopie zapasowe bazy w Railway; zdjęcia do 8 MB zwiększają jej rozmiar.

**Aktualizacja Railway, wrzesień 2026:** nowe usługi nie włączają już starszego Config as Code. Plik `railway.json` jest pozostawiony dla zgodności ze starszymi instalacjami; w nowym projekcie skonfiguruj powyższe ustawienia w panelu Railway.

Klucz podpisujący sesje logowania powstaje automatycznie przy pierwszym starcie i jest trwale zapisany w prywatnej tabeli `settings` w PostgreSQL. Nie trzeba wpisywać `SESSION_SECRET`; ewentualna stara zmienna o tej nazwie jest ignorowana. Restarty używają tego samego klucza. Klucz nie jest zwracany przez API ani zapisywany w logach. Przy przejściu ze starszej wersji użytkownicy zalogują się ponownie jeden raz.

## Uruchomienie lokalne

Node.js 22.12+ i PostgreSQL 15+:

```sh
npm ci
# Skopiuj .env.example do .env i uzupełnij wartości.
npm start
```

Dla lokalnego logowania ustaw `PUBLIC_URL=http://localhost:3000` oraz Redirect URI `http://localhost:3000/auth/callback`.

`npm run demo` uruchamia osobny podgląd na `http://127.0.0.1:3000` z fikcyjnymi danymi i wyłączonym zapisem. Nie wymaga Discorda ani PostgreSQL. Skrypt demo nie jest kopiowany do obrazu produkcyjnego.

## Testy

```sh
npm run check
npm test
npm audit --omit=dev
```

Testy obejmują cykl plusów, drugi minus i wyrzucenie, hierarchię, role dostępu, zapis zatrudniającego i dowodu, wznowienie urlopów po awarii, decyzje urlopowe, polski czas i zmianę czasu, sesje WWW, CSRF i wyszukiwanie w SQL. Baza testowa PGlite uruchamia PostgreSQL w pamięci; operacje Discord są symulowane. GitHub Actions wykonuje te same kontrole.

## Zachowanie przy awariach

- Działania są serializowane dla pracownika blokadą PostgreSQL. Log powstaje przed modyfikacją Discord, a potem otrzymuje wynik i listę wykonanych kroków.
- Discord i baza nie mają wspólnej transakcji. Awaria może zostawić częściową zmianę; panel pokazuje wynik „Wykonano częściowo” albo niedokończony wpis „Oczekuje”. Sprawdź stan przed ręcznym ponowieniem. Zwolnienia nie są automatycznie ponawiane.
- Urlopy są sprawdzane co 15 sekund, także po restarcie. Nieudane zmiany urlopu wracają do próby po 5 minutach. Gdy bot jest offline, zadanie wykona po ponownym uruchomieniu.
- Powiadomienia i logi Discord mają trwałą kolejkę. Po wyjątkowej awarii między wysłaniem wiadomości a potwierdzeniem w bazie możliwy jest duplikat. Jeśli kanał usunięto albo bot nie ma dostępu, wpis zostaje do ponowienia w bazie.
- Rozmowy ticketów są zapisywane na bieżąco, a przy zamknięciu bot uzupełnia dostępną historię kanału. Nie odzyska wiadomości usuniętych podczas jego nieobecności. Zamknięty kanał pozostaje archiwum. Załączniki rozmów są linkami Discord i mogą wygasnąć; **dowody z zatrudnienia są przechowywane trwale**, niezależnie od linku Discord.
- Dane historyczne sprzed uruchomienia bota nie są odtwarzane. Bieżące rangi plusów/minusów/stanowiska są odczytywane z Discorda przy komendzie i otwarciu kartoteki; lista panelu pokazuje ostatnio zapisany stan.

## Konfiguracja rang i kanałów

Wszystkie podane ID są zapisane w `src/config.js`. Hierarchia: Praktykant → Kelner → Młodszy kucharz → Kucharz → Szef kuchni. Nie ma awansu do zarządu. Dowody, SSN, tokeny i plik `.env` nie należą do publicznego repozytorium. Dostęp do zdjęć wymaga aktualnej sesji i rangi, tak jak pozostałe API.

Dokumentacja: [Discord OAuth2](https://docs.discord.com/developers/topics/oauth2), [uprawnienia Discord](https://docs.discord.com/developers/topics/permissions), [Railway Dockerfiles](https://docs.railway.com/guides/dockerfiles), [Railway PostgreSQL](https://docs.railway.com/guides/postgresql).
