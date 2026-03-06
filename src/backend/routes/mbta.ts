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
    // Parallel fetch: Green Street + every transfer/connecting stop
    const [
      gsPreds,
      dtxRedPreds,
      stateBlueEastPreds,
      hayGreenPreds,
      backBayCRPreds,
      northCRPreds,
      alertsResp,
    ] = await Promise.all([
      mbtaFetch(
        `/predictions?filter[stop]=${GS_SOUTH},${GS_NORTH}&include=trip&sort=departure_time`,
        apiKey,
      ),
      mbtaFetch(
        `/predictions?filter[stop]=place-dwnxg&filter[route]=Red&sort=departure_time`,
        apiKey,
      ),
      mbtaFetch(
        `/predictions?filter[stop]=place-state&filter[route]=Blue&filter[direction_id]=0&sort=departure_time`,
        apiKey,
      ),
      mbtaFetch(
        `/predictions?filter[stop]=place-haecl&filter[route]=Green-B,Green-C,Green-D,Green-E&filter[direction_id]=0&sort=departure_time`,
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

    // For each OL train (up to 5), compute the soonest catchable connection.
    // Returns up to 2 journey options.
    function buildJourneys(
      olTrains: Departure[],
      olDir: 'N' | 'S',
      transferStopName: string,
      olTravelMins: number,
      walkMins: number,
      connectPreds: MbtaApiResponse,
    ): JourneyOption[] {
      const results: JourneyOption[] = [];
      for (const train of olTrains.slice(0, 6)) {
        const arrivalDate = new Date(train.time);
        arrivalDate.setMinutes(arrivalDate.getMinutes() + olTravelMins + walkMins);
        const conn = firstAfter(connectPreds, arrivalDate);
        if (!conn) continue;
        const arriveTransferInMins = Math.round(
          (arrivalDate.getTime() - now.getTime()) / 60_000,
        );
        results.push({
          olDepartsInMins: train.minutesAway,
          olDirection: olDir,
          transferStop: transferStopName,
          arriveTransferInMins,
          waitMins: conn.waitMins,
          connectDepartsInMins: conn.minutesFromNow,
        });
        if (results.length >= 2) break;
      }
      return results;
    }

    // ── Build route cards ─────────────────────────────────────────────────────

    const routes: RouteCard[] = [];

    // 1. Orange Line — Northbound (direct)
    routes.push({
      id: 'ol-north',
      routeName: 'Orange Line',
      direction: 'Northbound · Oak Grove',
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
      routeName: 'Orange Line',
      direction: 'Southbound · Forest Hills',
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
        routeName: 'Red Line',
        direction: 'via Downtown Crossing · Alewife',
        shortCode: 'RL',
        lineColor: '#DA291C',
        lineTextColor: '#FFFFFF',
        isDirect: false,
        directDeps: [],
        journeys: redAlewifeJourneys,
      });
    }

    // 4. Red Line — toward Ashmont / Braintree (DTX, OL North, direction_id=0 on Red)
    const dtxRedAshmont = { data: dtxRedPreds.data.filter(p => p.attributes.direction_id === 0) };
    const redAshmontJourneys = buildJourneys(
      northbound, 'N', 'Downtown Crossing', OL_TRAVEL['place-dwnxg'], 2, dtxRedAshmont,
    );
    if (redAshmontJourneys.length > 0) {
      routes.push({
        id: 'rl-ashmont',
        routeName: 'Red Line',
        direction: 'via Downtown Crossing · Ashmont / Braintree',
        shortCode: 'RL',
        lineColor: '#DA291C',
        lineTextColor: '#FFFFFF',
        isDirect: false,
        directDeps: [],
        journeys: redAshmontJourneys,
      });
    }

    // 5. Blue Line — eastbound toward Airport / Wonderland
    const blueJourneys = buildJourneys(
      northbound, 'N', 'State Street', OL_TRAVEL['place-state'], 3, stateBlueEastPreds,
    );
    if (blueJourneys.length > 0) {
      routes.push({
        id: 'bl-east',
        routeName: 'Blue Line',
        direction: 'via State St · Airport / Wonderland',
        shortCode: 'BL',
        lineColor: '#003DA5',
        lineTextColor: '#FFFFFF',
        isDirect: false,
        directDeps: [],
        journeys: blueJourneys,
      });
    }

    // 6. Green Line — westbound toward Copley / Boylston
    const greenJourneys = buildJourneys(
      northbound, 'N', 'Haymarket', OL_TRAVEL['place-haecl'], 2, hayGreenPreds,
    );
    if (greenJourneys.length > 0) {
      routes.push({
        id: 'gl-west',
        routeName: 'Green Line',
        direction: 'via Haymarket · Copley / Boylston',
        shortCode: 'GL',
        lineColor: '#00843D',
        lineTextColor: '#FFFFFF',
        isDirect: false,
        directDeps: [],
        journeys: greenJourneys,
      });
    }

    // 7–N. Commuter Rail at Back Bay (one card per line)
    const bbCRRouteIds = [
      ...new Set(
        backBayCRPreds.data
          .map(p => p.relationships?.route?.data?.id)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    for (const routeId of bbCRRouteIds) {
      const routePreds = {
        data: backBayCRPreds.data.filter(
          p => p.relationships?.route?.data?.id === routeId,
        ),
      };
      const journeys = buildJourneys(
        northbound, 'N', 'Back Bay', OL_TRAVEL['place-bbsta'], 0, routePreds,
      );
      if (journeys.length === 0) continue;
      routes.push({
        id: `cr-bb-${routeId.toLowerCase().replace(/[^a-z0-9]/g, '-')}`,
        routeName: crName(routeId) + ' Line',
        direction: 'via Back Bay · Commuter Rail',
        shortCode: 'CR',
        lineColor: '#80276C',
        lineTextColor: '#FFFFFF',
        isDirect: false,
        directDeps: [],
        journeys,
      });
    }

    // N+. Commuter Rail at North Station (one card per line)
    const nsCRRouteIds = [
      ...new Set(
        northCRPreds.data
          .map(p => p.relationships?.route?.data?.id)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    for (const routeId of nsCRRouteIds) {
      const routePreds = {
        data: northCRPreds.data.filter(
          p => p.relationships?.route?.data?.id === routeId,
        ),
      };
      const journeys = buildJourneys(
        northbound, 'N', 'North Station', OL_TRAVEL['place-north'], 0, routePreds,
      );
      if (journeys.length === 0) continue;
      routes.push({
        id: `cr-ns-${routeId.toLowerCase().replace(/[^a-z0-9]/g, '-')}`,
        routeName: crName(routeId) + ' Line',
        direction: 'via North Station · Commuter Rail',
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
