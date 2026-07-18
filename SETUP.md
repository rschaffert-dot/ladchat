# Setup för nya utvecklare (t.ex. Anton)

## 1. Klona repot
```
git clone https://github.com/rschaffert-dot/ladchat.git
cd ladchat
```
Du behöver skriv-access på GitHub-repot — be Rasmus lägga till dig som collaborator om du inte redan syns under repots Settings > Collaborators.

## 2. Miljövariabler
`.env` är gitignorad och följer inte med klonen. Be Rasmus skicka dig innehållet (via säker kanal, t.ex. Signal/Slack — inte i en publik kanal). Skapa sedan `.env` i repo-roten enligt mallen i `.env.example`:
```
EXPO_PUBLIC_SUPABASE_URL=https://<projekt-ref>.supabase.co
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```
Detta är klientnycklar (bundlas i appen), inte hemliga i sig — men håll `.env` utanför git ändå.

## 3. Node
Projektet kräver Node (se `package.json` för version). Om du kör flera Node-versioner, använd t.ex. fnm/nvm.

## 4. Installera och kör lokalt
```
npm install
npx expo start
```
Skanna QR-koden med Expo Go, eller kör i simulator/emulator.

## 5. Expo-kontoåtkomst (för att publicera EAS-updates/builds)
Projektet heter `@rasmusschaffert/ladchat-mobile` på Expo. För att kunna köra `eas update`/`eas build` mot det behöver du bjudas in som medlem på Expo-kontot:

- Rasmus gör detta via https://expo.dev/accounts/rasmusschaffert/settings/members (Invite → ditt Expo-användarnamn/mejl → roll "Developer")
- Skapa ett gratis Expo-konto på https://expo.dev/signup om du inte har ett
- Logga sedan in lokalt: `npx eas-cli login`

## 6. Publicera en ändring (OTA-uppdatering)
Efter kodändringar, för att pusha en ny preview till alla som redan har appen öppen i Expo Go:
```
npx eas-cli update --branch preview --environment preview --message "beskrivning av ändringen"
```
Samma delade länk/QR gäller fortfarande — ingen ny länk behövs:
https://expo.dev/accounts/rasmusschaffert/projects/ladchat-mobile/updates/c1472073-5db9-48e1-a871-66eb6a9344cc

## 7. Supabase (backend)
Backend är delad — samma Supabase-projekt för alla utvecklare, inga separata migrationer behövs lokalt. Databasschema och RLS-policys finns i `supabase/migrations/` för referens.
