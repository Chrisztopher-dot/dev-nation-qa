AI-modeller i utvecklingsmiljöer presterar bäst när de har en fast referensfil i projektet. Skapa en fil i projektets rotmapp som heter t.ex. qa-agent-context.md och klistra in en sammanfattning av miljön:
Mål: [https://dev.nation.dev](https://dev.nation.dev)
Session: auth.json i rotmappen
Stack: Playwright Test (TypeScript)
Körkommando: npx playwright test
Kända mönster:
Sidor som /profile kräver autentisering via auth.json.
Menyelement har ofta prefix (t.ex. 5 Preferences), använd därför regex som /Preferences/i.
Dynamiska nätverksresurser gör att waitForLoadState('domcontentloaded') är stabilare än 'networkidle'.