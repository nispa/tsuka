# Capability Fingerprinting & Benchmark 📊

<div align="right">
  <p>Read in <a href="benchmark.md">🇬🇧 English</a></p>
</div>

TSUKA non indovina le capacità di un modello dal nome del file: le **misura**. Il comando `/benchmark` esegue una suite di test dichiarativi, caricati da file, contro il backend attivo e salva il risultato come *profilo di capacità*. È quel profilo — non la stringa del nome — a decidere quali tool un modello può vedere (tier gating) e quale livello di reasoning-effort vale la pena pagare.

> **Sorgente**: [`src/core/benchmarkTests.ts`](../src/core/benchmarkTests.ts) · [`src/core/modelProfile.ts`](../src/core/modelProfile.ts) · **Fixture**: [`benchmarks/`](../benchmarks/) · **Storage**: `models_profile.json`

---

## 1. Perché Misurare Invece di Indovinare

Il nome del modello è un pessimo predittore del comportamento reale, soprattutto sotto i 30 miliardi di parametri, dove due checkpoint della stessa famiglia possono differire enormemente in aderenza alle istruzioni, conformità JSON e tool-calling. I failure-mode che contano per far girare gli agenti — dimenticare un vincolo negativo, allucinare un argomento di tool, chiamare un tool che era vietato — sono esattamente quelli che la suite esercita. Misurarli trasforma "questo modello è affidabile per i tool `DANGEROUS`?" in un numero, non in una sensazione.

## 2. Il Comando

```
/benchmark [modello|all]
```

- `/benchmark <modello>` esegue l'intera suite su un singolo modello.
- `/benchmark all` (o senza argomento) spazza tutti i modelli noti al provider.
- Una singola esecuzione **spazza tutti e quattro i livelli di reasoning-effort** e salva un profilo per livello (vedi §6).

Il risultato viene salvato in `models_profile.json` e consumato subito dal registro dei tool.

## 3. Le Tre Categorie

Ogni test appartiene a una di tre categorie, ognuna con il proprio punteggio 0..1:

| Categoria | Cosa misura | Esempio di errore che cattura |
|---|---|---|
| `instruction` | Aderenza esatta a istruzioni vincolate | Scrivere comunque la parola vietata |
| `json` | Output JSON strutturato, selezione e calcolo | Emettere un campo plausibile ma sbagliato |
| `toolCalling` | Selezione del tool, fedeltà degli argomenti tra i turni, astensione | Propagare l'ID sbagliato lungo una catena |

Un test può avere un `weight` (default 1) così che le trappole più difficili contino di più nella media di categoria; un test di tool-calling può estendersi su più step per dimostrare che il modello mantiene un parametro tra un turno e l'altro.

## 4. Il DSL dei Test

I test sono semplici file JSON in `benchmarks/`, caricati e validati a runtime — aggiungerne o modificarne uno non richiede cambi di codice. Ogni file dichiara:

```typescript
interface BenchTest {
  name: string;
  category: 'instruction' | 'json' | 'toolCalling';
  weight?: number;                 // nella media di categoria (default 1)
  tools?: any[];                   // schemi funzione OpenAI offerti durante il test
  prompt?: string;  checks?: BenchCheck[];   // forma breve: colpo singolo
  steps?: BenchStep[];                          // forma estesa: multi-turno
}
interface BenchStep {
  prompt?: string;     // messaggio utente di questo step
  toolResult?: string; // risultato iniettato per la tool call dello step precedente
  checks: BenchCheck[];
}
interface BenchCheck {
  type: string;        // vedi tabella sotto
  value?: any;         // parola / numero / regex / nome tool attesi
  arg?: string;        // per tool_arg_* : nome dell'argomento
  path?: string;       // per json_path_* : percorso a punti ("items[0].name")
  flags?: string;      // flag regex
  weight?: number;     // default 1
}
```

### Tipi di check

| Tipo | Verifica |
|---|---|
| `word_count` / `line_count` | numero esatto di parole / righe non vuote |
| `first_word` / `last_word` | prima / ultima parola esatta (punteggiatura di bordo rimossa) |
| `contains` / `not_contains` | sottostringa presente / assente (case-insensitive di default) |
| `regex` / `not_regex` | il pattern corrisponde / non corrisponde |
| `not_empty` | output non vuoto |
| `json_valid` | l'output contiene JSON parsabile (auto-riparato prima del parse) |
| `json_path_equals` / `json_path_type` / `json_path_length` | valore / tipo / lunghezza array a un percorso a punti |
| `tool_called` / `tool_not_called` | la (prima) tool call è / non è un dato nome |
| `tool_arg_equals` / `tool_arg_regex` | un argomento della tool call è uguale a / corrisponde a un valore |

## 5. Punteggio e Derivazione del Tier

Ogni check è binario; il punteggio di un test è la frazione pesata dei check superati. Il punteggio di categoria è la media pesata dei punteggi dei suoi test, e i tre punteggi di categoria formano il profilo:

```typescript
interface ModelScores { instruction: number; json: number; toolCalling: number; }
```

`computeTier` mappa quei punteggi su un tier:

| Tier | Condizione |
|---|---|
| `large` | `toolCalling ≥ 0.9` e `instruction ≥ 0.85` e `json ≥ 0.85` |
| `medium` | `toolCalling ≥ 0.6` e `json ≥ 0.5` |
| `small` | tutto il resto |

Il tier è ciò che usa il registro dei tool: in `ToolRegistry.listForLLM`, un tool con `requiredTier` superiore al tier misurato del modello semplicemente non viene offerto. Un benchmark ha quindi una conseguenza di sicurezza diretta, non solo informativa.

## 6. Sweep dei Livelli di Reasoning-Effort

La capacità dipende da quanto intensamente si chiede al modello di pensare. `/benchmark` esegue la suite una volta per ciascun livello di `['none', 'low', 'medium', 'xhigh']` e salva un profilo separato per livello, con chiave `"modello@effort"` — così un profilo misurato a `low` non viene mai scambiato per uno misurato a `xhigh`. Ogni profilo registra anche `avgCompletionTokens`, che svela l'over-thinking che `tokensPerSecond` da solo non vede: un modello che riempie l'output di ragionamento sprecato è veloce ma costa token.

L'esecuzione si chiude con una **raccomandazione**: il livello di effort più economico che raggiunge il tier massimo osservato. L'effort a runtime (`/effort`) e il benchmark sono accoppiati — cambiare effort può cambiare il tier effettivo, e con esso l'insieme dei tool visibili.

## 7. Storage del Profilo e Invalidazione

I profili vivono in `models_profile.json`. Un profilo è considerato valido solo se due guardie coincidono:

1. `benchmarkVersion` è uguale al `BENCHMARK_VERSION` corrente (incrementato quando cambia il significato di un punteggio).
2. `testsHash` è uguale a `getBenchmarkTestsHash()` — un digest di 8 caratteri dei file delle fixture.

Modificare un qualunque file in `benchmarks/` cambia l'hash e invalida silenziosamente tutti i profili esistenti, forzando una nuova esecuzione invece di fidarsi di un punteggio misurato su una suite diversa.

## 8. Inventario delle Fixture

| File | Nome | Categoria | Forma |
|---|---|---|---|
| `10_instruction_frase.json` | `frase_8_parole` | instruction | prompt singolo, 4 check |
| `11_instruction_lista.json` | `lista_vincoli_negativi` | instruction | prompt singolo, 3 check |
| `20_json_prodotti.json` | `json_prodotti` | json | prompt singolo, 7 check |
| `21_json_annidato.json` | `json_annidato` | json | prompt singolo, 11 check |
| `30_tool_catena.json` | `catena_tool_distrattori` | toolCalling · peso 2 | 2 step |
| `31_tool_trappola.json` | `trappola_astensione` | toolCalling | prompt singolo, 2 check |
| `32_tool_write_append.json` | `tool_write_append` | toolCalling · peso 2 | 2 step |

## 9. Letture Correlate

- Tiering dei tool e modello dei permessi: [Framework di Sicurezza e Permessi](security-it.md).
- Come il tier raggiunge il prompt del modello: [Architettura di Sistema](architecture-it.md).
- La narrazione completa per milestone: [Guida Didattica](guida-didattica.md).
