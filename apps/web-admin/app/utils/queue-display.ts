/**
 * User-friendly labels and tooltips for queue names in the Queues snapshot table.
 * All descriptions are based on actual worker/job logic in the codebase.
 */

export type QueueDisplayInfo = Readonly<{
  labelRo: string;
  tooltip: string;
}>;

const QUEUE_DISPLAY: Record<string, QueueDisplayInfo> = {
  'webhook-queue': {
    labelRo: 'Notificări Shopify',
    tooltip:
      'Coada unde ajung notificările automate trimise de Shopify când se întâmplă ceva în magazin (produs creat sau actualizat, comandă, client etc.). Aplicația le preia, le verifică și le procesează astfel încât datele din Neanelu să rămână aliniate cu magazinul. Dacă aceste notificări se întârzie sau lipsesc, poți folosi acțiunea „Reconcile Webhooks" de pe dashboard.',
  },
  'sync-queue': {
    labelRo: 'Sincronizare manuală',
    tooltip:
      'Coada pentru sincronizarea inițiată de tine din dashboard (butonul „Reconcile Webhooks"). Nu pornește o exportare completă de produse, ci verifică și recreează abonamentele de notificări către Shopify, astfel încât evenimentele viitoare să ajungă corect. Este limitată la o dată pe oră per magazin.',
  },
  'bulk-queue': {
    labelRo: 'Orchestrator sincronizare în masă',
    tooltip:
      'Conduce sincronizarea completă a catalogului de produse din Shopify: pornește exportul în masă către Shopify, apoi lansează descărcarea și procesarea datelor. Job-urile din această coadă sunt create când apeși „Porneste sync complet" pe pagina Ingestion.',
  },
  'bulk-poller-queue': {
    labelRo: 'Verificare status export Shopify',
    tooltip:
      'Verifică periodic la Shopify dacă exportul în masă a fost finalizat și când fișierul cu produse este gata de descărcare. Lucrează împreună cu orchestratorul de bulk: orchestratorul pornește exportul, iar această coadă urmărește progresul până la finalizare.',
  },
  'bulk-mutation-reconcile-queue': {
    labelRo: 'Reconciliere modificări după bulk',
    tooltip:
      'După ce o sincronizare în masă a terminat de scris produse în baza de date, această coadă reconciliază eventualele modificări făcute în magazin în timpul exportului. Asigură consistența între ce s-a exportat și ce este acum în baza de date.',
  },
  'bulk-ingest-queue': {
    labelRo: 'Încărcare date bulk',
    tooltip:
      'Preia fișierul generat de Shopify cu produsele din exportul în masă, îl parsează și scrie sau actualizează înregistrările în baza de date. Este coada care efectuează efectiv „ingestia" datelor după ce orchestratorul și poller-ul au pregătit exportul.',
  },
  'ai-batch-queue': {
    labelRo: 'Procesare AI (embedding-uri)',
    tooltip:
      'Coada pentru job-uri de tip AI în lot: generare de embedding-uri pentru produse (pentru căutare semantică), curățare și backfill. Folosește servicii externe (ex. OpenAI) și este supusă limitărilor de cost și rate. Job-urile pot fi orchestrate, programate sau pornite la cerere.',
  },
  'pim-enrichment-queue': {
    labelRo: 'Îmbogățire date produse (PIM)',
    tooltip:
      'Îmbogățește informațiile despre produse: completează sau actualizează datele din surse interne și externe pentru a ridica calitatea (de la bronze la silver/golden). Poate fi declanșată manual, de programatorul automat sau după confirmarea unor potriviri.',
  },
  'pim-similarity-search': {
    labelRo: 'Căutare potriviri similare',
    tooltip:
      'Caută în surse externe produse care par să fie același produs cu cele din magazinul tău (potriviri similare). Rezultatele apar în pagina „Similarity Matches", unde le poți confirma sau respinge. Când adaugi un produs nou sau când ceri explicit o căutare, job-urile sunt puse aici.',
  },
  'pim-ai-audit': {
    labelRo: 'Audit AI potriviri',
    tooltip:
      'Un pas opțional după căutarea de potriviri: un model de AI analizează potrivirea și poate recomanda aprobare automată, trimitere la revizuire umană sau respingere. Reduce volumul de lucru manual pentru potrivirile foarte clare sau evident greșite.',
  },
  'pim-extraction': {
    labelRo: 'Extracție specificații (xAI)',
    tooltip:
      'Pentru potrivirile confirmate, extrage automat specificații sau atribute din sursa externă folosind un serviciu de tip xAI (Grok). Rezultatele alimentează consensul de date pentru produs. Poți porni extracția din interfața „Similarity Matches" pentru un match selectat.',
  },
  'pim-scraper-queue': {
    labelRo: 'Scraping surse externe',
    tooltip:
      'Procesează job-uri de scraping: accesează pagini web externe (de exemplu link-uri din potriviri) pentru a obține conținut sau date. Este folosit în fluxul PIM când trebuie preluate informații din surse care nu oferă API.',
  },
  'pim-consensus': {
    labelRo: 'Consens date produs',
    tooltip:
      'Calculează sau actualizează „consensul" pentru fiecare produs: combină valorile din mai multe surse (magazin, potriviri, extracții) într-o singură versiune de încredere. Se rulează după confirmarea unei potriviri, după o extracție sau la cerere manuală.',
  },
  'pim-quality-webhook': {
    labelRo: 'Trimitere notificări calitate',
    tooltip:
      'Trimite către un endpoint configurat (webhook) notificări despre evenimente de calitate a datelor (ex. produs a trecut la nivel golden, sau necesită revizuire). Destinatarul poate fi un sistem extern care primește aceste evenimente.',
  },
  'pim-quality-webhook-sweep': {
    labelRo: 'Recuperare notificări calitate neefectuate',
    tooltip:
      'Rulează periodic (la câteva minute) și identifică evenimente de calitate pentru care notificarea webhook nu a fost încă trimisă; pune job-uri în coada de trimitere. Asigură că niciun eveniment important nu rămâne necomunicat din cauza unei erori temporare.',
  },
  'pim-budget-reset-queue': {
    labelRo: 'Reset zilnic buget API',
    tooltip:
      'Rulează o dată pe zi (la miezul nopții UTC) și resetează contoarele de buget pentru API-urile plătite (ex. OpenAI, Serper). După reset, cozile care erau oprite din cauza bugetului epuizat pot fi repornite automat, astfel încât procesarea să reia.',
  },
  'pim-weekly-summary-queue': {
    labelRo: 'Rezumat săptămânal costuri',
    tooltip:
      'Rulează săptămânal (luni dimineața) și generează pentru fiecare magazin un rezumat al costurilor API din săptămâna trecută. Salvează notificarea în aplicație și, dacă este configurat, trimite un webhook către un URL extern cu aceste informații.',
  },
  'pim-auto-enrichment-scheduler-queue': {
    labelRo: 'Programator îmbogățire automată',
    tooltip:
      'Rulează la intervale regulate (ex. la fiecare 10 minute) și identifică produse care sunt încă la nivel „bronze" sau care nu au fost îmbogățite de mult; pune job-uri în coada de îmbogățire. Asigură îmbogățirea continuă fără acțiune manuală.',
  },
  'pim-raw-harvest-retention-queue': {
    labelRo: 'Curățare date brute vechi',
    tooltip:
      'Rulează zilnic și șterge din baza de date înregistrările „raw" (date brute din surse) care au expirat sau sunt mai vechi de 90 de zile. Menține baza de date la o dimensiune rezonabilă și respectă politicile de reținere a datelor.',
  },
  'pim-mv-refresh-queue': {
    labelRo: 'Actualizare tabele rezumat',
    tooltip:
      'Actualizează tabelele precalculate („materialized views") folosite pentru dashboard-ul PIM: progres calitate, performanța surselor etc. Rulează atât pe un ciclu scurt (orar) cât și pe unul lung (zilnic), astfel încât graficele și KPI-urile să reflecte date proaspete.',
  },
  'token-health': {
    labelRo: 'Verificare token Shopify',
    tooltip:
      'Verifică periodic dacă token-urile OAuth ale magazinelor sunt încă valide și dacă trebuie reînnoite. Ajută la păstrarea conexiunii cu Shopify și la evitarea erorilor când un token a expirat.',
  },
};

/** DLQ (Dead Letter Queue): job-uri care au eșuat după toate încercările. */
const DLQ_SUFFIX = '-dlq';

/**
 * Returns user-friendly label and tooltip for a queue name.
 * For DLQ queues, label is "Eșecuri: [friendly name]" and tooltip explains DLQ.
 */
export function getQueueDisplayInfo(queueName: string): QueueDisplayInfo {
  const isDlq = queueName.endsWith(DLQ_SUFFIX);
  const baseName = isDlq ? queueName.slice(0, -DLQ_SUFFIX.length) : queueName;
  const baseInfo = QUEUE_DISPLAY[baseName];

  if (isDlq) {
    const baseLabel = baseInfo?.labelRo ?? baseName;
    return {
      labelRo: `Eșecuri: ${baseLabel}`,
      tooltip: `Coadă de eșecuri pentru „${baseLabel}". Aici sunt mutate job-urile care au eșuat după toate încercările de relansare. Poți inspecta job-urile, șterge cele nefolositoare sau folosi „Reia din DLQ" pentru a le repune în coada principală și a le reprocesa. Nume intern: ${queueName}.`,
    };
  }

  if (baseInfo) {
    return {
      labelRo: baseInfo.labelRo,
      tooltip: baseInfo.tooltip + ' Nume intern: ' + queueName + '.',
    };
  }

  return {
    labelRo: queueName,
    tooltip: `Coadă internă: ${queueName}. Numerele arată câte job-uri sunt în așteptare, în execuție, amânate, finalizate sau eșuate. Nume intern: ${queueName}.`,
  };
}
