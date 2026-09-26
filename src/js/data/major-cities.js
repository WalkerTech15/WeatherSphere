/* Capitals and major cities, by country — the "capital or major-city" signal
 * the search ranking needs and no provider supplies: MapTiler's geocoder
 * returns neither a capital flag nor a population, so "Paris" arrives as one
 * of seven equally plain municipalities (France, Texas, Tennessee, Ontario…).
 *
 * A place counts as major when its normalized name (in either language) plus
 * its ISO country code is listed here. The country code is what keeps
 * "London, Ontario" and "Rome, New York" from inheriting the fame of the
 * capitals they share a name with.
 *
 * Deliberately short and hand-picked: national capitals, the largest cities
 * of large countries, and the places visitors most often look up. Not a
 * gazetteer — a place missing from it simply falls back to the next ranking
 * rule, it is never hidden. Names are lower-case and accent-free (the form
 * normalize() in data/locations.js produces), comma-separated, with the
 * common French exonyms beside the English names. */
export const MAJOR_CITIES = {
  FR: "paris,marseille,lyon,toulouse,nice,nantes,strasbourg,bordeaux,lille,montpellier",
  GB: "london,londres,manchester,birmingham,edinburgh,edimbourg,glasgow,liverpool,cardiff,belfast",
  IE: "dublin",
  DE: "berlin,hamburg,munich,munchen,cologne,koln,frankfurt",
  ES: "madrid,barcelona,barcelone,valencia,seville,sevilla",
  PT: "lisbon,lisbonne,lisboa,porto",
  IT: "rome,roma,milan,milano,naples,napoli,venice,venise,venezia,florence,firenze,turin,torino",
  NL: "amsterdam",
  BE: "brussels,bruxelles",
  CH: "zurich,geneva,geneve,bern,berne",
  AT: "vienna,vienne,wien",
  CZ: "prague,praha",
  PL: "warsaw,varsovie,warszawa,krakow,cracovie",
  HU: "budapest",
  GR: "athens,athenes,athina",
  TR: "istanbul,ankara",
  RU: "moscow,moscou",
  UA: "kyiv,kiev",
  SE: "stockholm",
  NO: "oslo",
  DK: "copenhagen,copenhague",
  FI: "helsinki",
  IS: "reykjavik",
  US: "new york,new york city,los angeles,chicago,houston,phoenix,philadelphia,philadelphie,san antonio,san diego,dallas,san francisco,seattle,boston,miami,atlanta,washington,las vegas,denver,austin,portland,nashville,orlando,detroit,minneapolis,honolulu,new orleans,salt lake city,baltimore,pittsburgh,cleveland,st louis,charlotte,indianapolis,sacramento,san jose,tampa,oklahoma city,albuquerque",
  CA: "toronto,montreal,vancouver,ottawa,calgary,edmonton,quebec,winnipeg,halifax",
  MX: "mexico city,ciudad de mexico,guadalajara,monterrey,cancun",
  BR: "sao paulo,rio de janeiro,brasilia,salvador",
  AR: "buenos aires",
  CL: "santiago",
  PE: "lima",
  CO: "bogota,medellin",
  VE: "caracas",
  CU: "havana,la havane",
  EC: "quito",
  JP: "tokyo,osaka,kyoto,yokohama,nagoya,sapporo",
  CN: "beijing,pekin,shanghai,guangzhou,shenzhen,chengdu,hong kong",
  KR: "seoul,busan",
  TW: "taipei",
  TH: "bangkok",
  VN: "hanoi,ho chi minh city,da nang",
  SG: "singapore,singapour",
  MY: "kuala lumpur",
  ID: "jakarta,denpasar",
  PH: "manila,manille",
  IN: "new delhi,delhi,mumbai,bangalore,kolkata,chennai,hyderabad",
  PK: "karachi,islamabad,lahore",
  BD: "dhaka",
  LK: "colombo",
  NP: "kathmandu,katmandou",
  AE: "dubai,abu dhabi",
  SA: "riyadh,jeddah",
  IL: "jerusalem,tel aviv",
  JO: "amman",
  IR: "tehran,teheran",
  IQ: "baghdad,bagdad",
  QA: "doha",
  KW: "kuwait city",
  EG: "cairo,le caire",
  MA: "casablanca,rabat,marrakech",
  DZ: "algiers,alger",
  TN: "tunis",
  NG: "lagos,abuja",
  KE: "nairobi",
  ET: "addis ababa",
  ZA: "johannesburg,cape town,le cap,pretoria",
  GH: "accra",
  SN: "dakar",
  TZ: "dar es salaam",
  AU: "sydney,melbourne,brisbane,perth,adelaide,canberra",
  NZ: "auckland,wellington",
};

/** Every "<normalized name>|<CC>" pair, e.g. "paris|FR". */
export const MAJOR_CITY_KEYS = new Set(
  Object.entries(MAJOR_CITIES).flatMap(([cc, names]) =>
    names.split(",").map((name) => `${name}|${cc}`),
  ),
);
