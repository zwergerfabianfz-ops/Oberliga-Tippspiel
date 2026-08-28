# Oberliga Tippspiel

Ein plattformübergreifender Expo-MVP für iOS und Android mit Supabase-Backend.

## Enthalten

- Registrierung und Anmeldung mit E-Mail/Passwort
- Tipps für Hauptrunde und Playoffs, serverseitig exakt zum Spielbeginn gesperrt
- Wertung: exaktes Ergebnis 3, richtige Tordifferenz 2, richtiger Sieger 1, sonst 0 Punkte
- einmaliger, bis zur Deadline änderbarer Hauptrunden-Tabellentipp
- getrennte Ranglisten für Spiel- und Tabellentipps
- serverseitig konfigurierbarer DEB/HockeyData-Import
- Expo/EAS-Konfiguration für App Store und Google Play
- vom Auftraggeber bereitgestelltes App-Icon (`assets/icon.jpeg`) und verlustfrei konvertierte Store-Datei (`assets/icon.png`)

## Lokaler Start

1. `npm install`
2. `.env.example` nach `.env` kopieren und Supabase-Werte eintragen.
3. Migration mit der Supabase CLI anwenden.
4. `npm start`

Ohne `.env` startet die App bewusst im Demo-Modus. Das aktuelle Container-Image enthält noch keine Node.js-Laufzeit.

## Kostenlose PWA

Die App kann ohne Store als installierbare Web-App betrieben werden:

1. Auf dem Hosting die Variablen `EXPO_PUBLIC_SUPABASE_URL` und `EXPO_PUBLIC_SUPABASE_ANON_KEY` setzen.
2. Build-Befehl `npm run build:web` verwenden.
3. Das erzeugte Verzeichnis `dist` veröffentlichen.

Bei Cloudflare Pages oder Netlify kann dafür ein kostenloses Projekt mit Build-Befehl `npm run build:web` und Ausgabeverzeichnis `dist` angelegt werden. Die bereitgestellte HTTPS-Adresse wird anschließend an die Mitspieler geschickt. Android/Chrome zeigt „App installieren“ an; auf iPhone/iPad wird in Safari „Teilen → Zum Home-Bildschirm“ verwendet.

In der aktuellen Cloudflare-Workers-Oberfläche lauten die Befehle:

- Build command: `npm run build:web`
- Deploy command: `npx wrangler deploy`

Die Datei `wrangler.jsonc` veröffentlicht `dist` als Single Page Application.

Die PWA speichert nur die Programmoberfläche offline. Anmeldung, Tipps, Startzeitprüfung und Ranglisten benötigen absichtlich eine Internetverbindung, damit keine veralteten oder verspäteten Tipps gespeichert werden.

## Saison einrichten

Eine Saison wird administrativ angelegt, zum Beispiel:

```sql
insert into public.seasons (name, external_division_id, table_prediction_deadline)
values ('Oberliga Süd 2026/27', '21614', '2026-09-17 23:59:59 Europe/Berlin');
```

`table_prediction_deadline` ist ein absoluter Zeitpunkt. Für die gewünschte Regel wird jährlich der 17. September, 23:59:59 Uhr Europe/Berlin gesetzt.
Sobald der Playoff-Termin feststeht, wird `playoffs_start_at` gesetzt; der Import ordnet spätere Spiele dann automatisch den Playoffs zu.

## DEB-Import

Die offizielle Seite bindet Spielplan, Ergebnisse und Tabelle über HockeyData ein. Die Edge Function `sync-deb` erwartet:

- `HOCKEYDATA_API_KEY`: gültiger, serverseitiger Zugang
- `SYNC_SECRET`: Geheimnis für Cron-/Admin-Aufrufe
- die automatisch verfügbaren Supabase-Variablen

Der auf der öffentlich erreichbaren Seite am 28.08.2026 eingebettete Schlüssel wurde vom HockeyData-Endpunkt als ungültig beantwortet. Vor dem Livebetrieb muss deshalb ein erlaubter Datenzugang mit DEB/HockeyData geklärt werden. Die App legt den Schlüssel niemals im Client ab.

## Tabellenwertung

Bei `N` Teams erhält jedes Team `max(0, N − Positionsabweichung)` Punkte. Bei 13 Teams ergeben ein exakter Platz 13 Punkte, ein Platz daneben 12 Punkte usw. Spiel- und Tabellenpunkte werden in getrennten Ranglisten geführt.

Nach Eintragen aller `actual_position`-Werte und Setzen der Saison auf `finished` führt ein Admin einmal aus:

```sql
select public.rescore_table_predictions('<season-uuid>');
```

## Vor Store-Veröffentlichung

Bundle IDs, EAS-Projekt-ID, Splashscreen, Datenschutzerklärung, Support-URL sowie Apple-/Google-Entwicklerkonten müssen ergänzt werden. Anschließend entstehen die Store-Builds mit `eas build --platform all --profile production`.
