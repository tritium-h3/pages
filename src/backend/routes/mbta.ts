import { Router, Request, Response } from 'express';

const router = Router();

const MBTA_BASE = 'https://api-v3.mbta.com';

// Green Street child platform stop IDs
const GS_SOUTH = '70002'; // Forest Hills direction (direction_id=0)
const GS_NORTH = '70003'; // Oak Grove direction (direction_id=1)

// Orange Line travel time in minutes from Green Street to key transfer/destination stops
const OL_TRAVEL: Record<string, number> = {
  'place-forhl': 4,  // Forest Hills  (direction 0 — southbound)
  'place-bbsta': 11, // Back Bay       (direction 1 — northbound)
  'place-dwnxg': 21, // Downtown Xing  (direction 1)
  'place-state': 23, // State          (direction 1)
  'place-haecl': 25, // Haymarket      (direction 1)
  'place-north': 27, // North Station  (direction 1)
};

// CR line short names (backend copy — also in frontend)
const CR_NAMES: Record<string, string> = {
  'CR-Providence': 'Providence', 'CR-Stoughton': 'Stoughton',
  'CR-Franklin': 'Franklin', 'CR-Needham': 'Needham',
  'CR-Fairmount': 'Fairmount', 'CR-Greenbush': 'Greenbush',
  'CR-Middleborough': 'Middleborough', 'CR-Kingston': 'Kingston',
  'CR-Newburyport': 'Newburyport', 'CR-Rockport': 'Rockport',
  'CR-Lowell': 'Lowell', 'CR-Haverhill': 'Haverhill',
  'CR-Fitchburg': 'Fitchburg', 'CR-Worcester': 'Worcester',
  'CR-Foxboro': 'Foxboro',
};
function crName(routeId: string): string {
  return CR_NAMES[routeId] ?? routeId.replace(/^CR-/, '');
}

// ── Types ────────────────────────────────────────────────────────────────────

interface MbtaApiResponse {
  data: MbtaEntity[];
  included?: MbtaEntity[];
}

interface MbtaEntity {
  id: string;
  type: string;
  attributes: Record<string, unknown>;
  relationships?: Record<string, { data: { id: string; type: string } | null }>;
}

interface Departure {
  time: string;
  minutesAway: number;
  headsign: string | null;
}

// One catchable journey to a connecting service:
// take OL in olDepartsInMins → arrive transfer in arriveTransferInMins → wait waitMins → board connecting at connectDepartsInMins
interface JourneyOption {
  olDepartsInMins: number;
  olDirection: 'N' | 'S';
  transferStop: string;         // human name, e.g. "Back Bay", "Downtown Crossing"
  arriveTransferInMins: number; // minutes from now when you arrive at the transfer stop
  waitMins: number;             // minutes spent waiting at the transfer stop
  connectDepartsInMins: number; // minutes from now when the connecting service departs
  isEstimated?: boolean;        // true when derived from schedule frequency, not live prediction
}

// One catchable service reachable from Green Street
interface RouteCard {
  id: string;
  routeName: string;      // e.g. "Orange Line", "Providence Line", "Red Line"
  direction: string;      // e.g. "Northbound · Oak Grove", "via Downtown Crossing"
  shortCode: string;      // badge text: "OL", "RL", "BL", "GL", "CR"
  lineColor: string;
  lineTextColor: string;
  isDirect: boolean;      // true only for OL N and OL S
  directDeps: Array<{ mins: number; headsign: string | null }>; // for direct OL cards
  journeys: JourneyOption[];   // for connecting cards, up to 2 options
}

interface ServiceAlert {
  id: string;
  effect: string;
  severity: number;
  header: string;
}

// ── Cache ─────────────────────────────────────────────────────────────────────

let cache: { data: unknown; ts: number } | null = null;
const CACHE_TTL_MS = 15_000;

// ── Helpers ───────────────────────────────────────────────────────────────────

async function mbtaFetch(path: string, apiKey: string): Promise<MbtaApiResponse> {
  const headers: Record<string, string> = {
    'Accept-Encoding': 'gzip',
  };
  if (apiKey) headers['x-api-key'] = apiKey;

  const res = await fetch(`${MBTA_BASE}${path}`, { headers });
  if (!res.ok) {
    throw new Error(`MBTA API ${res.status} ${res.statusText} — ${path}`);
  }
  return res.json() as Promise<MbtaApiResponse>;
}

function minutesUntil(isoTime: string | null | undefined, now: Date): number | null {
  if (!isoTime) return null;
  return Math.round((new Date(isoTime).getTime() - now.getTime()) / 60_000);
}

function pickTime(attrs: Record<string, unknown>): string | null {
  return (attrs.departure_time as string | null) ?? (attrs.arrival_time as string | null);
}

// ── Route ─────────────────────────────────────────────────────────────────────

router.get('/mbta/transit-board', async (_req: Request, res: Response) => {

  const apiKey = process.env.MBTA_API_KEY ?? '';
  const now = new Date();

  // Serve from cache if fresh
  if (cache && now.getTime() - cache.ts < CACHE_TTL_MS) {
    return res.json(cache.data);
  }

  try {
    // HH:MM string for schedule min_time filter — only fetch future departures
    const nowHHMM = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;

    // Parallel fetch: Green Street + every transfer/connecting stop
    const [
      gsPreds,
      dtxRedPreds,
      stateBlueEastPreds,
      stateBlueWestPreds,
      stateBlueEastScheds,
      stateBlueWestScheds,
      hayGreenBranchPreds,
      hayGreenGLXPreds,
      backBayCRPreds,
      northCRPreds,
      backBayCRScheds,
      northCRScheds,
      sstCRPreds,
      sstCRScheds,
      forlCRPreds,
      forlCRScheds,
      alertsResp,
    ] = await Promise.all([
      mbtaFetch(
        `/predictions?filter[stop]=${GS_SOUTH},${GS_NORTH}&include=trip&sort=departure_time`,
        apiKey,
      ),
      mbtaFetch(
        `/predictions?filter[stop]=place-dwnxg&filter[route]=Red&sort=departure_time&include=trip`,
        apiKey,
      ),
      mbtaFetch(
        `/predictions?filter[stop]=place-state&filter[route]=Blue&filter[direction_id]=0&sort=departure_time`,
        apiKey,
      ),
      mbtaFetch(
        `/predictions?filter[stop]=place-state&filter[route]=Blue&filter[direction_id]=1&sort=departure_time`,
        apiKey,
      ),
      // Blue Line schedules — fallback when prediction window is too short
      mbtaFetch(
        `/schedules?filter[stop]=place-state&filter[route]=Blue&filter[direction_id]=0&filter[min_time]=${nowHHMM}&sort=departure_time&page[limit]=8`,
        apiKey,
      ),
      mbtaFetch(
        `/schedules?filter[stop]=place-state&filter[route]=Blue&filter[direction_id]=1&filter[min_time]=${nowHHMM}&sort=departure_time&page[limit]=8`,
        apiKey,
      ),
      // Green Line at Park Street (via DTX underground concourse) — direction_id=0 = outbound to branches
      mbtaFetch(
        `/predictions?filter[stop]=place-pktrm&filter[route]=Green-B,Green-C,Green-D,Green-E&filter[direction_id]=0&sort=departure_time`,
        apiKey,
      ),
      // Green Line at Park Street — direction_id=1 = inbound/GLX (toward Medford/Union Sq)
      mbtaFetch(
        `/predictions?filter[stop]=place-pktrm&filter[route]=Green-D,Green-E&filter[direction_id]=1&sort=departure_time`,
        apiKey,
      ),
      // Back Bay CR — both directions so inbound trains are also visible
      mbtaFetch(
        `/predictions?filter[stop]=place-bbsta&filter[route_type]=2&sort=departure_time`,
        apiKey,
      ),
      mbtaFetch(
        `/predictions?filter[stop]=place-north&filter[route_type]=2&sort=departure_time`,
        apiKey,
      ),
      // CR schedules — fallback when predictions are unavailable (off-peak gaps)
      mbtaFetch(
        `/schedules?filter[stop]=place-bbsta&filter[route_type]=2&filter[min_time]=${nowHHMM}&sort=departure_time&page[limit]=24`,
        apiKey,
      ),
      mbtaFetch(
        `/schedules?filter[stop]=place-north&filter[route_type]=2&filter[min_time]=${nowHHMM}&sort=departure_time&page[limit]=24`,
        apiKey,
      ),
      // South Station CR (walk from DTX ~5 min) — South Side lines only
      mbtaFetch(
        `/predictions?filter[stop]=place-sstat&filter[route_type]=2&sort=departure_time`,
        apiKey,
      ),
      mbtaFetch(
        `/schedules?filter[stop]=place-sstat&filter[route_type]=2&filter[min_time]=${nowHHMM}&sort=departure_time&page[limit]=24`,
        apiKey,
      ),
      // Forest Hills CR (OL southbound, 4 min) — Needham Line only
      mbtaFetch(
        `/predictions?filter[stop]=place-forhl&filter[route]=CR-Needham&sort=departure_time`,
        apiKey,
      ),
      mbtaFetch(
        `/schedules?filter[stop]=place-forhl&filter[route]=CR-Needham&filter[min_time]=${nowHHMM}&sort=departure_time&page[limit]=12`,
        apiKey,
      ),
      mbtaFetch(
        `/alerts?filter[route]=Orange&filter[activity]=BOARD,EXIT,RIDE`,
        apiKey,
      ),
    ]);

    // Build trip headsign lookup from GS included trip objects
    const headsignById: Record<string, string> = {};
    for (const inc of gsPreds.included ?? []) {
      if (inc.type === 'trip' && typeof inc.attributes.headsign === 'string') {
        headsignById[inc.id] = inc.attributes.headsign;
      }
    }

    // Also build headsign lookup for DTX Red Line trips
    const dtxHeadsignById: Record<string, string> = {};
    for (const inc of dtxRedPreds.included ?? []) {
      if (inc.type === 'trip' && typeof inc.attributes.headsign === 'string') {
        dtxHeadsignById[inc.id] = inc.attributes.headsign;
      }
    }

    // Sort GS predictions into northbound / southbound
    const northbound: Departure[] = [];
    const southbound: Departure[] = [];

    for (const p of gsPreds.data) {
      const time = pickTime(p.attributes);
      if (!time) continue;
      const mins = minutesUntil(time, now);
      if (mins === null || mins < -1) continue;

      const stopId = p.relationships?.stop?.data?.id;
      const tripId = p.relationships?.trip?.data?.id;
      const headsign = tripId ? (headsignById[tripId] ?? null) : null;
      const dep: Departure = { time, minutesAway: Math.max(0, mins), headsign };
      // Only include trains with >2 min until departure — 3 min walk from home means
      // anything at 0-2 min is already missed.
      if (mins <= 2) continue;
      if (stopId === GS_NORTH) northbound.push(dep);
      else southbound.push(dep);
    }
    northbound.sort((a, b) => a.minutesAway - b.minutesAway);
    southbound.sort((a, b) => a.minutesAway - b.minutesAway);

    // ── Helpers ───────────────────────────────────────────────────────────────

    // Sort connecting preds by time, find first departing at or after arrivalDate
    function firstAfter(
      preds: MbtaApiResponse,
      arrivalDate: Date,
    ): { minutesFromNow: number; waitMins: number } | null {
      const sortedTimes = preds.data
        .map(p => pickTime(p.attributes))
        .filter((t): t is string => t !== null)
        .sort();
      for (const t of sortedTimes) {
        const dep = new Date(t);
        if (dep >= arrivalDate) {
          const waitMins = Math.max(
            0,
            Math.round((dep.getTime() - arrivalDate.getTime()) / 60_000),
          );
          return {
            minutesFromNow: Math.max(0, minutesUntil(t, now) ?? 0),
            waitMins,
          };
        }
      }
      return null;
    }

    // Estimate wait from schedule frequency when no live predictions are available.
    // Returns half the average headway between upcoming scheduled trips.
    function headwayEstimate(
      scheds: MbtaApiResponse,
      arrivalDate: Date,
    ): { minutesFromNow: number; waitMins: number } | null {
      const upcoming = scheds.data
        .map(s => pickTime(s.attributes))
        .filter((t): t is string => t !== null)
        .map(t => new Date(t))
        .filter(d => !isNaN(d.getTime()) && d >= arrivalDate)
        .sort((a, b) => a.getTime() - b.getTime());
      if (upcoming.length < 2) return null;
      const sample = Math.min(upcoming.length, 4);
      let totalGapMs = 0;
      for (let i = 1; i < sample; i++) {
        totalGapMs += upcoming[i].getTime() - upcoming[i - 1].getTime();
      }
      const headwayMins = totalGapMs / (sample - 1) / 60_000;
      const waitMins = Math.max(1, Math.round(headwayMins / 2));
      const estimatedDep = new Date(arrivalDate.getTime() + waitMins * 60_000);
      return {
        minutesFromNow: Math.max(0, Math.round((estimatedDep.getTime() - now.getTime()) / 60_000)),
        waitMins,
      };
    }

    // For each OL train (up to 6), compute the soonest catchable connection.
    // Falls back to schedule-frequency estimate when predictions are empty.
    // Returns up to 2 journey options (only 1 if estimated).
    function buildJourneys(
      olTrains: Departure[],
      olDir: 'N' | 'S',
      transferStopName: string,
      olTravelMins: number,
      walkMins: number,
      connectPreds: MbtaApiResponse,
      connectScheds?: MbtaApiResponse,
    ): JourneyOption[] {
      const results: JourneyOption[] = [];
      for (const train of olTrains.slice(0, 6)) {
        const arrivalDate = new Date(train.time);
        arrivalDate.setMinutes(arrivalDate.getMinutes() + olTravelMins + walkMins);
        const arriveTransferInMins = Math.round(
          (arrivalDate.getTime() - now.getTime()) / 60_000,
        );
        const conn = firstAfter(connectPreds, arrivalDate);
        if (conn) {
          results.push({
            olDepartsInMins: train.minutesAway,
            olDirection: olDir,
            transferStop: transferStopName,
            arriveTransferInMins,
            waitMins: conn.waitMins,
            connectDepartsInMins: conn.minutesFromNow,
          });
          if (results.length >= 2) break;
        } else if (connectScheds && results.length === 0) {
          // No live prediction — estimate from schedule headway for first journey only
          const est = headwayEstimate(connectScheds, arrivalDate);
          if (est) {
            results.push({
              olDepartsInMins: train.minutesAway,
              olDirection: olDir,
              transferStop: transferStopName,
              arriveTransferInMins,
              waitMins: est.waitMins,
              connectDepartsInMins: est.minutesFromNow,
              isEstimated: true,
            });
            break; // Only one estimated journey
          }
        }
      }
      return results;
    }

    // Tries all transfer options for each OL train and returns the best 2 journeys
    // across all options, sorted by earliest board time.
    function buildBestJourneys(
      transferOptions: Array<{
        stopName: string;
        olDir: 'N' | 'S';
        olTravelMins: number;
        walkMins: number;
        preds: MbtaApiResponse;
        scheds?: MbtaApiResponse;
      }>,
    ): JourneyOption[] {
      const pool: JourneyOption[] = [];
      for (const opt of transferOptions) {
        const olTrains = opt.olDir === 'N' ? northbound : southbound;
        let foundLive = false;
        for (const train of olTrains.slice(0, 6)) {
          const arrivalDate = new Date(train.time);
          arrivalDate.setMinutes(arrivalDate.getMinutes() + opt.olTravelMins + opt.walkMins);
          const arriveTransferInMins = Math.round((arrivalDate.getTime() - now.getTime()) / 60_000);
          const conn = firstAfter(opt.preds, arrivalDate);
          if (conn) {
            foundLive = true;
            pool.push({
              olDepartsInMins: train.minutesAway,
              olDirection: opt.olDir,
              transferStop: opt.stopName,
              arriveTransferInMins,
              waitMins: conn.waitMins,
              connectDepartsInMins: conn.minutesFromNow,
            });
          }
        }
        // Schedule fallback only if this option had zero live predictions
        if (!foundLive && opt.scheds) {
          for (const train of olTrains.slice(0, 3)) {
            const arrivalDate = new Date(train.time);
            arrivalDate.setMinutes(arrivalDate.getMinutes() + opt.olTravelMins + opt.walkMins);
            const arriveTransferInMins = Math.round((arrivalDate.getTime() - now.getTime()) / 60_000);
            const est = headwayEstimate(opt.scheds, arrivalDate);
            if (est) {
              pool.push({
                olDepartsInMins: train.minutesAway,
                olDirection: opt.olDir,
                transferStop: opt.stopName,
                arriveTransferInMins,
                waitMins: est.waitMins,
                connectDepartsInMins: est.minutesFromNow,
                isEstimated: true,
              });
              break;
            }
          }
        }
      }
      // Sort by earliest board time; pick best 2 ensuring the 2nd uses a different OL departure
      pool.sort((a, b) => a.connectDepartsInMins - b.connectDepartsInMins);
      const results: JourneyOption[] = [];
      const seenConnect = new Set<string>();
      const seenOLDep = new Set<number>();
      for (const j of pool) {
        const connectKey = `${j.transferStop}:${j.connectDepartsInMins}`;
        if (seenConnect.has(connectKey)) continue;
        if (results.length > 0 && seenOLDep.has(j.olDepartsInMins)) continue;
        seenConnect.add(connectKey);
        seenOLDep.add(j.olDepartsInMins);
        results.push(j);
        if (results.length >= 2) break;
      }
      return results;
    }

    // ── Build route cards ─────────────────────────────────────────────────────

    const routes: RouteCard[] = [];

    // 1. Orange Line — Northbound (direct)
    routes.push({
      id: 'ol-north',
      routeName: 'Oak Grove',
      direction: 'Northbound',
      shortCode: 'OL',
      lineColor: '#ED8B00',
      lineTextColor: '#FFFFFF',
      isDirect: true,
      directDeps: northbound.slice(0, 5).map(d => ({ mins: d.minutesAway, headsign: d.headsign })),
      journeys: [],
    });

    // 2. Orange Line — Southbound (direct)
    routes.push({
      id: 'ol-south',
      routeName: 'Forest Hills',
      direction: 'Southbound',
      shortCode: 'OL',
      lineColor: '#ED8B00',
      lineTextColor: '#FFFFFF',
      isDirect: true,
      directDeps: southbound.slice(0, 5).map(d => ({ mins: d.minutesAway, headsign: d.headsign })),
      journeys: [],
    });

    // 3. Red Line — toward Alewife (DTX, OL North, direction_id=1 on Red)
    const dtxRedAlewife = { data: dtxRedPreds.data.filter(p => p.attributes.direction_id === 1) };
    const redAlewifeJourneys = buildJourneys(
      northbound, 'N', 'Downtown Crossing', OL_TRAVEL['place-dwnxg'], 2, dtxRedAlewife,
    );
    if (redAlewifeJourneys.length > 0) {
      routes.push({
        id: 'rl-alewife',
        routeName: 'Alewife',
        direction: 'via Downtown Crossing',
        shortCode: 'RL',
        lineColor: '#DA291C',
        lineTextColor: '#FFFFFF',
        isDirect: false,
        directDeps: [],
        journeys: redAlewifeJourneys,
      });
    }

    // 4a. Red Line — toward Ashmont (DTX, direction_id=0, headsign contains "Ashmont")
    const dtxRedAshmont = {
      data: dtxRedPreds.data.filter(p => {
        if (p.attributes.direction_id !== 0) return false;
        const tripId = p.relationships?.trip?.data?.id;
        const hs = tripId ? dtxHeadsignById[tripId] : undefined;
        return !hs || hs.toLowerCase().includes('ashmont');
      }),
    };
    const redAshmontJourneys = buildJourneys(
      northbound, 'N', 'Downtown Crossing', OL_TRAVEL['place-dwnxg'], 2, dtxRedAshmont,
    );
    if (redAshmontJourneys.length > 0) {
      routes.push({
        id: 'rl-ashmont',
        routeName: 'Ashmont',
        direction: 'via Downtown Crossing',
        shortCode: 'RL',
        lineColor: '#DA291C',
        lineTextColor: '#FFFFFF',
        isDirect: false,
        directDeps: [],
        journeys: redAshmontJourneys,
      });
    }

    // 4b. Red Line — toward Braintree (DTX, direction_id=0, headsign contains "Braintree")
    const dtxRedBraintree = {
      data: dtxRedPreds.data.filter(p => {
        if (p.attributes.direction_id !== 0) return false;
        const tripId = p.relationships?.trip?.data?.id;
        const hs = tripId ? dtxHeadsignById[tripId] : undefined;
        return hs?.toLowerCase().includes('braintree') ?? false;
      }),
    };
    const redBraintreeJourneys = buildJourneys(
      northbound, 'N', 'Downtown Crossing', OL_TRAVEL['place-dwnxg'], 2, dtxRedBraintree,
    );
    if (redBraintreeJourneys.length > 0) {
      routes.push({
        id: 'rl-braintree',
        routeName: 'Braintree',
        direction: 'via Downtown Crossing',
        shortCode: 'RL',
        lineColor: '#DA291C',
        lineTextColor: '#FFFFFF',
        isDirect: false,
        directDeps: [],
        journeys: redBraintreeJourneys,
      });
    }

    // 5a. Blue Line — eastbound toward Wonderland
    const blueEastJourneys = buildJourneys(
      northbound, 'N', 'State Street', OL_TRAVEL['place-state'], 3, stateBlueEastPreds, stateBlueEastScheds,
    );
    if (blueEastJourneys.length > 0) {
      routes.push({
        id: 'bl-east',
        routeName: 'Wonderland',
        direction: 'via State Street',
        shortCode: 'BL',
        lineColor: '#003DA5',
        lineTextColor: '#FFFFFF',
        isDirect: false,
        directDeps: [],
        journeys: blueEastJourneys,
      });
    }

    // 5b. Blue Line — westbound toward Bowdoin / Government Center
    const blueWestJourneys = buildJourneys(
      northbound, 'N', 'State Street', OL_TRAVEL['place-state'], 3, stateBlueWestPreds, stateBlueWestScheds,
    );
    if (blueWestJourneys.length > 0) {
      routes.push({
        id: 'bl-west',
        routeName: 'Bowdoin',
        direction: 'via State Street',
        shortCode: 'BL',
        lineColor: '#003DA5',
        lineTextColor: '#FFFFFF',
        isDirect: false,
        directDeps: [],
        journeys: blueWestJourneys,
      });
    }

    // 6a. Green Line — outbound branches (B/C/D/E) from Park Street via DTX concourse
    const GL_BRANCHES: Array<{ id: string; name: string }> = [
      { id: 'Green-B', name: 'Boston College' },
      { id: 'Green-C', name: 'Cleveland Circle' },
      { id: 'Green-D', name: 'Riverside' },
      { id: 'Green-E', name: 'Heath Street' },
    ];
    for (const branch of GL_BRANCHES) {
      const branchPreds = {
        data: hayGreenBranchPreds.data.filter(
          p => p.relationships?.route?.data?.id === branch.id,
        ),
      };
      const journeys = buildJourneys(
        northbound, 'N', 'Park Street', OL_TRAVEL['place-dwnxg'], 4, branchPreds,
      );
      if (journeys.length === 0) continue;
      routes.push({
        id: `gl-${branch.id.toLowerCase().replace('green-', '')}`,
        routeName: branch.name,
        direction: 'via Park Street',
        shortCode: 'GL',
        lineColor: '#00843D',
        lineTextColor: '#FFFFFF',
        isDirect: false,
        directDeps: [],
        journeys,
      });
    }

    // 6b. Green Line — GLX inbound (toward Medford / Union Sq) from Park Street
    const greenGLXJourneys = buildJourneys(
      northbound, 'N', 'Park Street', OL_TRAVEL['place-dwnxg'], 4, hayGreenGLXPreds,
    );
    if (greenGLXJourneys.length > 0) {
      routes.push({
        id: 'gl-glx',
        routeName: 'Medford / Union Sq',
        direction: 'via Park Street',
        shortCode: 'GL',
        lineColor: '#00843D',
        lineTextColor: '#FFFFFF',
        isDirect: false,
        directDeps: [],
        journeys: greenGLXJourneys,
      });
    }

    // 7–N. Commuter Rail — one card per line, best available transfer
    const allCRRouteIds = [
      ...new Set(
        [
          ...backBayCRPreds.data, ...backBayCRScheds.data,
          ...northCRPreds.data,   ...northCRScheds.data,
          ...sstCRPreds.data,     ...sstCRScheds.data,
          ...forlCRPreds.data,    ...forlCRScheds.data,
        ]
          .map(p => p.relationships?.route?.data?.id)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    for (const routeId of allCRRouteIds) {
      const f = (src: MbtaApiResponse) => ({
        data: src.data.filter(p => p.relationships?.route?.data?.id === routeId),
      });
      const journeys = buildBestJourneys([
        { stopName: 'Back Bay',      olDir: 'N', olTravelMins: OL_TRAVEL['place-bbsta'], walkMins: 0, preds: f(backBayCRPreds), scheds: f(backBayCRScheds) },
        { stopName: 'South Station', olDir: 'N', olTravelMins: OL_TRAVEL['place-dwnxg'], walkMins: 5, preds: f(sstCRPreds),     scheds: f(sstCRScheds)     },
        { stopName: 'North Station', olDir: 'N', olTravelMins: OL_TRAVEL['place-north'], walkMins: 0, preds: f(northCRPreds),   scheds: f(northCRScheds)   },
        { stopName: 'Forest Hills',  olDir: 'S', olTravelMins: OL_TRAVEL['place-forhl'], walkMins: 0, preds: f(forlCRPreds),    scheds: f(forlCRScheds)    },
      ]);
      if (journeys.length === 0) continue;
      routes.push({
        id: `cr-${routeId.toLowerCase().replace(/[^a-z0-9]/g, '-')}`,
        routeName: crName(routeId) + ' Line',
        direction: `via ${journeys[0].transferStop}`,
        shortCode: 'CR',
        lineColor: '#80276C',
        lineTextColor: '#FFFFFF',
        isDirect: false,
        directDeps: [],
        journeys,
      });
    }

    const alerts: ServiceAlert[] = alertsResp.data
      .map(a => ({
        id: a.id,
        effect: a.attributes.effect as string,
        severity: a.attributes.severity as number,
        header: a.attributes.header as string,
      }))
      .sort((a, b) => b.severity - a.severity);

    const payload = { routes, alerts, timestamp: now.toISOString() };
    cache = { data: payload, ts: now.getTime() };
    return res.json(payload);
  } catch (err) {
    console.error('[MBTA] transit-board error:', err);
    return res.status(502).json({ error: String(err) });
  }
});

export default router;
