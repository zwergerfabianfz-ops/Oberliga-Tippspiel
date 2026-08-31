# Oberliga Tippspiel

Ein plattformübergreifender Expo-MVP für iOS und Android mit Supabase-Backend.

## Enthalten

- Registrierung und Anmeldung mit E-Mail/Passwort
- eindeutiger, im Profil änderbarer Anzeigename
- Tipps für Testspiele, Hauptrunde und Playoffs, serverseitig exakt zum Spielbeginn gesperrt
- Testspieltipps ohne Wertung; Auswahl und Verlauf verschwinden zum Start der Hauptrunde
- Wertung: exaktes Ergebnis 3, richtige Tordifferenz 2, richtiger Sieger 1, sonst 0 Punkte
- einmaliger, bis zur Deadline änderbarer Hauptrunden-Tabellentipp
- getrennte Ranglisten für Spiel- und Tabellentipps
- Tippverlauf aller Mitspieler für bereits gestartete Spiele der letzten 14 Tage
- automatisch aktualisierte Live-Spielstände während laufender Spiele
- optionale Web-Push-Erinnerung etwa eine Stunde vor ungetippten Spielen
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

1. Build-Befehl `npm run build:web` verwenden.
2. Das erzeugte Verzeichnis `dist` veröffentlichen.

Das aktuelle Supabase-Projekt und sein öffentlicher Publishable Key sind als Standardkonfiguration hinterlegt. Hosting-Variablen sind daher nicht erforderlich; sie können die Standardwerte bei einem späteren Projektwechsel überschreiben.

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

Die offizielle Seite bindet Spielplan, Ergebnisse und Tabelle über HockeyData ein. Die Edge Function `sync-deb` verwendet:

- optional `HOCKEYDATA_API_KEY`: eigener serverseitiger Zugang; andernfalls wird der öffentliche Widget-Key der DEB-Seite ermittelt
- optional `SYNC_SECRET`: Geheimnis für Cron-/Admin-Aufrufe
- die automatisch verfügbaren Supabase-Variablen

Der Importer liest den jeweils öffentlich eingebetteten Widget-Key serverseitig von der DEB-Seite und übermittelt den von HockeyData erwarteten Referer. Für die Saison 2026/27 liefert Division `21614` derzeit 14 Teams und 364 Hauptrundenspiele. Der Key wird nicht in den Mobil- oder PWA-Client eingebaut. Vor dauerhaftem automatischem Abruf sollte die Erlaubnis zur Weiterverwendung mit DEB/HockeyData geklärt werden.

Für die Erstbefüllung kann der geprüfte SQL-Seed `supabase/migrations/202608280002_seed_oberliga_sued_2026.sql` einmal im Supabase SQL Editor ausgeführt werden. Ein neuer Stand lässt sich mit `npm run generate:deb-seed` erzeugen.

Für Live-Spielstände und den Tippverlauf wird zusätzlich `supabase/migrations/202608300001_live_scores_and_recent_tips.sql` einmal im SQL Editor ausgeführt und die Edge Function `sync-deb` veröffentlicht. Angemeldete App-Nutzer dürfen den Import anstoßen, können dessen Daten aber nicht verändern. Während eines möglichen Live-Spiels fragt die App höchstens einmal pro Minute an; die Funktion überspringt einen Abruf, wenn die Daten vor weniger als 45 Sekunden aktualisiert wurden.

Die Migration `supabase/migrations/202608300002_official_matchdays.sql` ergänzt die Spieltagsnummer. Die App zeigt unter „Nächster Spieltag“ die Spiele des nächsten Kalendertags. Findet dort nur ein vorgezogenes Spiel statt, wird zusätzlich der unmittelbar folgende Spieltermin angezeigt. Dadurch bleibt die Auswahl kompakt, ohne die übrigen sechs Begegnungen eines geteilten Spieltags zu verstecken.

Die Migration `supabase/migrations/202608300003_preseason_games.sql` ergänzt Testspiele. Der Import übernimmt aus der offiziellen DEB-Testspiel-Liga nur Partien, an denen mindestens ein Oberliga-Süd-Team beteiligt ist. Diese Tipps werden gespeichert, aber nie für die Rangliste gewertet. Fremde Testspielgegner erscheinen nicht im Hauptrunden-Tabellentipp. Mit dem Beginn des ersten Hauptrundenspiels werden Testspiel-Auswahl und Testspielverlauf automatisch ausgeblendet.

`supabase/migrations/202608300005_fix_table_prediction_teams.sql` bereinigt die Kennzeichnung eventuell älterer Testgegner und validiert den Tabellentipp ausschließlich gegen die Mannschaften, die tatsächlich an der Hauptrunde teilnehmen.

`supabase/migrations/202608310001_unique_display_names.sql` macht Anzeigenamen unabhängig von Groß-/Kleinschreibung eindeutig. Die App prüft neue Namen bereits vor der Registrierung; die Datenbank verhindert zusätzlich konkurrierende Doppelvergaben. Angemeldete Nutzer können ihren Anzeigenamen im Profil ändern.

## Tipp-Erinnerungen

Die Migration `supabase/migrations/202608300004_push_reminders.sql` speichert freiwillige Push-Abonnements und bereits versandte Erinnerungen. Danach wird die Edge Function `send-tip-reminders` veröffentlicht. Für sie müssen `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` und `REMINDER_SECRET` als Function Secrets gesetzt und die eingebaute JWT-Prüfung ausgeschaltet werden; die Funktion prüft stattdessen `REMINDER_SECRET` selbst.

Ein Cronjob ruft die Function alle fünf Minuten auf. Beispiel (Platzhalter ersetzen):

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'send-tip-reminders',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := 'https://PROJECT_REF.supabase.co/functions/v1/send-tip-reminders',
    headers := '{"Content-Type":"application/json","x-reminder-secret":"REMINDER_SECRET"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);
```

Die Nutzer aktivieren die Erinnerung freiwillig im Profil. Die Function sendet nur dann, wenn ein Spiel in 55 bis 65 Minuten beginnt, der Nutzer dafür noch keinen Tipp abgegeben hat und für dieses Spiel noch keine Erinnerung versendet wurde. Unter iOS/iPadOS steht Web Push ab Version 16.4 für zum Home-Bildschirm hinzugefügte Web-Apps zur Verfügung.

## Tabellenwertung

Bei `N` Teams erhält jedes Team `max(0, N − Positionsabweichung)` Punkte. Bei 13 Teams ergeben ein exakter Platz 13 Punkte, ein Platz daneben 12 Punkte usw. Spiel- und Tabellenpunkte werden in getrennten Ranglisten geführt.

Nach Eintragen aller `actual_position`-Werte und Setzen der Saison auf `finished` führt ein Admin einmal aus:

```sql
select public.rescore_table_predictions('<season-uuid>');
```

## Vor Store-Veröffentlichung

Bundle IDs, EAS-Projekt-ID, Splashscreen, Datenschutzerklärung, Support-URL sowie Apple-/Google-Entwicklerkonten müssen ergänzt werden. Anschließend entstehen die Store-Builds mit `eas build --platform all --profile production`.
