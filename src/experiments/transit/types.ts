// Shapes that cross the wire between server/index.ts and page.tsx.

// One catchable journey to a connecting service:
// take OL in olDepartsInMins → arrive transfer in arriveTransferInMins → wait waitMins → board connecting at connectDepartsInMins
export interface JourneyOption {
  olDepartsInMins: number;
  olDirection: 'N' | 'S';
  transferStop: string;         // human name, e.g. "Back Bay", "Downtown Crossing"
  arriveTransferInMins: number; // minutes from now when you arrive at the transfer stop
  waitMins: number;             // minutes spent waiting at the transfer stop
  connectDepartsInMins: number; // minutes from now when the connecting service departs
  isEstimated?: boolean;        // true when derived from schedule frequency, not live prediction
}

// One catchable service reachable from Green Street
export interface RouteCard {
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

export interface ServiceAlert {
  id: string;
  effect: string;
  severity: number;
  header: string;
}

export interface TransitBoardData {
  routes: RouteCard[];
  alerts: ServiceAlert[];
  timestamp: string;
}
