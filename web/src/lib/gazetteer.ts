/**
 * Location + profession gazetteer and matcher for the P1 insights.
 * Runs on the stage client against the local transcript; only the matched
 * terms (and their category) are sent on — never audio, never the full
 * transcript.
 *
 * Deliberately minimal per the spec: it reports *that* a place/profession was
 * mentioned, not who said it or in what context.
 */
import type { Keyword } from "../../../shared/protocol";
const COUNTRIES = [
  "Afghanistan", "Albania", "Algeria", "Andorra", "Angola", "Argentina",
  "Armenia", "Australia", "Austria", "Azerbaijan", "Bahamas", "Bahrain",
  "Bangladesh", "Barbados", "Belarus", "Belgium", "Belize", "Benin", "Bhutan",
  "Bolivia", "Bosnia", "Botswana", "Brazil", "Brunei", "Bulgaria",
  "Burkina Faso", "Burundi", "Cambodia", "Cameroon", "Canada", "Chad", "Chile",
  "China", "Colombia", "Congo", "Costa Rica", "Croatia", "Cuba", "Cyprus",
  "Czechia", "Czech Republic", "Denmark", "Djibouti", "Dominica",
  "Dominican Republic", "Ecuador", "Egypt", "El Salvador", "England",
  "Estonia", "Ethiopia", "Fiji", "Finland", "France", "Gabon", "Gambia",
  "Georgia", "Germany", "Ghana", "Greece", "Grenada", "Guatemala", "Guinea",
  "Guyana", "Haiti", "Honduras", "Hungary", "Iceland", "India", "Indonesia",
  "Iran", "Iraq", "Ireland", "Israel", "Italy", "Ivory Coast", "Jamaica",
  "Japan", "Jordan", "Kazakhstan", "Kenya", "Kosovo", "Kuwait", "Kyrgyzstan",
  "Laos", "Latvia", "Lebanon", "Lesotho", "Liberia", "Libya", "Liechtenstein",
  "Lithuania", "Luxembourg", "Madagascar", "Malawi", "Malaysia", "Maldives",
  "Mali", "Malta", "Mauritania", "Mauritius", "Mexico", "Moldova", "Monaco",
  "Mongolia", "Montenegro", "Morocco", "Mozambique", "Myanmar", "Namibia",
  "Nepal", "Netherlands", "New Zealand", "Nicaragua", "Niger", "Nigeria",
  "North Korea", "North Macedonia", "Norway", "Oman", "Pakistan", "Palestine",
  "Panama", "Paraguay", "Peru", "Philippines", "Poland", "Portugal", "Qatar",
  "Romania", "Russia", "Rwanda", "Samoa", "San Marino", "Saudi Arabia",
  "Scotland", "Senegal", "Serbia", "Seychelles", "Sierra Leone", "Singapore",
  "Slovakia", "Slovenia", "Somalia", "South Africa", "South Korea",
  "South Sudan", "Spain", "Sri Lanka", "Sudan", "Suriname", "Sweden",
  "Switzerland", "Syria", "Taiwan", "Tajikistan", "Tanzania", "Thailand",
  "Togo", "Tonga", "Trinidad", "Tunisia", "Turkey", "Turkmenistan", "Uganda",
  "Ukraine", "United Arab Emirates", "United Kingdom", "United States",
  "Uruguay", "Uzbekistan", "Venezuela", "Vietnam", "Wales", "Yemen", "Zambia",
  "Zimbabwe",
];

const CITIES = [
  "Amsterdam", "Athens", "Atlanta", "Austin", "Bangkok", "Barcelona",
  "Beijing", "Berlin", "Boston", "Brisbane", "Brussels", "Bucharest",
  "Budapest", "Buenos Aires", "Cairo", "Cape Town", "Chicago", "Copenhagen",
  "Dallas", "Delhi", "Denver", "Detroit", "Dubai", "Dublin", "Edinburgh",
  "Frankfurt", "Geneva", "Glasgow", "Hamburg", "Helsinki", "Hong Kong",
  "Houston", "Istanbul", "Jakarta", "Johannesburg", "Kyiv", "Las Vegas",
  "Lisbon", "London", "Los Angeles", "Madrid", "Manchester", "Manila",
  "Melbourne", "Miami", "Milan", "Montreal", "Moscow", "Mumbai", "Munich",
  "Nashville", "New Orleans", "New York", "Oslo", "Paris", "Philadelphia",
  "Phoenix", "Portland", "Prague", "Reykjavik", "Rio de Janeiro", "Rome",
  "San Diego", "San Francisco", "Seattle", "Seoul", "Shanghai", "Singapore",
  "Stockholm", "Sydney", "Tallinn", "Tampere", "Tel Aviv", "Tokyo", "Toronto",
  "Turku", "Vancouver", "Vienna", "Warsaw", "Washington", "Zurich",
  "Aarhus", "Abu Dhabi", "Accra", "Adelaide", "Ankara", "Antwerp", "Auckland",
  "Baltimore", "Bangalore", "Basel", "Belfast", "Belgrade", "Bergen", "Bilbao",
  "Birmingham", "Bogota", "Bologna", "Bordeaux", "Bratislava", "Bremen",
  "Bristol", "Calgary", "Canberra", "Cardiff", "Cartagena", "Casablanca",
  "Chennai", "Christchurch", "Cincinnati", "Cleveland", "Cologne", "Columbus",
  "Cordoba", "Dresden", "Dusseldorf", "Edmonton", "Florence", "Fukuoka",
  "Gdansk", "Gothenburg", "Graz", "Guadalajara", "Hanoi", "Hobart",
  "Kansas City", "Karachi", "Kolkata", "Krakow", "Kuala Lumpur", "Kyoto",
  "Lagos", "Leeds", "Leipzig", "Lima", "Liverpool", "Lyon", "Malmo",
  "Marseille", "Medellin", "Memphis", "Milwaukee", "Minneapolis", "Monterrey",
  "Nagoya", "Nantes", "Naples", "Newcastle", "Nice", "Nuremberg", "Odense",
  "Osaka", "Ottawa", "Palermo", "Perth", "Pittsburgh", "Porto", "Quebec",
  "Raleigh", "Riga", "Rotterdam", "Sacramento", "Salzburg", "San Antonio",
  "San Jose", "Santiago", "Sapporo", "Sevilla", "Sheffield", "Sofia",
  "St Louis", "St Petersburg", "Stuttgart", "Tampa", "The Hague",
  "Thessaloniki", "Tijuana", "Trondheim", "Utrecht", "Valencia", "Venice",
  "Verona", "Vilnius", "Wellington", "Wroclaw", "Yokohama", "Zagreb",
];

// US states (+ common in crowd work).
const STATES = [
  "Alabama", "Alaska", "Arizona", "Arkansas", "California", "Colorado",
  "Connecticut", "Delaware", "Florida", "Georgia", "Hawaii", "Idaho",
  "Illinois", "Indiana", "Iowa", "Kansas", "Kentucky", "Louisiana", "Maine",
  "Maryland", "Massachusetts", "Michigan", "Minnesota", "Mississippi",
  "Missouri", "Montana", "Nebraska", "Nevada", "New Hampshire", "New Jersey",
  "New Mexico", "North Carolina", "North Dakota", "Ohio", "Oklahoma", "Oregon",
  "Pennsylvania", "Rhode Island", "South Carolina", "South Dakota", "Tennessee",
  "Texas", "Utah", "Vermont", "Virginia", "West Virginia", "Wisconsin",
  "Wyoming",
];

// Curated to avoid words that double as common verbs/nouns (e.g. "cook", "vet").
const PROFESSIONS = [
  "accountant", "actor", "actuary", "administrator", "analyst",
  "anesthesiologist", "architect", "artist", "astronaut", "athlete",
  "attorney", "auditor", "author", "baker", "banker", "barber", "bartender",
  "builder", "butcher", "cardiologist", "carpenter", "cashier", "chef",
  "chemist", "chiropractor", "cleaner", "coach", "comedian", "consultant",
  "contractor", "counselor", "dentist", "designer", "detective", "developer",
  "dietitian", "diplomat", "doctor", "economist", "editor", "electrician",
  "engineer", "entrepreneur", "farmer", "firefighter", "fisherman", "florist",
  "gardener", "geologist", "hairdresser", "historian", "instructor", "janitor",
  "jeweler", "journalist", "judge", "lawyer", "lecturer", "librarian",
  "lifeguard", "locksmith", "machinist", "magician", "manager", "mechanic",
  "midwife", "miner", "musician", "nurse", "optician", "optometrist",
  "painter", "paramedic", "pastor", "pediatrician", "pharmacist",
  "photographer", "physician", "physicist", "physiotherapist", "pilot",
  "plumber", "poet", "politician", "priest", "producer", "professor",
  "programmer", "psychiatrist", "psychologist", "radiologist", "realtor",
  "receptionist", "recruiter", "reporter", "researcher", "roofer", "sailor",
  "salesman", "scientist", "sculptor", "secretary", "singer", "soldier",
  "student", "surgeon", "surveyor", "tailor", "teacher", "technician",
  "therapist", "translator", "tutor", "veterinarian", "waiter", "waitress",
  "welder", "writer",
  "police officer", "flight attendant", "social worker", "real estate agent",
  "software engineer", "civil engineer", "truck driver", "bus driver",
  "taxi driver", "personal trainer", "graphic designer", "web developer",
  "air traffic controller", "data scientist", "project manager",
  "product manager",
  // additional roles
  "ambassador", "announcer", "appraiser", "arborist", "astronomer",
  "biologist", "blacksmith", "botanist", "caretaker", "cartographer",
  "caterer", "chaplain", "choreographer", "conductor", "coroner", "courier",
  "curator", "dancer", "draftsman", "engraver", "examiner", "financier",
  "forester", "glazier", "goldsmith", "groundskeeper", "gunsmith",
  "herbalist", "illustrator", "inspector", "interpreter", "inventor",
  "jockey", "landscaper", "locksmith", "mason", "mayor", "medic",
  "meteorologist", "mortician", "navigator", "notary", "nutritionist",
  "organist", "paralegal", "pharmacologist", "phlebotomist", "pianist",
  "planner", "plasterer", "playwright", "podiatrist", "preacher", "principal",
  "printer", "proofreader", "prosecutor", "publisher", "rancher", "ranger",
  "referee", "registrar", "sommelier", "steward", "stockbroker", "stonemason",
  "taxidermist", "trooper", "trucker", "umpire", "undertaker", "upholsterer",
  "vintner", "violinist", "warden", "watchmaker", "zookeeper", "zoologist",
];

const LOOKUP = new Map<string, Keyword>();
for (const term of [...COUNTRIES, ...CITIES, ...STATES]) {
  LOOKUP.set(term.toLowerCase(), { term, category: "location" });
}
for (const term of PROFESSIONS) {
  LOOKUP.set(term.toLowerCase(), { term, category: "profession" });
}
const MAX_WORDS = 3; // longest multi-word entry, e.g. "air traffic controller"

/** Location + profession keywords found in `text`, deduped. */
export function extractKeywords(text: string): Keyword[] {
  const words = text
    .toLowerCase()
    .replace(/[^\p{L}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
  const found = new Map<string, Keyword>();
  for (let i = 0; i < words.length; i++) {
    // Prefer the longest phrase so "New York" wins over "York".
    for (let n = Math.min(MAX_WORDS, words.length - i); n >= 1; n--) {
      const kw = LOOKUP.get(words.slice(i, i + n).join(" "));
      if (kw) {
        found.set(`${kw.category}:${kw.term}`, kw);
        i += n - 1;
        break;
      }
    }
  }
  return [...found.values()];
}
