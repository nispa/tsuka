# Casi d'Uso 🧪

Questa guida mostra come sfruttare i personaggi, i ruoli e i team disponibili nel harness per compiti concreti. Ogni esempio usa i preset già definiti in `characters/`, `roles/` e `teams/`.

---

## 🎨 1. Generare un prompt per Krea2

**Personaggio:** `moriarty` (ruolo `krea_prompt_engineer`, trait creativo).

**Quando:** vuoi trasformare un'idea vaga in un prompt pronto per la generazione di immagini.

**Esempio:**
> "Un gatto che legge un libro sotto la luna"

Il ruolo `krea_prompt_engineer` espande il prompt rispettando le regole di faithfulness, struttura T2I e preservazione del medium: restituisce il paragrafo finale e, con un trait creativo, varianti di stile.

---

## 📣 2. Scrivere un post social

**Personaggi:** `ortegas` (creativo) o `chapel` (affidabile, senza piaggerie) — entrambi ruolo `social_media_manager`.

**Quando:** devi pubblicare su Instagram, LinkedIn, X/Twitter, Facebook o TikTok.

**Esempio:**
> "Lancia il nostro nuovo corso di AI, target professionisti, tono professionale"

Ottieni testo, hashtag, call-to-action e suggerimenti di formato per la piattaforma scelta.

---

## ✍️ 3. Copywriting persuasivo

**Personaggi:** `doctor` (ruolo `storyteller`+`copywriter`, creativo) o `kirk` (ruolo `copywriter`, schietto: ti dice se il testo fa schifo).

**Quando:** serve una headline, una landing page, un'email o uno slogan.

**Esempio:**
> "Scrivi 3 headline per una campagna di antivirus"

Ricevi varianti con la strategia sottostante (AIDA, PAS, storytelling).

---

## 🌐 4. Tradurre e localizzare

**Personaggio:** `uhura` (ruolo `translator`, preciso/professionale: solo il testo tradotto).

**Quando:** devi tradurre contenuti mantenendo tono e contesto culturale.

**Esempio:**
> "Traduci in inglese questa descrizione prodotto, tono marketing"

---

## 📊 5. Analisi dati e report

**Personaggi:** `data` (ruolo `tech_writer`+`data_analyst`, professionale) o `mbenga` (ruolo `data_analyst`+`researcher`, affidabile e non accondiscendente).

**Quando:** hai un dataset e vuoi pattern, metriche e insight actionable.

**Esempio:**
> "Analizza le vendite Q1 e dimmi cosa non va"

`mbenga` segnala errori nei dati senza compiacere.

---

## 🔍 6. Ottimizzazione SEO

**Personaggio:** `quark` (ruolo `seo_specialist`: dice senza giri di parole cosa non funziona).

**Quando:** devi ottimizzare contenuti o struttura per i motori di ricerca.

**Esempio:**
> "Ottimizza questa pagina per 'corso di prompt engineering'"

---

## ⚙️ 7. Pipeline DevOps

**Personaggio:** `scotty` (ruolo `devops_engineer`+`sysadmin`, affidabile).

**Team:** `dev_ops`, `dev_security`.

**Quando:** serve CI/CD, container, infrastruttura come codice o deploy.

**Esempio (team):**
> `/team dev_ops` → "Containerizza l'app e configura il deploy su staging"

---

## 🧭 8. Supervisione e controllo qualità

**Personaggio:** `pike` (ruolo `supervisor`, affidabile: non accondiscendente).

**Dove:** presente in tutti i team come ultimo anello della catena.

**Quando:** vuoi che qualcuno riveda il lavoro degli altri, segnali errori e coordini le priorità senza accondiscendenza.

---

## 👥 9. Lavorare in team (`/team`)

Ogni team combina mestieri complementari e si chiude con un `supervisor` come controllore
(tabella generata dai file in `teams/`; il membro in grassetto è l'orchestrator):

| Team | Membri (ruoli) | Scopo |
|---|---|---|
| `creative_promo` | kirk (`copywriter`), deanna_troi (`entertainer`), **pike (`supervisor`)** | Kirk imposta la strategia d'impatto e Deanna Troi scrive un testo promozionale accattivante e persuasivo pronto per la pubblicazione |
| `cyber_audit` | worf (`security_auditor`), tuvok (`sysadmin+security_auditor`), **pike (`supervisor`)** | Worf conduce i controlli di sicurezza attiva, Tuvok applica verifiche di sistema indipendenti, Pike valida le mitigazioni |
| `dev_ops` | scotty (`devops_engineer+sysadmin`), geordi (`developer`), **pike (`supervisor`)** | Scotty gestisce l'automazione, le pipeline e i server, Geordi testa le integrazioni, Pike approva il go-live |
| `dev_security` | geordi (`developer`), worf (`security_auditor`), **pike (`supervisor`)** | Geordi scrive e ottimizza il software, Worf ispeziona il codice per l'hardening e la sicurezza, Pike supervisiona |
| `game_dev` | paris (`game_designer`), geordi (`developer`), **pike (`supervisor`)** | Tom Paris progetta le logiche e i puzzle del gioco, Geordi sviluppa il motore e il rendering, Pike esegue il playtesting e la validazione |
| `legal_research` | spock (`researcher+osint_researcher`), deanna_troi (`entertainer`), **pike (`supervisor`)** | Spock analizza le normative e i vincoli logici, Deanna Troi media e redige la sintesi, Pike valida la conformità finale |
| `osint_recon` | spock (`researcher+osint_researcher`), seven (`osint_researcher+data_analyst`), **pike (`supervisor`)** | Spock scansiona le fonti web aperte con rigore scientifico, Sette di Nove assimila e sintetizza i dati, Pike valida il report |
| `research_writer` | spock (`researcher+osint_researcher`), dax (`osint_editor`), **pike (`supervisor`)** | Spock raccoglie e analizza le fonti con metodo scientifico e Jadzia Dax scrive il report esecutivo finale |
| `story_comedy` | doctor (`storyteller+copywriter`), q (`entertainer+copywriter`), **pike (`supervisor`)** | Il Dottore scrive la storia e i dialoghi teatrali, Q rifinisce le battute e il ritmo comico, Pike valida la coerenza e il messaggio |
| `tech_docs` | geordi (`developer`), data (`tech_writer+data_analyst`), **pike (`supervisor`)** | Geordi ispeziona la codebase e le funzioni, Data redige la documentazione tecnica e i diagrammi, Pike revisiona e valida la chiarezza |

**Esempio:**
```
/team cyber_audit
> Audita le porte aperte e scrivi un report di sicurezza
```
Gli agenti operano in turni sequenziali condividendo workspace e storico tool; il `supervisor` chiude verificando la qualità.

---

## 🎭 10. Debate tra personaggi (`/call`)

**Quando:** vuoi confrontare punti di vista opposti (es. creativo vs schietto).

**Esempio:**
```
/call @kirk, @doctor
> Questo slogan funziona per la campagna?
```
Lo schietto critica, il creativo propone alternative.
