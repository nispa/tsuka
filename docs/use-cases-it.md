# Casi d'Uso Pratici 🧪

<div align="right">
  <p>Read in <a href="use-cases.md">🇬🇧 English</a></p>
</div>

Questa guida illustra come utilizzare efficacemente i **Personaggi (Agenti)**, i **Ruoli** e i **Team collaborativi** disponibili in TSUKA per compiti operativi reali. Tutti gli esempi impiegano le configurazioni dichiarative native presenti nelle cartelle `characters/`, `roles/`, `traits/` e `teams/`.

---

## 🎨 1. Prompt Design per Modelli Generativi e Krea2

* **Personaggi**: 
  * `moriarty` (ruolo: `krea_prompt_engineer`, tratto: `creative`) — Ottimizzato specificamente per la generazione di immagini con **Krea2**.
  * `barclay` (ruolo: `genai_prompt_designer`, tratto: `creative`) — Progetta prompt articolati e contestualizzati per modelli multimodali e generativi generici.
* **Quando usarli**: quando si desidera trasformare un'idea concettuale o una descrizione sintetica in un prompt strutturato secondo le best practice di text-to-image/video (inquadratura, illuminazione, stile artistico, palette cromatica, vincoli negativi).
* **Esempio di prompt**:
  > *"Genera un prompt fotorealistico per Krea2: un laboratorio cyberpunk sotterraneo con riflessi al neon su superfici bagnate e cavi a vista."*

---

## 📣 2. Social Media Management e Strategia Canali

* **Personaggio**: `ortegas` (ruolo: `social_media_manager`, tratto: `creative`).
* **Quando usarlo**: per redigere post, thread, campagne promozionali e piani editoriali per piattaforme come LinkedIn, X/Twitter, Instagram, Facebook o TikTok.
* **Esempio di prompt**:
  > *"Scrivi un post LinkedIn per annunciare il rilascio della nuova versione di TSUKA. Target: sviluppatori e sistemisti; evidenzia i tool in hot-plug e l'auto-discovery dei modelli locali."*
* **Output fornito**: testo formattato, ganci (*hook* di apertura), call-to-action (CTA), hashtag contestuali e suggerimenti sul formato visivo ideale.

---

## ✍️ 3. Copywriting Persuasivo e Storytelling

* **Personaggi**:
  * `kirk` (ruolo: `copywriter`, tratto: `blunt`) — Copywriting schietto, focalizzato su conversioni e impatto, senza giri di parole.
  * `doctor` (ruoli: `storyteller` + `copywriter`, tratto: `creative`) — Narrazione teatrale, coinvolgente e ricca di sfumature stilistiche.
  * `q` (ruoli: `entertainer` + `copywriter`, tratto: `creative`) — Stile brillante, ironico e memorabile.
* **Quando usarli**: per creare headline d'effetto, testi per landing page, email marketing (formule AIDA, PAS), script video o slogan pubblicitari.
* **Esempio di prompt**:
  > *"Scrivi 3 varianti di landing page hero section per un software di sicurezza difensiva, ciascuna basata su una diversa leva psicologica (urgenza, autorità, semplicità)."*

---

## 🌐 4. Traduzione Tecnica e Localizzazione

* **Personaggio**: `uhura` (ruolo: `translator`, tratto: `professional`).
* **Quando usarlo**: per tradurre documenti, interfacce software o articoli tecnici preservando rigorosamente la terminologia del settore e il registro espressivo richiesto.
* **Esempio di prompt**:
  > *"Traduci questa documentazione API in italiano, mantenendo invariati i nomi dei metodi e adottando un tono tecnico formale."*

---

## 📊 5. Analisi Dati e Statistica Applicata

* **Personaggi**:
  * `data` (ruoli: `tech_writer` + `data_analyst`, tratto: `professional`) — Analisi quantitativa meticolosa e documentazione strutturata.
  * `mbenga` (ruoli: `data_analyst` + `researcher`, tratto: `reliable`) — Analisi critica dei dati con focus su correlazioni, anomalie e affidabilità delle metriche.
  * `seven` (ruoli: `osint_researcher` + `data_analyst`, tratto: `reliable`) — Estrazione pattern e sintesi di dataset complessi.
* **Quando usarli**: per interpretare file CSV/JSON, individuare trend di business o analizzare log prestazionali.
* **Esempio di prompt**:
  > *"Esamina questo report di vendite trimestrali: evidenzia le tre maggiori flessioni percentuali e formula le relative ipotesi causali."*

---

## 🔍 6. Ottimizzazione SEO e Posizionamento

* **Personaggio**: `quark` (ruolo: `seo_specialist`, tratto: `creative`).
* **Quando usarlo**: per audit on-page, ricerca parole chiave, ottimizzazione di meta-tag, architettura informativa e strategie di posizionamento organico.
* **Esempio di prompt**:
  > *"Ottimizza la struttura degli header (H1, H2, H3) e la meta description di questa pagina per la parola chiave 'framework agentico typescript'."*

---

## 💻 7. Ingegneria del Software e Architettura

* **Personaggi**:
  * `geordi` (ruolo: `developer`, tratto: `professional`) — Sviluppo, refactoring, implementazione feature e unit test in TypeScript/JavaScript e linguaggi moderni.
  * `una` (ruolo: `architect`, tratto: `reliable`) — Progettazione di sistemi modulari, definizione di pattern architetturali (SOLID, ReAct), contratti di interfaccia e scalabilità.
* **Quando usarli**: per pianificare nuove funzionalità complesse o scrivere moduli software robusti e manutenibili.
* **Esempio di prompt**:
  > *"Progetta l'interfaccia TypeScript e l'implementazione di un meccanismo di caching LRU con supporto alla scadenza temporale (TTL)."*

---

## ⚙️ 8. DevOps, Cloud e Amministrazione di Sistema

* **Personaggi**:
  * `scotty` (ruoli: `devops_engineer` + `sysadmin`, tratto: `reliable`) — Automazione pipeline CI/CD, container Docker, scripting e gestione infrastruttura.
  * `tuvok` (ruoli: `sysadmin` + `security_auditor`, tratto: `devils_advocate`) — Diagnostica avanzata di sistema, auditing configurazioni di rete e verifica porte/servizi.
* **Quando usarli**: per automazioni operative, containerizzazione, monitoraggio e troubleshooting di sistemi Windows/PowerShell o Linux.
* **Esempio di prompt**:
  > *"Crea un Dockerfile multi-stage per una build Node.js TypeScript ottimizzata per la produzione."*

---

## 🛡️ 9. Cybersecurity Difensiva e Code Auditing SAST

* **Personaggi**:
  * `worf` (ruolo: `security_auditor`, tratto: `reliable`) — Ufficiale di sicurezza: ispezione statica del codice sorgente (`audit_code`), hardening di sicurezza e mitigazione delle vulnerabilità OWASP/CWE.
  * `tuvok` (ruoli: `sysadmin` + `security_auditor`, tratto: `devils_advocate`) — Verifica di sistema e configurazioni di rete, auditing di certificati TLS/SSL e permessi sul filesystem.
  * `sherlock` (ruoli: `osint_researcher` + `security_auditor`, tratto: `professional`) — Investigatore analitico: tracciamento metodico delle vulnerabilità e ispezione dei vettori di attacco.
* **Cosa analizza `audit_code`**:
  * **CWE-798**: Credenziali hardcoded (chiavi OpenAI, AWS Access Keys, GitHub PAT, token JWT, certificati PEM privati).
  * **CWE-78 / CWE-95**: Rischio di Command Injection su shell OS ed esecuzione dinamica insicura (`eval`, `new Function`).
  * **CWE-89**: SQL Injection su query con concatenazione o interpolazione non parametrizzata.
  * **CWE-22**: Path Traversal su letture/scritture filesystem con percorsi dinamici.
  * **CWE-79**: DOM-based XSS su manipolazioni dirette del DOM (`innerHTML`, `dangerouslySetInnerHTML`).
  * **CWE-327 / CWE-295**: Algoritmi crittografici obsoleti (MD5, SHA1, DES) e disabilitazione della verifica dei certificati TLS/SSL.
  * **CWE-532 / CWE-732**: Esposizione di credenziali nei log e permessi file eccessivamente permissivi (`chmod 777`).
* **Quando usarli**: prima di ogni rilascio o commit, per audit difensivi periodici o per verificare codice proveniente da terze parti.
* **Esempio di prompt operativo**:
  > *"Esegui un audit di sicurezza difensivo sulla cartella `src/` filtrando per le vulnerabilità di livello HIGH (o estensioni `.ts`, `.js`). Per ogni criticità individuata, spiega il rischio CWE associato e proponi la patch correttiva da applicare."*
* **Output strutturato fornito**: report SAST suddiviso per gravità (🔴 HIGH, 🟡 MEDIUM, 🔵 LOW), collocazione esatta nel codice (`file:line`), snippet vulnerabile, descrizione della minaccia e guida pratica di remediation.

---

## 🕵️ 10. Intelligence OSINT, Fact-Checking e Ricerca

* **Personaggi**:
  * `spock` (ruoli: `researcher` + `osint_researcher`, tratto: `laconic`) — Ricerca rigorosa su fonti aperte, correlazione logica e verifica bibliografica.
  * `seven` (ruoli: `osint_researcher` + `data_analyst`, tratto: `reliable`) — Raccolta e aggregazione massiva di informazioni da fonti web.
  * `dax` (ruolo: `osint_editor`, tratto: `professional`) — Redazione di report esecutivi e sintesi strutturate di intelligence.
  * `odo` (ruolo: `osint_verifier`, tratto: `devils_advocate`) — Verifica incrociata implacabile, individuazione di incongruenze e fact-checking.
* **Quando usarli**: per condurre ricerche di mercato approfondite, verifiche su registri pubblici e analisi di intelligence.
* **Esempio di prompt**:
  > *"Raccogli e confronta le specifiche tecniche e le licenze d'uso delle tre principali librerie open source per il parsing Markdown in Node.js."*

---

## 🎮 11. Game Design e Meccaniche di Gioco

* **Personaggio**: `paris` (ruolo: `game_designer`, tratto: `creative`).
* **Quando usarlo**: per ideare puzzle, bilanciare economie di gioco, definire progressioni di gameplay e scenari interattivi.
* **Esempio di prompt**:
  > *"Definisci le regole e la curva di progressione per un minigioco di hacking basato su nodi logici e consumo di memoria virtuale."*

---

## 🧭 12. Supervisione e Quality Assurance

* **Personaggio**: `pike` (ruolo: `supervisor`, tratto: `reliable`).
* **Dove si trova**: è il membro di chiusura presente in tutti i 10 team preconfigurati.
* **Quando usarlo**: come revisore indipendente che controlla la conformità dei requisiti, valuta la qualità degli output e certifica il completamento del lavoro senza accondiscendenza.

---

## 👥 13. Workflow Collaborativi di Squadra (`/team`)

I team combinano competenze specialistiche complementari e si chiudono sistematicamente con un `supervisor` a garanzia della qualità (il nominativo in grassetto identifica l'orchestratore del workflow):

| Team | Membri e Ruoli | Obiettivo Operativo |
|---|---|---|
| `creative_promo` | kirk (`copywriter`), deanna_troi (`entertainer`), **pike (`supervisor`)** | Kirk definisce la strategia d'impatto, Deanna Troi redige testi promozionali accattivanti e Pike valida l'efficacia del messaggio finale. |
| `cyber_audit` | worf (`security_auditor`), tuvok (`sysadmin` + `security_auditor`), **pike (`supervisor`)** | Worf esegue l'analisi statica di sicurezza, Tuvok verifica i vincoli di sistema e di rete, Pike certifica le contromisure proposte. |
| `dev_ops` | scotty (`devops_engineer` + `sysadmin`), geordi (`developer`), **pike (`supervisor`)** | Scotty realizza l'infrastruttura e le pipeline CI/CD, Geordi convalida l'integrazione del codice, Pike autorizza il deployment. |
| `dev_security` | geordi (`developer`), worf (`security_auditor`), **pike (`supervisor`)** | Geordi implementa le feature software, Worf ispeziona il codice per l'hardening e la sicurezza, Pike supervisiona la qualità complessiva. |
| `game_dev` | paris (`game_designer`), geordi (`developer`), **pike (`supervisor`)** | Tom Paris progetta il gameplay e le meccaniche, Geordi programma la logica operativa, Pike conduce il testing e la validazione. |
| `legal_research` | spock (`researcher` + `osint_researcher`), deanna_troi (`entertainer`), **pike (`supervisor`)** | Spock analizza la normativa e i vincoli contrattuali, Deanna Troi redige una sintesi comprensibile, Pike verifica la conformità. |
| `osint_recon` | spock (`researcher` + `osint_researcher`), seven (`osint_researcher` + `data_analyst`), **pike (`supervisor`)** | Spock effettua la ricognizione delle fonti primarie, Seven elabora e struttura i dati raccolti, Pike convalida il report finale. |
| `research_writer` | spock (`researcher` + `osint_researcher`), dax (`osint_editor`), **pike (`supervisor`)** | Spock conduce la ricerca accademica e documentale, Jadzia Dax redige l'articolo/report divulgativo, Pike revisiona e approva. |
| `story_comedy` | doctor (`storyteller` + `copywriter`), q (`entertainer` + `copywriter`), **pike (`supervisor`)** | Il Dottore scrive la struttura narrativa, Q rifinisce le battute e il ritmo comico, Pike valida coerenza e impatto. |
| `tech_docs` | geordi (`developer`), data (`tech_writer` + `data_analyst`), **pike (`supervisor`)** | Geordi esamina la codebase e le interfacce, Data redige la documentazione tecnica con diagrammi e tabelle, Pike approva la chiarezza espositiva. |

### Esempio pratico di invocazione:
```powershell
/team dev_security
> "Implementa un modulo di autenticazione con token JWT ed esegui l'audit di sicurezza per verificare la corretta gestione dei segreti."
```

---

## 🎭 14. Dibattiti e Valutazioni a Più Voci (`/call`)

La modalità conferenza consente di confrontare prospettive e stili opposti su una decisione progettuale prima di procedere all'implementazione:

* **Confronto tra approccio pragmatico e analitico**:
  ```powershell
  /call @spock, @kirk
  > "Dobbiamo decidere se migrare immediatamente a un'architettura a microservizi o consolidare il monolite attuale."
  ```
  *Spock analizzerà razionalmente costi computazionali e complessità architetturale; Kirk metterà in luce la velocità di esecuzione e l'impatto sul business.*

* **Confronto tra creatività e sicurezza**:
  ```powershell
  /call @moriarty, @worf
  > "Valutiamo l'introduzione di una sandbox dinamica per l'esecuzione di script utente."
  ```
  *Moriarty esplorerà le potenzialità di estendibilità; Worf indicherà i vettori di attacco e i requisiti di isolamento.*
