# QA Test- och Revisionsrapport: dev.nation.dev

* **Datum:** 8 oktober 2026
* **Miljö:** https://dev.nation.dev
* **Testomfattning:** P1–P3 Defekter, Sandlåda/Benchmarks, Routing, Prestanda & WCAG Tillgänglighet (BUG-01 till BUG-30)
* **Verktyg:** Playwright (TypeScript), Axe-Core, Chrome DevTools
* **Status:** 25 Playwright-tester implementerade, kända defekter isolerade med `test.fail()`

---

## 1. Kända Defekter (Kräver Åtgärd från Dev-teamet)

### Prioritet 1 (P1 - Kritiska / Säkerhet, Funktionalitet & Routing)
1. **BUG-06: Bruten extern bildresurs på `/jobs`**
   * **Problem:** Flera externa logotyper och bildresurser (bl.a. Dealroom och DigitalOcean Spaces) ger HTTP 404 eller nätverksfel vid inläsning.
   * **Åtgärd:** Säkerställ fungerande bildresurslänkar eller implementera en robust fallback-placeholder i klientkomponenten.

2. **BUG-21: CSP blockerar `eval()` i JavaScript**
   * **Plats:** Global (`/community`, `/jobs`, `/benchmarks`).
   * **Källa:** `2fvc_hd7jamqy.js:6` (direktiv `script-src`).
   * **Problem:** Content Security Policy blockerar anrop till `eval()` eller dynamisk kodexekvering (`new Function`, sträng i `setTimeout`).
   * **Åtgärd:** Refaktorera berört skript/bibliotek för att eliminera dynamisk evaluering.

3. **BUG-28: Läckage av råa interna databas- och entitetsnycklar i UI-toasts**
   * **Plats:** `/benchmarks` vid generering av Freecode-test.
   * **Problem:** När testet inte kan skapas kastar gränssnittet interna arkitekturtermer och råa ID:n rakt ut till användaren: `mirrored Question entityId 01K379VNKDMEBR8098E772QFD3 is already active`.
   * **Åtgärd:** Fånga backend-felet och visa ett städat, användarvänligt felmeddelande utan interna nycklar.

4. **BUG-29: "Take test"-knappen navigerar inte stabilt till testmiljön**
   * **Plats:** `/benchmarks` -> Sektionen "Record" (på genererade testkort, t.ex. C++ #4 och NodeJS #3).
   * **Problem:** Vid klick på handlingsknappen (`Take test`) initieras ruttväxling men sessionen faller ofta tillbaka till startvyn utan att användaren når den interaktiva kodredigeraren.
   * **Teknisk orsak:** Länkens klickhantering och sessionstillstånd synkas inte korrekt mot testmiljön.
   * **Påverkan:** Förhindrar användaren från att genomföra startade benchmark-tester via det grafiska gränssnittet.
   * **Åtgärd:** Säkerställ att knappen navigerar stabilt till rätt sessions-URL utan omedelbar fallback.

5. **BUG-30: Tyst fallback-redirect från `/freecode/:id` tillbaka till `/benchmarks`**
   * **Plats:** `/freecode/4` (och dynamiska testrutter generellt).
   * **Problem:** Direktnavigering till ett specifikt test (t.ex. `/freecode/4`) hämtar serverkomponentdata (`4?_rsc=...`), men sidkomponenten avbryter renderingen och utför en omedelbar tyst klient-redirect tillbaka till `/benchmarks`.
   * **Påverkan:** Förklarar bakgrunden till BUG-29. Testmiljön, Monaco-editorn och sandlådan kan varken nås manuellt eller programmatiskt.
   * **Åtgärd:** Granska App Router-skyddet runt `/freecode/[id]` och åtgärda felaktiga tillståndskontroller som tvingar klienten tillbaka till startsidan.

---

### Prioritet 2 (P2 - Allvarliga / UX, Tillgänglighet & Prestanda)
6. **BUG-08: Standard C++-mall kraschar i sandlådan**
   * **Plats:** `/freecode/<id>` via `/benchmarks`.
   * **Problem:** Standardmallen för C++ kastar NZEC (Non-Zero Exit Code) / kärndump vid körning.
   * **Åtgärd:** Se över kompilatorflaggor, minnesgränser och sandlådans exekveringsmiljö när BUG-30 har åtgärdats.

7. **BUG-13: Extremt långsam serverrespons (TTFB 5403ms, DCL 5736ms) på `/jobs`**
   * **Plats:** `/jobs`.
   * **Problem:** Time To First Byte (TTFB) uppmättes till 5403 ms (budget 1500 ms) och DOMContentLoaded till 5736 ms (budget 4000 ms).
   * **Teknisk orsak:** Next.js App Router / React Server Component-rendering blockeras av backend-aggregeringen av jobbannonser och externa resurser innan den initiala HTML-strömmen skickas.
   * **Påverkan:** Besökare möts av en helt vit skärm i över 5 sekunder innan sidan börjar laddas.
   * **Åtgärd:** Inför inkrementell statisk generering (ISR/`revalidate`), implementera React Suspense-skelett runt listkomponenten så att sidheadern kan strömmas direkt, och flytta externa API-anrop till bakgrundsjobb.

8. **BUG-22: Oanvända preload-resurser ackumuleras (Preload Waste)**
   * **Plats:** Global SPA-routing.
   * **Problem:** Webbläsaren varnar för 40+ resurser (`https://dev.nation.dev/desig...`) som förladdas via `<link rel="preload">` men aldrig konsumeras under sessionen.
   * **Åtgärd:** Granska Turbopack/Next.js preload-konfiguration och rensa onödiga preload-taggar.

9. **BUG-24: Mobilmeny saknar focus trap (WCAG 2.1 - 2.4.3 Focus Order)**
   * **Plats:** Mobilvy (390px viewport).
   * **Problem:** När mobilpanelen öppnas fångas inte tangentbordsfokus. Vid upprepad `Tab` läcker fokus ut i bakgrunden bakom panelen på `document.body`.
   * **Åtgärd:** Implementera en fungerande focus trap runt mobilpanelens dialog-slot.

10. **BUG-26: State-synkronisering och deadlock vid generering av benchmark-tester**
    * **Plats:** `/benchmarks`.
    * **Problem:** När ett test genereras och blockeras av att en aktiv session redan finns (`is already active`), uppdateras inte listan under "Record" med det aktiva testet utan kräver manuell sidomladdning. Användaren får heller ingen direkt länk till sessionen.
    * **Åtgärd:** Revalidera listan över aktiva sessioner automatiskt i UI och tillhandahåll en direktlänk till sessionen i meddelandet.

11. **BUG-27: Felaktig användning av formuläretiketter (`<label for=FORM_ELEMENT>`)**
    * **Plats:** `/benchmarks` (4 överträdelser i Chrome Issues).
    * **Problem:** Etiketters `for`-attribut refererar till ID:n som inte existerar i DOM-trädet. Bryter skärmläsarkoppling (WCAG 1.3.1 / 4.1.2), klickfokus och autofill.
    * **Åtgärd:** Säkerställ att formulärelementens `id` matchar etikettens `htmlFor`/`for`.

12. **BUG-12/15/19: Saknad alt-text på SVG-ikoner (`svg-img-alt`)**
    * **Plats:** `/jobs`, `/community`, `/profile`.
    * **Problem:** Axe-core flaggar `<svg role="img">` utan tillgängligt namn.
    * **Åtgärd:** Komplettera med `aria-label`, `<title>` eller sätt `aria-hidden="true"`.

---

### Prioritet 3 (P3 - Mindre fel / Visuellt & Layout)
13. **BUG-23: Saknade dimensioner på lazy-loaded bilder (CLS-risk)**
    * **Plats:** Global (`.feed-media-visual` på `/community` och `/jobs`).
    * **Problem:** Bilder med `loading="lazy"` saknar explicita `width`/`height` eller CSS `aspect-ratio`, vilket orsakar layoutskiftningar när de renderas.
    * **Åtgärd:** Sätt explicita bildmått eller CSS `aspect-ratio`.

14. **BUG-25: Avhuggen text i Requirement Sheet (`✓ aut...`)**
    * **Plats:** `/jobs` i mobilvy.
    * **Problem:** Kravpunkter under `Must have` kapas periodvis med tre punkter utan tooltip eller fullständig visning vid smala skärmbredder.
    * **Åtgärd:** Justera radbrytning (`break-words`/flex-wrap) så att hela kravsträngen förblir läsbar.

---

## 2. Verifierade & Godkända Testfall

* **BUG-01:** Supportwidgeten ("Write to Nation") överlappar inte spar-knappen på `/profile`.
* **BUG-02:** Extrema numeriska värden i timarvode ger ingen HTTP 500-krasch eller exponerad Gremlin/Java-stacktrace.
* **BUG-03:** Inga tokens, API-nycklar eller admin-flaggor läcker i payload på `/academy`.
* **BUG-04/05:** Kritiska interna logotyper och kärn-CDN-resurser laddas utan felkoder på `/jobs`.
* **BUG-07:** Inga dummy- eller teststrängar (Lorem Ipsum, mockdata) exponeras på `/jobs`.
* **BUG-09/11:** Klientvalidering stoppar ogiltiga e-postadresser, webblänkar och negativa/extrema arvoden.
* **BUG-10:** Framtida datum är spärrade och kan inte väljas i födelsedatumväljaren.
* **BUG-13 (Partiell):** Prestandabudget uppfylld på `/community` (TTFB < 1500ms, DCL < 4000ms, payload < 5MB). TTFB/DCL-regressionen på `/jobs` är utbruten som en egen P2-defekt.
* **BUG-14:** Header-logotypen renderas korrekt, har stabila mått och navigerar utan redirect-loopar.
* **BUG-16:** Statiska resurser (JS, CSS, bilder, woff2) levereras med korrekta Content-Type-headers.
* **BUG-17/18:** Profil och arbetshistorik renderas responsivt (desktop och mobil) utan horisontell overflow eller skymda fält.
* **BUG-20:** Jobbkort innehåller synliga och icke-överlappande element (titel, företag, taggar, CTA-knapp).
