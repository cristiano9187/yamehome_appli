import fs from 'fs';

const p = 'c:/Users/chris/OneDrive/Documents/AgentReservationYamehome/whatsapp.json';
const j = JSON.parse(fs.readFileSync(p, 'utf8'));

const httpFeedId = 'c7d8e9f0-a1b2-4345-c789-0123456789ab';

/** Retirer anciens nœuds (extraction + lookup ciblés). */
j.nodes = j.nodes.filter(
  (n) => n.name !== 'Prospect search prep' && n.name !== 'WhatsApp Prospect Lookup',
);

if (!j.nodes.some((n) => n.id === httpFeedId)) {
  j.nodes.push({
    parameters: {
      method: 'GET',
      url: 'https://europe-west1-gen-lang-client-0764402913.cloudfunctions.net/whatsappProspectFeed',
      authentication: 'genericCredentialType',
      genericAuthType: 'httpHeaderAuth',
      options: {
        response: {
          response: {
            responseFormat: 'json',
            fullResponse: false,
          },
        },
      },
    },
    type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.3,
    position: [2380, 1536],
    id: httpFeedId,
    name: 'HTTP Prospects Feed',
    credentials: {
      httpHeaderAuth: {
        name: 'Header Auth account 2',
      },
    },
  });
}

const merge = j.nodes.find((n) => n.name === 'Merge Gemini Context');
if (merge) {
  merge.parameters.jsCode = `const calendarForGemini = $('Aggregate').first().json;
const prospectFeed = $input.first().json;
return [{ json: { calendarForGemini, prospectFeed } }];`;
}

/* Connexions branche réservation (assistant principal) */
j.connections.Aggregate = {
  main: [[{ node: 'HTTP Prospects Feed', type: 'main', index: 0 }]],
};
j.connections['HTTP Prospects Feed'] = {
  main: [[{ node: 'Merge Gemini Context', type: 'main', index: 0 }]],
};

delete j.connections['Prospect search prep'];
delete j.connections['WhatsApp Prospect Lookup'];

/* Instructions Gemini : liste complète comme le calendrier */
const gem = j.nodes.find((n) => n.name === 'Message a model');
if (gem?.parameters?.options?.systemMessage) {
  let sm = gem.parameters.options.systemMessage;
  const oldBlock = `PROSPECTS CRM (app YameHome, lecture seule — JSON ci-dessous)
• Tente d'abord de faire correspondre le numéro WhatsApp du client avec le champ phone des fiches (souvent sans indicatif 237).
• Si matchCount vaut 1 et que c'est cohérent : confirme logement, dates, prix total sans redemander inutilement.
• Si 0 résultat : demande poliment les dates du séjour puis le nom pour affiner.
• Si plusieurs fiches : une seule question courte pour trancher (dates ou nom de famille).
{{ JSON.stringify($json.prospectLookup) }}`;
  const newBlock = `PROSPECTS CRM (app YameHome — JSON réel, même principe que le calendrier ci-dessous)
• Tu reçois la liste des fiches \`prospects\` (CRM). C'est la source de vérité pour dossiers Booking / site / autres saisis par l'équipe.
• Pour répondre au client : cherche dans ce JSON les lignes qui correspondent à ce qu'il dit (nom, dates, source BOOKING/SITE_WEB/etc., logement, slug).
• Ne dis pas que « la réservation n'est pas dans le système » si une ligne du JSON correspond raisonnablement (tolère accents, téléphone sans indicatif, petites variations de nom).
• Si plusieurs lignes possibles : une seule question courte pour trancher.
{{ JSON.stringify($json.prospectFeed) }}`;
  if (sm.includes('prospectLookup')) {
    sm = sm.replace(oldBlock, newBlock);
  } else {
    sm = sm.replace(
      /\{\{ JSON\.stringify\(\$json\.prospectLookup\) \}\}/g,
      '{{ JSON.stringify($json.prospectFeed) }}',
    );
  }
  gem.parameters.options.systemMessage = sm;
}

fs.writeFileSync(p, JSON.stringify(j, null, 2));
console.log('Switched to HTTP Prospects Feed + full JSON in prompt.');
