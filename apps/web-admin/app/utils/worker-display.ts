/**
 * Etichete și tooltip-uri user-friendly pentru fiecare worker afișat în tab-ul Workeri.
 * Descrierile sunt bazate pe logica reală din apps/backend-worker (processors, queue, worker-registry).
 * Limbaj non-tehnic pentru utilizatori care iau prima dată contact cu aplicația.
 */

export type WorkerDisplayInfo = Readonly<{
  labelRo: string;
  tooltip: string;
}>;

const WORKER_DISPLAY: Record<string, WorkerDisplayInfo> = {
  'webhook-worker': {
    labelRo: 'Procesare notificări Shopify',
    tooltip:
      'Acest worker preia notificările automate trimise de Shopify când se întâmplă ceva în magazin: produs creat sau actualizat, comandă plasată, client înregistrat, aplicație dezinstalată etc. Le verifică (semnătură HMAC), le salvează în baza de date și le distribuie către handler-ele corespunzătoare. Astfel, datele din Neanelu rămân mereu aliniate cu magazinul. Fără acest worker, notificările s-ar pierde și sincronizarea s-ar strica.',
  },
  'token-health-worker': {
    labelRo: 'Verificare token magazin',
    tooltip:
      'Rulează periodic verificări pentru a vedea dacă token-urile de acces la Shopify mai sunt valide pentru fiecare magazin conectat. Dacă un token a expirat sau a fost revocat, magazinul este marcat ca necesitând reconectare, iar utilizatorul va fi notificat. În acest fel aplicația evită să facă apeluri eșuate către Shopify și știe când trebuie reautentificare.',
  },
  'sync-worker': {
    labelRo: 'Sincronizare manuală (reconciliere webhook-uri)',
    tooltip:
      'Execută sincronizarea pe care o pornești tu din dashboard cu butonul „Reconcile Webhooks”. Nu face un export complet de produse, ci verifică și recreează abonamentele de notificări către Shopify, astfel încât evenimentele viitoare (produse, comenzi etc.) să ajungă corect la aplicație. Este limitată la o dată pe oră per magazin pentru a nu supraîncărca API-ul Shopify.',
  },
  'bulk-orchestrator-worker': {
    labelRo: 'Orchestrator sincronizare în masă',
    tooltip:
      'Conduce sincronizarea completă a catalogului de produse din Shopify. Când pornești un „sync complet” (export în masă), acest worker: rezervă dreptul de a rula un singur bulk activ per magazin, pornește la Shopify cererea de export, încarcă fișierul cu date și lansează pașii următori (descărcare, procesare). Coordonează tot fluxul de la start până la finalizare.',
  },
  'bulk-poller-worker': {
    labelRo: 'Verificare status export Shopify',
    tooltip:
      'Verifică periodic la Shopify dacă exportul în masă a fost finalizat. După ce orchestratorul a pornit exportul, Shopify procesează cererea în fundal; acest worker întreabă „e gata?” și când fișierul cu produse este disponibil pentru descărcare, declanșează încărcarea datelor. Lucrează împreună cu orchestratorul și worker-ul de încărcare.',
  },
  'bulk-mutation-reconcile-worker': {
    labelRo: 'Reconciliere modificări după export',
    tooltip:
      'După ce datele din exportul în masă au fost scrise în baza de date, acest worker verifică dacă în magazin s-au făcut modificări în timpul exportului. Reconciliază eventualele diferențe astfel încât baza de date să reflecte corect starea actuală a produselor, fără pierderi sau conflicte.',
  },
  'bulk-ingest-worker': {
    labelRo: 'Încărcare și procesare date bulk',
    tooltip:
      'Preia fișierul generat de Shopify cu produsele din exportul în masă: îl descarcă, îl parsează (linie cu linie) și scrie sau actualizează înregistrările în baza de date. Efectuează și operații de „stitching” (reunire variante cu produsul părinte) și poate declanșa sincronizarea cu modulul PIM. Este worker-ul care face efectiv „ingestia” datelor după ce exportul este gata.',
  },
  'ai-batch-worker': {
    labelRo: 'Procesare AI (embedding-uri pentru căutare)',
    tooltip:
      'Procesează job-uri de tip AI în lot: generează „embedding-uri” pentru produse (reprezentări numerice ale titlurilor și descrierilor) folosite la căutare semantică și la potriviri. Folosește servicii externe (ex. OpenAI) și respectă limitele de cost și de rată configurate per magazin. Poate rula la cerere, la program sau ca urmare a unui backfill.',
  },
  'enrichment-worker': {
    labelRo: 'Îmbogățire date produse (PIM)',
    tooltip:
      'Îmbogățește informațiile despre produse: completează sau actualizează datele din surse interne și externe pentru a ridica nivelul de calitate (de la bronze la silver sau golden). Verifică bugetele de API înainte de a trimite cereri. După îmbogățire, poate pune în coadă căutări de potriviri similare. Poate fi declanșat manual, de programatorul automat sau după confirmarea unor potriviri.',
  },
  'similarity-search-worker': {
    labelRo: 'Căutare potriviri similare',
    tooltip:
      'Caută în surse externe (GTIN, MPN, titlu etc.) produse care par să fie același produs cu cele din magazinul tău. Rezultatele apar în interfața „Similarity Matches”, unde le poți confirma sau respinge. După căutare, poate programa un audit AI sau o extracție de specificații. Este parte din fluxul PIM de îmbunătățire a datelor produselor.',
  },
  'ai-audit-worker': {
    labelRo: 'Audit AI al potrivirilor',
    tooltip:
      'După ce s-a găsit o potrivire similară, acest worker opțional folosește un model de AI (xAI/Grok) pentru a analiza potrivirea și a recomanda: aprobare automată, trimitere la revizuire umană sau respingere. Reduce volumul de lucru manual pentru potrivirile foarte clare sau evident greșite. La final poate programa extracția de specificații pentru potrivirile confirmate.',
  },
  'pim-extraction-worker': {
    labelRo: 'Extracție specificații cu AI (xAI)',
    tooltip:
      'Pentru potrivirile pe care le-ai confirmat, extrage automat specificații sau atribute (mărime, material, culoare etc.) din pagina sursă folosind un serviciu de tip xAI. Poate folosi și scraping pentru a obține HTML-ul paginii. Rezultatele sunt salvate și alimentează „consensul” de date pentru produs. Poți porni extracția din interfața de potriviri pentru un match selectat.',
  },
  'consensus-worker': {
    labelRo: 'Consens date produs',
    tooltip:
      'Calculează sau actualizează „consensul” pentru fiecare produs: combină valorile din mai multe surse (magazin, potriviri confirmate, extracții) într-o singură versiune de încredere, cu reguli de prioritizare și rezolvare a conflictelor. După consens, actualizează nivelul de calitate (bronze/silver/golden) și poate trimite notificări de calitate către un webhook configurat.',
  },
  'pim-budget-reset-worker': {
    labelRo: 'Reset zilnic buget API (PIM)',
    tooltip:
      'Rulează zilnic (la miezul nopții UTC) și resetează contoarele de buget pentru serviciile plătite folosite de PIM (ex. xAI, Serper). Cozile care au fost oprite pentru că bugetul zilnic a fost depășit sunt repornite, astfel încât în noua zi procesarea să poată continua automat.',
  },
  'pim-weekly-summary-worker': {
    labelRo: 'Rezumat săptămânal costuri',
    tooltip:
      'Rulează periodic și generează un rezumat al costurilor și al utilizării API-urilor plătite (PIM, AI etc.) pe perioada trecută. Poate trimite acest rezumat către un endpoint configurat (webhook) cu semnătură HMAC, astfel încât să poți monitoriza cheltuielile și utilizarea serviciilor externe.',
  },
  'pim-auto-enrichment-scheduler-worker': {
    labelRo: 'Programator îmbogățire automată',
    tooltip:
      'Rulează la interval și caută produse care au nevoie de îmbogățire: de exemplu produse cu nivel de calitate bronze sau care nu au fost actualizate de mult. Le pune în coada de îmbogățire, în număr limitat per magazin, astfel încât îmbogățirea să avanseze constant fără a supraîncărca sistemul.',
  },
  'pim-raw-harvest-retention-worker': {
    labelRo: 'Curățare date brute vechi',
    tooltip:
      'Rulează zilnic și șterge din baza de date înregistrările „raw” (date brute) de la extracții sau harvest-uri care au depășit termenul de păstrare (ex. 90 de zile) sau care au marcat expirare. Păstrează baza de date curată și eliberează spațiu, fără a afecta datele consolidate folosite în aplicație.',
  },
  'pim-mv-refresh-worker': {
    labelRo: 'Actualizare tabele rezumat',
    tooltip:
      'Actualizează periodic „tabelele rezumat” (materialized views) din baza de date care servesc statistici și rapoarte: progres calitate produse, performanță surse etc. Rulează la oră sau zilnic, în funcție de tip. Interfața și rapoartele se bazează pe aceste tabele pentru a afișa date la zi.',
  },
  'pim-quality-webhook-worker': {
    labelRo: 'Trimitere notificări calitate',
    tooltip:
      'Trimite către un URL configurat de tine (webhook) notificări despre evenimente de calitate a datelor: de exemplu când un produs a trecut la nivel golden, sau când necesită revizuire. Poți activa/dezactiva webhook-ul și alege ce tipuri de evenimente să primești. Util pentru integrări cu alte sisteme sau alerte.',
  },
  'pim-quality-webhook-sweep-worker': {
    labelRo: 'Recuperare notificări calitate neefectuate',
    tooltip:
      'Rulează la câteva minute și verifică dacă există evenimente de calitate care ar fi trebuit trimise la webhook dar nu au fost (de ex. după o întrerupere). Le pune din nou în coada de trimitere, astfel încât niciun eveniment important să nu rămână neînregistrat la tine.',
  },
};

export function getWorkerDisplayInfo(workerId: string): WorkerDisplayInfo {
  const known = WORKER_DISPLAY[workerId];
  if (known) return known;
  return {
    labelRo: workerId,
    tooltip: `Worker cu identificatorul „${workerId}". Nu există o descriere specifică în aplicație; poți contacta administratorul pentru detalii.`,
  };
}
