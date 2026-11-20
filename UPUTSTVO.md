# Job Hunter

Lokalna aplikacija za Mac koja:
1. **Skuplja oglase** sa 13 izvora: e-Študentski servis, MojeDelo, Zaposlitev.net, Slo-Tech, Infostud, HelloWorld, LinkedIn (javni oglasi), Remotive, RemoteOK, Arbeitnow, Jobicy, Himalayas, We Work Remotely.
2. **Filtrira i ocenjuje** ih prema tvom profilu: prvo po ključnim rečima (izbacuje senior, „5+ godina", nemački…), pa AI oceni najbolje i u jednoj rečenici napiše zašto.
3. **Pravi prilagođen CV u PDF-u** od linka oglasa (ili nalepljenog teksta), na jeziku oglasa (SLO/SRB/ENG/DE). Ne izmišlja iskustvo, samo ističe i preformuliše ono što imaš.
4. **Prati prijave**: novo → sačuvano → poslato → razgovor, sa beleškama.

Sve se čuva lokalno u folderu `data/` (baza + PDF-ovi).

## Pokretanje

1. Instaliraj Node.js (ako ga nemaš): https://nodejs.org (LTS verzija) ili `brew install node`
2. Dupli klik na **`start.command`**
   - Ako macOS kaže da fajl nije dozvoljen: desni klik → Open → Open.
   - Prvi put instalira pakete (1–3 min).
3. Otvara se http://localhost:4321

Iz Terminala: `npm install` pa `npm start`.

## Prvo podešavanje (5 minuta)

1. **Podešavanja → Gemini API ključ**: besplatan na https://aistudio.google.com/apikey (Google nalog → Create API key). Nalepi, klikni Test, pa Sačuvaj.
   - Rezerva (isto besplatno): Groq ključ sa https://console.groq.com/keys
   - Potpuno offline: instaliraj Ollama (https://ollama.com), pa `ollama pull qwen2.5:7b`
2. **Moj profil → Uvezi postojeći CV** (PDF/DOCX). AI ga razbije na sekcije. Proveri, dopuni SVE što si radio (projekte, praksu, veštine) i Sačuvaj. Što je profil bogatiji, to su CV-ovi bolji.
3. **Podešavanja → Šta tražim**: ključne reči i lokacije.
4. **Oglasi → Skupi nove oglase.**

## Kako koristiš svaki dan

- Oglasi → „Skupi nove oglase" → pogledaj zelene (70+) → „Napravi CV" → preuzmi PDF → pošalji → „✓ Poslao sam".
- Za oglas sa bilo kog sajta: **CV za oglas** → nalepi link → Napravi CV.
- Ako sajt traži prijavu (npr. neki LinkedIn oglasi), otvori „…ili nalepi tekst oglasa".
- Pre slanja možeš da izmeniš naslov/sažetak (ili ceo CV kao JSON), promeniš jezik i boju, pa „Osveži PDF".

## Napomene

- Besplatni Gemini ima ograničenje broja zahteva u minuti; alat sam pravi pauze i prelazi na Groq/Ollama ako zatreba.
- Sajtovi bez API-ja čitaju se po obliku linka oglasa, a ako stranica traži JavaScript, alat je otvori u nevidljivom Chrome-u. Ako neki sajt promeni dizajn i vraća 0 oglasa, log u „Oglasi" to pokazuje — popravka je u `src/sources/html-sites.js`.
- `npm test` pokreće offline testove (parseri, AI tok sa lažnim serverom, PDF).
