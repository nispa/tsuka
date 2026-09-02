# Self-Authoring dei Tool (`create_tool`)

<div align="right">
  <p>Read in <a href="self-authoring.md">English</a></p>
</div>

Il self-authoring consente a un agente di creare una piccola utility JavaScript, descriverne gli argomenti con JSON Schema e registrarla come tool durante la sessione corrente. È una capability avanzata, disabilitata per default.

## Perché è opt-in

Questo modello di sicurezza deriva dai rilievi di un **audit di sicurezza esterno** ricevuto dal progetto. L'audit ha evidenziato che il precedente affidamento a `node:vm`, a una blocklist e al livello di rischio dichiarato dal codice generato non costituiva un confine di sicurezza sufficiente.

Le remediation immediate sono quindi fail-closed:

- `create_tool` e i moduli custom non vengono caricati per default;
- creazione ed esecuzione dei tool custom sono sempre `DANGEROUS`;
- il filesystem fornito al tool è confinato nel workspace;
- `node:vm` verifica soltanto forma e timeout del modulo, non isola JavaScript ostile.

Abilitare la capability significa autorizzare codice JavaScript generato a essere eseguito nello stesso processo di TSUKA. Usala solo con modelli e richieste di cui ti fidi. Il contenimento strutturale futuro richiede un processo OS o container separato.

## 1. Abilitazione

Imposta esplicitamente l'opzione nel `tsuka.config.json` del progetto:

```json
{
  "selfAuthoringEnabled": true
}
```

Riavvia TSUKA dopo la modifica. Il valore assente o `false` mantiene disabilitati sia `create_tool` sia il caricamento dei tool custom già presenti su disco.

I ruoli predefiniti che includono `create_tool` in `allowedTools` sono `developer`, `sysadmin` e `game_designer`. Per altri ruoli, aggiungi esplicitamente `create_tool` al relativo file in `roles/`.

Questa è una decisione esplicita di fiducia a livello di progetto. Il ruolo `developer`, una richiesta di migliorare TSUKA o il riconoscimento automatico che l'agente sta lavorando sull'harness non devono mai abilitare la capability automaticamente.

## 2. Richiesta all'agente

Puoi descrivere il bisogno senza scrivere direttamente il payload:

> Crea un tool `count_lines` che riceva il percorso relativo di un file del workspace e restituisca il numero di righe.

Se il modello decide di usare `create_tool`, TSUKA presenta una conferma `DANGEROUS`. L'abilitazione nella configurazione rende disponibile la capability; non sostituisce la conferma di sicurezza.

La creazione va trattata come un flusso di revisione, non come delega di fiducia:

1. controlla il corpo proposto nel prompt `DANGEROUS` prima di consentire la creazione;
2. revisiona il modulo generato e il relativo JSON Schema su disco;
3. provalo in un workspace controllato;
4. soltanto dopo aggiungi il suo nome alla lista persistente `allowedTools` di un ruolo.

Ogni esecuzione successiva resta `DANGEROUS` e richiede una conferma propria. Né il flag di configurazione né la revisione del sorgente dimostrano che il codice sia sicuro: registrano la scelta consapevole dell'utente di esporre ed eseguire un'estensione non isolata. L'abilitazione del self-authoring carica anche i moduli custom esistenti all'avvio: revisiona quindi i file già su disco prima di abilitarla; il caricamento non è un passaggio sandboxato e non ha una conferma per singolo modulo.

Una chiamata equivalente è:

```json
{
  "name": "count_lines",
  "description": "Counts the lines in a workspace file.",
  "parameters": {
    "type": "object",
    "properties": {
      "file": {
        "type": "string",
        "description": "Workspace-relative file path."
      }
    },
    "required": ["file"]
  },
  "executeBody": "const content = fs.readFileSync(args.file, 'utf8'); return String(content.split(/\\r?\\n/).length);",
  "global": false
}
```

Il corpo riceve `args`, `fs` confinato nel workspace e `path`, e deve restituire una stringa. Non deve usare `require`, import dinamici, `eval`, `child_process`, API `process` o accesso al costruttore `Function`.

## 3. Persistenza e disponibilità

Con `global: false` o omesso, TSUKA scrive:

- `.tsuka/custom_tools/<nome>.js`;
- `.tsuka/custom_tools_schemas/<nome>.json`.

Con `global: true`, usa invece `TSUKA_HOME/custom_tools/` e `TSUKA_HOME/custom_tools_schemas/`. Il tool viene registrato a caldo, ma il ruolo attivo deve comunque nominarlo in `allowedTools` prima che un agente possa chiamarlo.

Per renderlo accessibile in modo permanente a un ruolo, aggiungi il suo nome a `allowedTools` nel file `roles/<ruolo>.json`:

```json
{
  "allowedTools": [
    "count_lines"
  ]
}
```

Ogni tool custom caricato resta classificato `DANGEROUS`, indipendentemente da ciò che dichiara il modulo. I classificatori di rischio custom vengono ignorati, quindi nessun modulo custom può declassare una singola invocazione a `SAFE` o `RESTRICTED`.

## 4. Disabilitazione e rimozione

Per impedire nuove creazioni e il caricamento dei tool custom:

```json
{
  "selfAuthoringEnabled": false
}
```

Riavvia quindi TSUKA. Questa operazione non elimina i file esistenti. Per rimuovere definitivamente un tool, elimina con attenzione il relativo modulo e schema dalle directory locali o globali sopra indicate e rimuovi il nome da `allowedTools`. Quando un tool esistente viene sostituito tramite `create_tool`, la versione precedente viene conservata nella directory `tools_backup/`.

## 5. Confini delle garanzie

Le conferme `DANGEROUS`, la workspace jail, la blocklist, i backup e la validazione dello schema sono difese complementari. Non trasformano codice generato potenzialmente ostile in codice isolato. Se non serve davvero il self-authoring, lascia l'opzione disabilitata.
