# Casi d'Uso 🧪

Questa guida mostra come sfruttare i personaggi, i ruoli e i team disponibili nel harness per compiti concreti. Ogni esempio usa i preset già definiti in `characters/`, `roles/` e `teams/`.

---

## 🎨 1. Generare un prompt per Krea2

**Personaggi:** `krea_master` (creativo) o `cold_steel` (di poche parole).

**Quando:** vuoi trasformare un'idea vaga in un prompt pronto per la generazione di immagini.

**Esempio:**
> "Un gatto che legge un libro sotto la luna"

Il ruolo `krea_prompt_engineer` espande il prompt rispettando le regole di faithfulness, struttura T2I e preservazione del medium. `cold_steel` restituisce solo il paragrafo finale, `krea_master` aggiunge varianti di stile.

---

## 📣 2. Scrivere un post social

**Personaggio:** `social_guru` (creativo) o `ground_control` (affidabile, senza piaggerie).

**Quando:** devi pubblicare su Instagram, LinkedIn, X/Twitter, Facebook o TikTok.

**Esempio:**
> "Lancia il nostro nuovo corso di AI, target professionisti, tono professionale"

Ottieni testo, hashtag, call-to-action e suggerimenti di formato per la piattaforma scelta.

---

## ✍️ 3. Copywriting persuasivo

**Personaggi:** `wordsmith` (creativo) o `straight_shooter` (schietto: ti dice se il testo fa schifo).

**Quando:** serve una headline, una landing page, un'email o uno slogan.

**Esempio:**
> "Scrivi 3 headline per una campagna di antivirus"

Ricevi varianti con la strategia sottostante (AIDA, PAS, storytelling).

---

## 🌐 4. Tradurre e localizzare

**Personaggi:** `polyglot` (preciso/professionale) o `no_bull` (laconego: solo testo tradotto).

**Quando:** devi tradurre contenuti mantenendo tono e contesto culturale.

**Esempio:**
> "Traduci in inglese questa descrizione prodotto, tono marketing"

---

## 📊 5. Analisi dati e report

**Personaggi:** `data_sage` (professionale) o `iron_claw` (affidabile, non accondiscendente).

**Quando:** hai un dataset e vuoi pattern, metriche e insight actionable.

**Esempio:**
> "Analizza le vendite Q1 e dimmi cosa non va"

`iron_claw` segnala errori nei dati senza compiacere.

---

## 🔍 6. Ottimizzazione SEO

**Personaggi:** `seo_wizard` (professionale) o `hard_edge` (brutale: dice cosa non funziona).

**Quando:** devi ottimizzare contenuti o struttura per i motori di ricerca.

**Esempio:**
> "Ottimizza questa pagina per 'corso di prompt engineering'"

---

## ⚙️ 7. Pipeline DevOps

**Personaggio:** `pipeline_pro` (DevOps affidabile).

**Team:** `dev_ops`, `dev_security`.

**Quando:** serve CI/CD, container, infrastruttura come codice o deploy.

**Esempio (team):**
> `/team dev_ops` → "Containerizza l'app e configura il deploy su staging"

---

## 🧭 8. Supervisione e controllo qualità

**Personaggio:** `overseer` (supervisore affidabile, non lecca i piedi a nessuno).

**Dove:** presente in tutti i team (`creative_promo`, `cyber_audit`, `dev_ops`, `dev_security`, `legal_research`, `research_writer`).

**Quando:** vuoi che qualcuno riveda il lavoro degli altri, segnali errori e coordini le priorità senza accondiscendenza.

---

## 👥 9. Lavorare in team (`/team`)

Ogni team combina ruoli complementari + `overseer` come controllore:

| Team | Membri | Scopo |
|---|---|---|
| `creative_promo` | yes_lawyer, sensual_diva, **overseer** | Ricerca legale + copy promozionale |
| `cyber_audit` | falco, piccione, **overseer** | Hardening + controllo vulnerabilità |
| `dev_ops` | pippo, falco, pipeline_pro, **overseer** | Sviluppo + hardening + DevOps |
| `dev_security` | pippo, salvo, pipeline_pro, **overseer** | Codice + cybersecurity + DevOps |
| `legal_research` | yes_lawyer, pippo, **overseer** | Compliance + implementazione |
| `research_writer` | yes_lawyer, sensual_diva, **overseer** | Ricerca + report accattivante |

**Esempio:**
```
/team cyber_audit
> Audita le porte aperte e scrivi un report di sicurezza
```
Gli agenti operano in turni sequenziali condividendo workspace e storico tool; `overseer` chiude verificando la qualità.

---

## 🎭 10. Debate tra personaggi (`/call`)

**Quando:** vuoi confrontare punti di vista opposti (es. creativo vs schietto).

**Esempio:**
```
/call @straight_shooter, @wordsmith
> Questo slogan funziona per la campagna?
```
Lo schietto critica, il creativo propone alternative.
