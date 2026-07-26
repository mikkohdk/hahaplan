/**
 * Location gazetteer + matcher for the P1 "locations mentioned" insight.
 * Runs on the stage client against the local transcript; only the matched
 * location names are sent on — never audio, never the full transcript.
 *
 * Deliberately minimal per the spec: it reports *that* a place was mentioned,
 * not who said it or in what context.
 */
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
];

const CANONICAL = [...COUNTRIES, ...CITIES];
const LOOKUP = new Map(CANONICAL.map((name) => [name.toLowerCase(), name]));
const MAX_WORDS = 3; // longest multi-word entry, e.g. "United Arab Emirates"

/** Location names found in `text`, deduped and in canonical casing. */
export function extractLocations(text: string): string[] {
  const words = text
    .toLowerCase()
    .replace(/[^\p{L}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
  const found = new Set<string>();
  for (let i = 0; i < words.length; i++) {
    // Prefer the longest phrase so "New York" wins over "York".
    for (let n = Math.min(MAX_WORDS, words.length - i); n >= 1; n--) {
      const canonical = LOOKUP.get(words.slice(i, i + n).join(" "));
      if (canonical) {
        found.add(canonical);
        i += n - 1;
        break;
      }
    }
  }
  return [...found];
}
